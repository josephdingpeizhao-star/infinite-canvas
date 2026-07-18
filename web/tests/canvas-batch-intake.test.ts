import { describe, expect, test } from "bun:test";

import {
    BATCH_INTAKE_ACK_TIMEOUT_MS,
    BatchIntakeIntegrityError,
    batchSourceFilePatch,
    buildBatchIntakeCommand,
    buildBatchUploadUrl,
    createBatchSourceFile,
    expireBatchIntakeState,
    readBatchIntakeState,
    resetInterruptedBatchIntakes,
    resolveBatchIntakeSelection,
    sha256Blob,
    uploadBatchSourceImages,
    validateBatchIntakeFacts,
} from "../src/lib/canvas/canvas-batch-intake";
import { buildWorkflowDemoCommand, connectedWorkflowImageIds, readWorkflowDemoState } from "../src/lib/canvas/canvas-workflow-demo";
import { CanvasNodeType, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const ORIGINAL_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function batchInfo(id = "card", patch: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 0, y: 0 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status: "draft",
                productType: "餐具",
                productHeightCm: 25,
                allowClearWater: true,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                ...patch,
            },
        },
    };
}

function workflow(id = "machine"): CanvasNodeData {
    return { id, type: CanvasNodeType.Workflow, title: "工作流", position: { x: 600, y: 0 }, width: 420, height: 300 };
}

function sourceFile(name = "餐具正面.png"): CanvasBatchSourceFile {
    return { name, size: 3, type: "image/png", lastModified: 1_700_000_000_000, sha256: ORIGINAL_SHA };
}

function image(id = "image", original = true): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: `${id}.png`,
        position: { x: 0, y: 600 },
        width: 180,
        height: 180,
        metadata: {
            content: "blob:test",
            storageKey: `image:${id}`,
            bytes: 3,
            mimeType: "image/png",
            sourceFile: original ? sourceFile(`${id}.png`) : undefined,
        },
    };
}

function connection(id: string, fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}

describe("canvas batch intake", () => {
    test("uses the exact cross-repository batch-info node type", () => {
        expect(CanvasNodeType.BatchInfo).toBe("batch-info");
    });

    test("keeps the seven confirmed facts and fixed counts through UTF-8 JSON persistence", () => {
        const serialized = JSON.stringify(batchInfo("card", { productType: "餐具 · 茶具" }).metadata);
        const state = readBatchIntakeState(JSON.parse(serialized));
        expect(state).toMatchObject({
            status: "draft",
            productType: "餐具 · 茶具",
            productHeightCm: 25,
            allowClearWater: true,
            prohibitPouringAndHeating: true,
            skipMissingDAngle: true,
            mainImageCount: 6,
            detailImageCount: 8,
            handheldMainCount: 2,
            handheldDetailCount: 1,
        });
        expect(new TextDecoder().decode(new TextEncoder().encode(serialized))).toBe(serialized);
    });

    test("requires a product type and a positive integer height without changing fixed 6+8 and 2+1", () => {
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { productType: "  " }).metadata))).toEqual({ ok: false, message: "请填写产品品类。" });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { productHeightCm: 0 }).metadata))).toEqual({ ok: false, message: "产品高度必须填写正整数厘米。" });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { productHeightCm: 25.5 }).metadata))).toEqual({ ok: false, message: "产品高度必须填写正整数厘米。" });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo().metadata))).toMatchObject({
            ok: true,
            facts: { handheld_main: 2, handheld_detail: 1 },
        });
    });

    test("selects one information card, one workflow, and unique inbound disk originals", () => {
        const card = batchInfo();
        const machine = workflow();
        const first = image("first");
        const nodes = [card, machine, first];
        const connections = [connection("card-machine", card.id, machine.id), connection("first-machine", first.id, machine.id), connection("first-machine-duplicate", first.id, machine.id)];
        expect(resolveBatchIntakeSelection(card.id, nodes, connections)).toEqual({
            ok: true,
            workflowNodeId: machine.id,
            sourceImageNodeIds: [first.id],
        });
    });

    test("rejects a missing or ambiguous workflow and more than one card on the same machine", () => {
        const card = batchInfo();
        const otherCard = batchInfo("other-card");
        const firstMachine = workflow("machine-a");
        const secondMachine = workflow("machine-b");
        const original = image();
        expect(resolveBatchIntakeSelection(card.id, [card], [])).toEqual({ ok: false, message: "请把这张信息卡连接到一台工作流机器。" });
        expect(resolveBatchIntakeSelection(card.id, [card, firstMachine, secondMachine, original], [connection("a", card.id, firstMachine.id), connection("b", card.id, secondMachine.id)])).toEqual({
            ok: false,
            message: "一张信息卡只能连接一台工作流机器。",
        });
        expect(resolveBatchIntakeSelection(card.id, [card, otherCard, firstMachine, original], [connection("a", card.id, firstMachine.id), connection("b", otherCard.id, firstMachine.id), connection("c", original.id, firstMachine.id)])).toEqual({
            ok: false,
            message: "一台工作流机器只能连接一张批次信息卡。",
        });
    });

    test("rejects derived images and requires every inbound image to be a stored disk original", () => {
        const card = batchInfo();
        const machine = workflow();
        const original = image("original");
        const derived = image("derived", false);
        const connections = [connection("card", card.id, machine.id), connection("original", original.id, machine.id), connection("derived", derived.id, machine.id)];
        expect(resolveBatchIntakeSelection(card.id, [card, machine, original, derived], connections)).toEqual({
            ok: false,
            message: "“derived.png”不是从磁盘直接拖入的原图，请移除后再登记。",
        });
    });

    test("builds one build-only command without changing the M1 demo contract", () => {
        const state = readBatchIntakeState(batchInfo().metadata);
        const command = buildBatchIntakeCommand(state, { workflowNodeId: "machine", sourceImageNodeIds: ["原图-一"] }, "request-001", 1_000);
        expect(command.content).toBe("# batch-intake\n# request-id: request-001\n# requested-at: 1000\nbuild: batch");
        expect(command.state).toMatchObject({
            status: "queued",
            requestId: "request-001",
            requestedAt: 1_000,
            workflowNodeId: "machine",
            sourceImageNodeIds: ["原图-一"],
            facts: {
                product_type: "餐具",
                height_cm: 25,
                handheld_main: 2,
                handheld_detail: 1,
                allow_clear_water: true,
                forbid_pouring_and_heating: true,
                missing_d_no_retake: true,
            },
        });
        expect(Object.keys(command.state.facts)).toEqual(["product_type", "height_cm", "handheld_main", "handheld_detail", "allow_clear_water", "forbid_pouring_and_heating", "missing_d_no_retake"]);
        expect(command.content).not.toContain("run: renders");
        expect(command.content).not.toContain("retry: renders");
    });

    test("leaves the M1 start action as a 0-cost demo and ignores the information card as image input", () => {
        const card = batchInfo();
        const machine = workflow();
        const original = image();
        const connections = [connection("card", card.id, machine.id), connection("image", original.id, machine.id)];
        expect(connectedWorkflowImageIds(machine.id, [card, machine, original], connections)).toEqual([original.id]);
        const demoCommand = buildWorkflowDemoCommand(readWorkflowDemoState(undefined), "demo-001", 1_000);
        expect(demoCommand.content).toContain("run: renders");
        expect(demoCommand.content).not.toContain("build: batch");
        expect(demoCommand.state.status).toBe("queued");
    });

    test("round-trips a Chinese batch id and node id through the upload route", () => {
        const url = buildBatchUploadUrl("http://127.0.0.1:17372", "餐具_20260718", "request-001", "原图-一");
        expect(url).toBe("http://127.0.0.1:17372/batch-intake/%E9%A4%90%E5%85%B7_20260718/request-001/files/%E5%8E%9F%E5%9B%BE-%E4%B8%80");
        const segments = new URL(url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
        expect(segments).toEqual(["batch-intake", "餐具_20260718", "request-001", "files", "原图-一"]);
        expect(() => buildBatchUploadUrl("https://example.com", "餐具_20260718", "request-001", "原图-一")).toThrow("原图接收地址不是批准的本机地址");
    });

    test("computes the browser Blob SHA-256 without re-encoding", async () => {
        expect(await sha256Blob(new Blob(["abc"], { type: "image/png" }))).toBe(ORIGINAL_SHA);
    });

    test("persists the first disk File proof and explicitly clears it for derived image writes", async () => {
        const file = new File(["abc"], "餐具正面.png", { type: "image/png", lastModified: 1_700_000_000_000 });
        expect(await createBatchSourceFile(file)).toEqual(sourceFile());
        expect(batchSourceFilePatch(await createBatchSourceFile(file))).toEqual({ sourceFile: sourceFile() });
        expect(batchSourceFilePatch()).toEqual({ sourceFile: undefined });
    });

    test("posts the original Blob once with the existing canvas token and encoded file metadata", async () => {
        const blob = new Blob(["abc"], { type: "image/png" });
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const fetcher: typeof fetch = async (input, init = {}) => {
            calls.push({ url: String(input), init });
            return new Response(JSON.stringify({ ok: true, sha256: ORIGINAL_SHA }), { status: 200, headers: { "content-type": "application/json" } });
        };
        const result = await uploadBatchSourceImages({
            uploadBaseUrl: "http://127.0.0.1:17372",
            batchId: "餐具_20260718",
            requestId: "request-001",
            token: "existing-canvas-token",
            sources: [{ nodeId: "原图-一", sourceFile: sourceFile(), blob }],
            fetcher,
        });
        expect(result).toEqual([{ nodeId: "原图-一", sha256: ORIGINAL_SHA }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.init.method).toBe("POST");
        expect(calls[0]?.init.body).toBe(blob);
        const headers = new Headers(calls[0]?.init.headers);
        expect(headers.get("x-canvas-agent-token")).toBe("existing-canvas-token");
        expect(headers.get("x-canvas-file-name")).toBe("%E9%A4%90%E5%85%B7%E6%AD%A3%E9%9D%A2.png");
        expect(headers.get("x-canvas-file-size")).toBe("3");
        expect(headers.get("x-canvas-file-sha256")).toBe(ORIGINAL_SHA);
        expect(headers.get("x-canvas-file-last-modified")).toBe("1700000000000");
        expect(headers.has("authorization")).toBe(false);
    });

    test("hard-stops before upload when browser storage differs from the disk-original SHA", async () => {
        let calls = 0;
        await expect(
            uploadBatchSourceImages({
                uploadBaseUrl: "http://127.0.0.1:17372",
                batchId: "餐具_20260718",
                requestId: "request-001",
                token: "existing-canvas-token",
                sources: [{ nodeId: "changed", sourceFile: sourceFile("changed.png"), blob: new Blob(["changed"], { type: "image/png" }) }],
                fetcher: async () => {
                    calls += 1;
                    return new Response();
                },
            }),
        ).rejects.toBeInstanceOf(BatchIntakeIntegrityError);
        expect(calls).toBe(0);
    });

    test("preflights every local Blob so a later mismatch still causes zero POST requests", async () => {
        let calls = 0;
        await expect(
            uploadBatchSourceImages({
                uploadBaseUrl: "http://127.0.0.1:17372",
                batchId: "餐具_20260718",
                requestId: "request-001",
                token: "existing-canvas-token",
                sources: [
                    { nodeId: "first", sourceFile: sourceFile("first.png"), blob: new Blob(["abc"], { type: "image/png" }) },
                    { nodeId: "changed", sourceFile: sourceFile("changed.png"), blob: new Blob(["changed"], { type: "image/png" }) },
                ],
                fetcher: async () => {
                    calls += 1;
                    return new Response();
                },
            }),
        ).rejects.toBeInstanceOf(BatchIntakeIntegrityError);
        expect(calls).toBe(0);
    });

    test("hard-stops the remaining queue on a server hash mismatch and never retries", async () => {
        let calls = 0;
        await expect(
            uploadBatchSourceImages({
                uploadBaseUrl: "http://127.0.0.1:17372",
                batchId: "餐具_20260718",
                requestId: "request-001",
                token: "existing-canvas-token",
                sources: [
                    { nodeId: "first", sourceFile: sourceFile("first.png"), blob: new Blob(["abc"], { type: "image/png" }) },
                    { nodeId: "second", sourceFile: sourceFile("second.png"), blob: new Blob(["abc"], { type: "image/png" }) },
                ],
                fetcher: async () => {
                    calls += 1;
                    return new Response(JSON.stringify({ ok: false, sha256: "0".repeat(64), errorCode: "hash_mismatch" }), { status: 409, headers: { "content-type": "application/json" } });
                },
            }),
        ).rejects.toBeInstanceOf(BatchIntakeIntegrityError);
        expect(calls).toBe(1);
    });

    test("fails closed when the service omits its SHA proof", async () => {
        await expect(
            uploadBatchSourceImages({
                uploadBaseUrl: "http://127.0.0.1:17372",
                batchId: "餐具_20260718",
                requestId: "request-001",
                token: "existing-canvas-token",
                sources: [{ nodeId: "first", sourceFile: sourceFile(), blob: new Blob(["abc"], { type: "image/png" }) }],
                fetcher: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
            }),
        ).rejects.toBeInstanceOf(BatchIntakeIntegrityError);
    });

    test("does not misreport an ordinary token or business rejection as image damage", async () => {
        let caught: unknown;
        try {
            await uploadBatchSourceImages({
                uploadBaseUrl: "http://127.0.0.1:17372",
                batchId: "餐具_20260718",
                requestId: "request-001",
                token: "secret-token-must-not-leak",
                sources: [{ nodeId: "first", sourceFile: sourceFile(), blob: new Blob(["abc"], { type: "image/png" }) }],
                fetcher: async () => new Response(JSON.stringify({ ok: false, errorCode: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } }),
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(BatchIntakeIntegrityError);
        expect((caught as Error).message).toBe("本机批次登记服务拒绝了原图，本次已停止且不会自动重试。");
        expect((caught as Error).message).not.toContain("secret-token-must-not-leak");
    });

    test("turns an unacknowledged build request into a human-readable failure without retrying", () => {
        const queued = buildBatchIntakeCommand(readBatchIntakeState(batchInfo().metadata), { workflowNodeId: "machine", sourceImageNodeIds: ["image"] }, "request-001", 1_000).state;
        expect(expireBatchIntakeState(queued, 1_000 + BATCH_INTAKE_ACK_TIMEOUT_MS - 1)).toEqual(queued);
        expect(expireBatchIntakeState(queued, 1_000 + BATCH_INTAKE_ACK_TIMEOUT_MS)).toMatchObject({
            status: "failed",
            errorMessage: "本机批次登记服务没有响应，请重新启动画布服务后再试。",
        });
    });

    test("does not automatically resume a browser upload after refresh", () => {
        const ready = batchInfo("ready", { status: "upload_ready", requestId: "request-ready" });
        const uploading = batchInfo("uploading", { status: "uploading", requestId: "request-uploading", receivedCount: 1 });
        const queued = batchInfo("queued", { status: "queued", requestId: "request-queued" });
        const restored = resetInterruptedBatchIntakes([ready, uploading, queued]);
        expect(readBatchIntakeState(restored[0]?.metadata)).toMatchObject({ status: "failed", requestId: "request-ready" });
        expect(readBatchIntakeState(restored[1]?.metadata)).toMatchObject({ status: "failed", requestId: "request-uploading", receivedCount: 1 });
        expect(readBatchIntakeState(restored[2]?.metadata)).toMatchObject({ status: "queued", requestId: "request-queued" });
    });
});
