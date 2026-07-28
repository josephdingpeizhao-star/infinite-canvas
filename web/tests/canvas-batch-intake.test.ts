import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { advancedOptionPatch, CanvasBatchAdvancedOptions } from "../src/components/canvas/canvas-batch-advanced-options";
import { CanvasBatchInfoNode } from "../src/components/canvas/canvas-batch-info-node";
import {
    BATCH_CATEGORY_UNAVAILABLE_MESSAGE,
    BATCH_CATEGORY_URL,
    BATCH_INTAKE_ACK_TIMEOUT_MS,
    BATCH_INTAKE_CONTRACT_SHA256,
    BatchIntakeIntegrityError,
    batchSourceFilePatch,
    buildBatchIntakeCommand,
    buildBatchUploadUrl,
    createBatchSourceFile,
    categoryDefaultPatch,
    categorySwitchPatch,
    expireBatchIntakeState,
    fetchBatchCategoryCatalog,
    readBatchIntakeState,
    resetInterruptedBatchIntakes,
    resolveBatchIntakeSelection,
    sha256Blob,
    uploadBatchSourceImages,
    validateBatchIntakeFacts,
} from "../src/lib/canvas/canvas-batch-intake";
import { buildWorkflowDemoCommand, connectedWorkflowImageIds, readWorkflowDemoState } from "../src/lib/canvas/canvas-workflow-demo";
import { CanvasNodeType, type CanvasBatchCategoryCatalog, type CanvasBatchCategoryMetadata, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const ORIGINAL_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const ADVANCED_OPTIONS: CanvasBatchCategoryMetadata["form"]["advanced_options"] = [
    { field: "allow_clear_water", default: false, label: "成品图里可以出现清水", description: "开=允许出现盛水、水珠等静态清水画面；关=画面完全不出现水。" },
    { field: "forbid_pouring_and_heating", default: true, label: "不出现倒水、加热等动作画面", description: "开=禁止一切倾倒、加热动作；关=允许出现。" },
    { field: "missing_d_no_retake", default: true, label: "拍摄角度不全时直接继续", description: "开=某个角度（A/B/C/D）的原图缺失就按现有原图继续，不要求补拍；关=缺角度时要求补拍。" },
];
const DIMENSION_FIELDS: CanvasBatchCategoryMetadata["form"]["dimensions"]["fields"] = [
    { key: "length_cm", label: "长", unit: "厘米", minimum: 1, maximum: 9999 },
    { key: "width_cm", label: "宽", unit: "厘米", minimum: 1, maximum: 9999 },
    { key: "height_cm", label: "高", unit: "厘米", minimum: 1, maximum: 9999 },
];
const CUP: CanvasBatchCategoryMetadata = {
    key: "杯类",
    display_name: "杯类",
    product_noun: "杯子",
    form: {
        dimensions: { required: ["height_cm"], fields: DIMENSION_FIELDS },
        image_counts: { main: { default: 6, minimum: 1, maximum: 30 }, detail: { default: 8, minimum: 1, maximum: 30 } },
        handheld: { main: { default: 2, minimum: 0 }, detail: { default: 1, minimum: 0 } },
        advanced_options: ADVANCED_OPTIONS,
    },
};
const PLATE: CanvasBatchCategoryMetadata = {
    ...CUP,
    key: "盘子",
    display_name: "盘子",
    product_noun: "盘子",
    form: { ...CUP.form, dimensions: { ...CUP.form.dimensions, required: ["length_cm", "width_cm", "height_cm"] } },
};
const CATALOG: CanvasBatchCategoryCatalog = { contractHash: BATCH_INTAKE_CONTRACT_SHA256, categories: [CUP, PLATE] };

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
                ...categoryDefaultPatch(CUP, BATCH_INTAKE_CONTRACT_SHA256),
                productHeightCm: 25,
                mainImageCount: 6,
                detailImageCount: 8,
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

    test("keeps category-driven dimensions, image counts, and hand counts through UTF-8 JSON persistence", () => {
        const serialized = JSON.stringify(batchInfo("card", { productLengthCm: 12, productWidthCm: 10, handheldMainCount: 6, handheldDetailCount: 8 }).metadata);
        const state = readBatchIntakeState(JSON.parse(serialized));
        expect(state).toMatchObject({
            status: "draft",
            category: "杯类",
            contractHash: BATCH_INTAKE_CONTRACT_SHA256,
            productType: "杯子",
            productLengthCm: 12,
            productWidthCm: 10,
            productHeightCm: 25,
            allowClearWater: false,
            prohibitPouringAndHeating: true,
            skipMissingDAngle: true,
            mainImageCount: 6,
            detailImageCount: 8,
            handheldMainCount: 6,
            handheldDetailCount: 8,
        });
        expect(new TextDecoder().decode(new TextEncoder().encode(serialized))).toBe(serialized);
    });

    test("uses recipe count boundaries and enforces each dynamic hand-count ceiling", () => {
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { productHeightCm: 0 }).metadata), CUP, CATALOG.contractHash)).toEqual({ ok: false, message: "高必须填写 1–9999 的整数厘米。" });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { productHeightCm: 25.5 }).metadata), CUP, CATALOG.contractHash)).toEqual({ ok: false, message: "高必须填写 1–9999 的整数厘米。" });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { handheldMainCount: 0, handheldDetailCount: 0 }).metadata), CUP, CATALOG.contractHash)).toMatchObject({
            ok: true,
            facts: { handheld_main: 0, handheld_detail: 0 },
        });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { mainImageCount: 1, detailImageCount: 1, handheldMainCount: 1, handheldDetailCount: 1 }).metadata), CUP, CATALOG.contractHash)).toMatchObject({ ok: true });
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { mainImageCount: 30, detailImageCount: 30, handheldMainCount: 30, handheldDetailCount: 30 }).metadata), CUP, CATALOG.contractHash)).toMatchObject({ ok: true });
        for (const patch of [{ mainImageCount: 0 }, { mainImageCount: 31 }, { mainImageCount: -1 }, { mainImageCount: 1.5 }, { mainImageCount: "6" }, { detailImageCount: 0 }, { detailImageCount: 31 }]) {
            expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", patch).metadata), CUP, CATALOG.contractHash).ok).toBe(false);
        }
        for (const patch of [{ handheldMainCount: -1 }, { mainImageCount: 6, handheldMainCount: 7 }, { detailImageCount: 8, handheldDetailCount: 9 }, { handheldDetailCount: 1.5 }]) {
            expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", patch).metadata), CUP, CATALOG.contractHash).ok).toBe(false);
        }
        expect(validateBatchIntakeFacts(readBatchIntakeState(batchInfo("card", { mainImageCount: 3, handheldMainCount: 4 }).metadata), CUP, CATALOG.contractHash)).toEqual({ ok: false, message: "主图手持必须填写 0–3 的整数。" });
        const plateState = readBatchIntakeState(batchInfo("plate", { ...categoryDefaultPatch(PLATE, CATALOG.contractHash), productHeightCm: 4 }).metadata);
        expect(validateBatchIntakeFacts(plateState, PLATE, CATALOG.contractHash)).toEqual({ ok: false, message: "长必须填写 1–9999 的整数厘米。" });
        expect(validateBatchIntakeFacts({ ...plateState, productLengthCm: 30, productWidthCm: 28 }, PLATE, CATALOG.contractHash)).toMatchObject({ ok: true });
    });

    test("keeps entered dimensions across category switches and revalidates the new required set", () => {
        const changedPlate: CanvasBatchCategoryMetadata = {
            ...PLATE,
            form: {
                ...PLATE.form,
                image_counts: { main: { default: 3, minimum: 1, maximum: 30 }, detail: { default: 2, minimum: 1, maximum: 30 } },
                handheld: { main: { default: 3, minimum: 0 }, detail: { default: 2, minimum: 0 } },
                advanced_options: PLATE.form.advanced_options.map((option) => option.field === "allow_clear_water" ? { ...option, default: true } : option),
            },
        };
        const cupState = readBatchIntakeState(batchInfo("cup", {
            mainImageCount: 9,
            detailImageCount: 7,
            handheldMainCount: 5,
            handheldDetailCount: 4,
            allowClearWater: false,
        }).metadata);
        const switchedToPlate = { ...cupState, ...categorySwitchPatch(cupState, changedPlate, CATALOG.contractHash) };
        expect(switchedToPlate).toMatchObject({
            category: "盘子",
            productLengthCm: undefined,
            productWidthCm: undefined,
            productHeightCm: 25,
            mainImageCount: 3,
            detailImageCount: 2,
            handheldMainCount: 3,
            handheldDetailCount: 2,
            allowClearWater: true,
        });
        expect(validateBatchIntakeFacts(switchedToPlate, changedPlate, CATALOG.contractHash)).toEqual({
            ok: false,
            message: "长必须填写 1–9999 的整数厘米。",
        });

        const plateState = readBatchIntakeState(batchInfo("plate", {
            ...categoryDefaultPatch(PLATE, CATALOG.contractHash),
            productLengthCm: 30,
            productWidthCm: 28,
            productHeightCm: 4,
        }).metadata);
        const switchedToCup = { ...plateState, ...categorySwitchPatch(plateState, CUP, CATALOG.contractHash) };
        expect(switchedToCup).toMatchObject({
            category: "杯类",
            productLengthCm: 30,
            productWidthCm: 28,
            productHeightCm: 4,
        });
        expect(validateBatchIntakeFacts(switchedToCup, CUP, CATALOG.contractHash)).toMatchObject({ ok: true });
        expect(validateBatchIntakeFacts({ ...switchedToCup, productLengthCm: undefined, productWidthCm: undefined }, CUP, CATALOG.contractHash)).toMatchObject({ ok: true });
    });

    test("loads the authenticated category catalog and rejects unavailable or mismatched contracts", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const catalog = await fetchBatchCategoryCatalog("existing-canvas-token", async (input, init) => {
            calls.push({ url: String(input), init });
            return new Response(JSON.stringify({ ok: true, ...CATALOG }), { status: 200, headers: { "content-type": "application/json" } });
        });
        expect(catalog).toEqual(CATALOG);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(BATCH_CATEGORY_URL);
        expect(calls[0]?.init?.method).toBe("GET");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("existing-canvas-token");

        await expect(fetchBatchCategoryCatalog("", async () => new Response())).rejects.toThrow(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
        await expect(
            fetchBatchCategoryCatalog("token", async () => new Response(JSON.stringify({ ok: true, contractHash: "0".repeat(64), categories: CATALOG.categories }), { status: 200 })),
        ).rejects.toThrow(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
        await expect(fetchBatchCategoryCatalog("token", async () => new Response("offline", { status: 503 }))).rejects.toThrow(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    });

    test("applies endpoint defaults to a plate payload while keeping copy, defaults, and ranges outside the digest", () => {
        const changedPlate: CanvasBatchCategoryMetadata = {
            ...PLATE,
            form: {
                ...PLATE.form,
                image_counts: { main: { default: 3, minimum: 1, maximum: 30 }, detail: { default: 2, minimum: 1, maximum: 30 } },
                handheld: { main: { default: 3, minimum: 0 }, detail: { default: 2, minimum: 0 } },
                advanced_options: PLATE.form.advanced_options.map((option) => option.field === "allow_clear_water" ? { ...option, default: true, label: "端点更新后的文案" } : option),
            },
        };
        const defaults = categoryDefaultPatch(changedPlate, CATALOG.contractHash);
        const state = readBatchIntakeState(batchInfo("plate", { ...defaults, productLengthCm: 30, productWidthCm: 28, productHeightCm: 4 }).metadata);
        const command = buildBatchIntakeCommand(state, changedPlate, CATALOG.contractHash, { workflowNodeId: "machine", sourceImageNodeIds: ["image"] }, "request-plate", 1_000);
        expect(command.state).toMatchObject({
            category: "盘子",
            contractHash: BATCH_INTAKE_CONTRACT_SHA256,
            handheldMainCount: 3,
            handheldDetailCount: 2,
            mainImageCount: 3,
            detailImageCount: 2,
            allowClearWater: true,
            facts: {
                product_type: "盘子",
                length_cm: 30,
                width_cm: 28,
                height_cm: 4,
                main_image_count: 3,
                detail_image_count: 2,
                handheld_main: 3,
                handheld_detail: 2,
                allow_clear_water: true,
            },
        });
    });

    test("renders a category dropdown, dynamic hand summary, collapsed advanced options, and fail-closed metadata state", () => {
        const readyHtml = renderToStaticMarkup(
            createElement(CanvasBatchInfoNode, {
                node: batchInfo("card", { mainImageCount: 3, detailImageCount: 2, handheldMainCount: 3, handheldDetailCount: 2 }),
                connectedOriginalCount: 1,
                connectedStyleReferenceCount: 0,
                connectedOriginalFileNames: ["cup.png"],
                connectedStyleReferenceFileNames: [],
                categoryCatalog: CATALOG,
                categoryCatalogStatus: "ready",
                onChange: () => undefined,
                onRegister: () => undefined,
                onSupplementStyle: () => undefined,
            }),
        );
        expect(readyHtml).toContain("<select");
        expect(readyHtml).toContain("杯类");
        expect(readyHtml).toContain("盘子");
        expect(readyHtml).toContain('aria-label="主图张数"');
        expect(readyHtml).toContain('aria-label="详情张数"');
        expect(readyHtml).toContain("共 5 张");
        expect(readyHtml).toContain("手持：主 3 + 详情 2");
        expect(readyHtml).toContain("高级选项");
        expect(readyHtml).toContain("已按【杯类】默认设置");
        expect(readyHtml).not.toContain(ADVANCED_OPTIONS[0]!.description);
        const loweredCountHtml = renderToStaticMarkup(
            createElement(CanvasBatchInfoNode, {
                node: batchInfo("card", { mainImageCount: 3, handheldMainCount: 4 }),
                connectedOriginalCount: 1,
                connectedStyleReferenceCount: 0,
                connectedOriginalFileNames: ["cup.png"],
                connectedStyleReferenceFileNames: [],
                categoryCatalog: CATALOG,
                categoryCatalogStatus: "ready",
                onChange: () => undefined,
                onRegister: () => undefined,
                onSupplementStyle: () => undefined,
            }),
        );
        expect(loweredCountHtml).toContain('max="3"');
        expect(loweredCountHtml).toContain("主图手持不能超过本批 3 张；请先把主图手持改小。");

        const failedHtml = renderToStaticMarkup(
            createElement(CanvasBatchInfoNode, {
                node: batchInfo(),
                connectedOriginalCount: 1,
                connectedStyleReferenceCount: 0,
                connectedOriginalFileNames: ["cup.png"],
                connectedStyleReferenceFileNames: [],
                categoryCatalogStatus: "error",
                onChange: () => undefined,
                onRegister: () => undefined,
                onSupplementStyle: () => undefined,
            }),
        );
        expect(failedHtml).toContain(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
        expect(failedHtml.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
    });

    test("expands recipe copy and maps every advanced switch in both directions without semantic inversion", () => {
        const state = readBatchIntakeState(batchInfo().metadata);
        const collapsed = renderToStaticMarkup(
            createElement(CanvasBatchAdvancedOptions, {
                category: CUP,
                state,
                editable: true,
                expanded: false,
                onExpandedChange: () => undefined,
                onChange: () => undefined,
            }),
        );
        const expanded = renderToStaticMarkup(
            createElement(CanvasBatchAdvancedOptions, {
                category: CUP,
                state,
                editable: true,
                expanded: true,
                onExpandedChange: () => undefined,
                onChange: () => undefined,
            }),
        );
        expect(collapsed).not.toContain(ADVANCED_OPTIONS[0]!.description);
        for (const option of ADVANCED_OPTIONS) {
            expect(expanded).toContain(option.label);
            expect(expanded).toContain(option.description);
            expect(advancedOptionPatch(option.field, true)).toEqual({ [option.field === "allow_clear_water" ? "allowClearWater" : option.field === "forbid_pouring_and_heating" ? "prohibitPouringAndHeating" : "skipMissingDAngle"]: true });
            expect(advancedOptionPatch(option.field, false)).toEqual({ [option.field === "allow_clear_water" ? "allowClearWater" : option.field === "forbid_pouring_and_heating" ? "prohibitPouringAndHeating" : "skipMissingDAngle"]: false });
        }
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
        const command = buildBatchIntakeCommand(state, CUP, CATALOG.contractHash, { workflowNodeId: "machine", sourceImageNodeIds: ["原图-一"] }, "request-001", 1_000);
        expect(command.content).toBe("# batch-intake\n# request-id: request-001\n# requested-at: 1000\nbuild: batch");
        expect(command.state).toMatchObject({
            status: "queued",
            requestId: "request-001",
            requestedAt: 1_000,
            workflowNodeId: "machine",
            sourceImageNodeIds: ["原图-一"],
            category: "杯类",
            contractHash: BATCH_INTAKE_CONTRACT_SHA256,
            facts: {
                product_type: "杯子",
                length_cm: null,
                width_cm: null,
                height_cm: 25,
                main_image_count: 6,
                detail_image_count: 8,
                handheld_main: 2,
                handheld_detail: 1,
                allow_clear_water: false,
                forbid_pouring_and_heating: true,
                missing_d_no_retake: true,
            },
        });
        expect(Object.keys(command.state.facts)).toEqual(["product_type", "length_cm", "width_cm", "height_cm", "main_image_count", "detail_image_count", "handheld_main", "handheld_detail", "allow_clear_water", "forbid_pouring_and_heating", "missing_d_no_retake"]);
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
        const queued = buildBatchIntakeCommand(readBatchIntakeState(batchInfo().metadata), CUP, CATALOG.contractHash, { workflowNodeId: "machine", sourceImageNodeIds: ["image"] }, "request-001", 1_000).state;
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
