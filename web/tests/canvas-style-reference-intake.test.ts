import { describe, expect, test } from "bun:test";

import {
    StyleReferenceIntegrityError,
    buildStyleReferenceCommand,
    expireStyleReferenceState,
    prepareStyleReferenceCommand,
    readStyleReferenceState,
    resetInterruptedStyleReferenceIntakes,
    resolveStyleReferenceSelection,
    uploadStyleReferences,
} from "../src/lib/canvas/canvas-style-reference-intake";
import { CanvasNodeType, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const sourceFile: CanvasBatchSourceFile = { name: "风格.jpg", size: 3, type: "image/jpeg", lastModified: 1_000, sha256: SHA };

function card(): CanvasNodeData {
    return {
        id: "card",
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 0, y: 0 },
        width: 440,
        height: 540,
        metadata: { batchIntake: { status: "completed", productType: "杯子", allowClearWater: true, prohibitPouringAndHeating: true, skipMissingDAngle: true, mainImageCount: 6, detailImageCount: 8, handheldMainCount: 2, handheldDetailCount: 1, receipt: { batchId: "cup", imageCount: 2, facts: {} } } },
    } as CanvasNodeData;
}

function image(): CanvasNodeData {
    return { id: "style", type: CanvasNodeType.Image, title: "风格.jpg", position: { x: -300, y: 0 }, width: 180, height: 180, metadata: { content: "blob:style", storageKey: "image:style", sourceFile } };
}

const connection = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

describe("style reference supplement", () => {
    test("selects only stored disk images connected directly into a completed card", () => {
        const info = card();
        const style = image();
        expect(resolveStyleReferenceSelection(info.id, [info, style], [connection(style.id, info.id)])).toEqual({ ok: true, batchId: "cup", sourceNodeIds: ["style"] });
        expect(resolveStyleReferenceSelection(info.id, [info, style], [])).toEqual({ ok: false, message: "请把至少 1 张风格参考图直接连到这张信息卡。" });
    });

    test("builds one supplement command with exact source proofs", () => {
        const command = buildStyleReferenceCommand(card(), [image()], "style-request-001", 1_000);
        expect(command.content).toContain("supplement: style-references");
        expect(command.state).toMatchObject({ status: "queued", requestId: "style-request-001", batchId: "cup" });
        expect(command.state.sources).toEqual([{ nodeId: "style", name: "风格.jpg", mimeType: "image/jpeg", size: 3, sha256: SHA }]);
    });

    test("service not running is reported before a request id or timer is created", async () => {
        let ids = 0;
        let clocks = 0;
        let healthCalls = 0;
        const result = await prepareStyleReferenceCommand({
            card: card(),
            sources: [image()],
            token: "canvas-token",
            requestIdFactory: () => `${++ids}`,
            clock: () => ++clocks,
            fetcher: async () => { healthCalls += 1; throw new Error("offline"); },
        });
        expect(result).toEqual({ ok: false, message: "本机画布工作台没有启动，本次尚未发出。" });
        expect(ids).toBe(0);
        expect(clocks).toBe(0);
        expect(healthCalls).toBe(1);
    });

    test("dead style worker is reported before a request id or timer is created", async () => {
        let ids = 0;
        let clocks = 0;
        let healthCalls = 0;
        const result = await prepareStyleReferenceCommand({
            card: card(),
            sources: [image()],
            token: "canvas-token",
            requestIdFactory: () => `${++ids}`,
            clock: () => ++clocks,
            fetcher: async () => { healthCalls += 1; return new Response(JSON.stringify({ workers: { style_reference_intake: { status: "stopped", lastStatusAt: 1_000 } } }), { status: 503 }); },
        });
        expect(result).toEqual({ ok: false, message: "本机风格接单工人已停止，需要重新启动画布服务后再试。" });
        expect(ids).toBe(0);
        expect(clocks).toBe(0);
        expect(healthCalls).toBe(1);
    });

    test("canvas reconnecting is reported before a request id or timer is created", async () => {
        let ids = 0;
        let clocks = 0;
        let healthCalls = 0;
        const result = await prepareStyleReferenceCommand({
            card: card(),
            sources: [image()],
            token: "canvas-token",
            requestIdFactory: () => `${++ids}`,
            clock: () => ++clocks,
            fetcher: async () => { healthCalls += 1; return new Response(JSON.stringify({ workers: { style_reference_intake: { status: "waiting_canvas", lastStatusAt: 1_000 } } }), { status: 503 }); },
        });
        expect(result).toEqual({ ok: false, message: "画布正在重新连接，本次尚未发出；连接稳定后请重新点击。" });
        expect(ids).toBe(0);
        expect(clocks).toBe(0);
        expect(healthCalls).toBe(1);
    });

    test("healthy worker starts one timer and reports a distinct eight-second acknowledgement timeout", async () => {
        let ids = 0;
        let clocks = 0;
        let healthCalls = 0;
        const result = await prepareStyleReferenceCommand({
            card: card(),
            sources: [image()],
            token: "canvas-token",
            requestIdFactory: () => `style-request-00${++ids}`,
            clock: () => 1_000 + clocks++,
            fetcher: async () => { healthCalls += 1; return new Response(JSON.stringify({ workers: { style_reference_intake: { status: "running", lastStatusAt: 1_000 } } }), { status: 200 }); },
        });
        expect(result.ok).toBe(true);
        expect(ids).toBe(1);
        expect(clocks).toBe(1);
        expect(healthCalls).toBe(1);
        if (!result.ok) throw new Error(result.message);
        expect(expireStyleReferenceState(result.command.state, 9_000)).toMatchObject({
            status: "failed",
            errorMessage: "工作台在线，但本次请求在 8 秒内没有获得确认，已停止。",
        });
    });

    test("preflights all browser blobs, uploads exact bytes once, and verifies server SHA", async () => {
        const calls: RequestInit[] = [];
        const uploaded = await uploadStyleReferences({
            uploadBaseUrl: "http://127.0.0.1:17373",
            batchId: "cup",
            requestId: "style-request-001",
            token: "canvas-token",
            sources: [{ nodeId: "style", sourceFile, blob: new Blob(["abc"], { type: "image/jpeg" }) }],
            fetcher: async (_input, init = {}) => {
                calls.push(init);
                return new Response(JSON.stringify({ ok: true, sha256: SHA, completed: true }), { status: 200 });
            },
        });
        expect(uploaded).toEqual([{ nodeId: "style", sha256: SHA }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.body).toBeInstanceOf(Blob);
    });

    test("a mismatch hard-stops before any POST and interrupted uploads never auto-resume", async () => {
        let calls = 0;
        await expect(
            uploadStyleReferences({
                uploadBaseUrl: "http://127.0.0.1:17373",
                batchId: "cup",
                requestId: "style-request-001",
                token: "canvas-token",
                sources: [{ nodeId: "style", sourceFile, blob: new Blob(["changed"], { type: "image/jpeg" }) }],
                fetcher: async () => {
                    calls += 1;
                    return new Response();
                },
            }),
        ).rejects.toBeInstanceOf(StyleReferenceIntegrityError);
        expect(calls).toBe(0);

        const info = card();
        info.metadata!.styleReferenceIntake = { status: "uploading", requestId: "old", batchId: "cup", requestedAt: 1_000, sources: [] };
        expect(readStyleReferenceState(resetInterruptedStyleReferenceIntakes([info])[0]!.metadata)).toMatchObject({ status: "failed", requestId: "old" });
    });
});
