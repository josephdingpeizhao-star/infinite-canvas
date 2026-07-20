import { describe, expect, test } from "bun:test";

import {
    StyleReferenceIntegrityError,
    buildStyleReferenceCommand,
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
