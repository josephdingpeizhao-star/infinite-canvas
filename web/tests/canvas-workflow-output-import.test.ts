import { describe, expect, test } from "bun:test";

import { importProductionOutput, productionOutputNeedsImport } from "../src/lib/canvas/canvas-workflow-output-import";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const PNG = new Blob(["production-png"], { type: "image/png" });
const SHA = "a3b35879b483c255c955d85a34e301e2b83ff95e521fcc29a7d538cef45e3441";

function outputNode(storageKey?: string): CanvasNodeData {
    return {
        id: "wfprod-output:cup:main_01",
        type: CanvasNodeType.Image,
        title: "真实 · 主图 1",
        position: { x: 600, y: 0 },
        width: 176,
        height: 176,
        metadata: {
            content: "",
            storageKey,
            workflowProductionOutput: {
                workflowNodeId: "machine",
                batchId: "cup",
                configId: "main_01",
                index: 1,
                sha256: SHA,
                downloadUrl: "http://127.0.0.1:17373/workflow-production/cup/outputs/main_01",
                byteCount: PNG.size,
            },
        },
    };
}

describe("production output browser persistence", () => {
    test("imports exact bytes into browser image storage and never creates a data URI", async () => {
        let uploaded: Blob | undefined;
        const result = await importProductionOutput(outputNode(), "canvas-token", {
            fetcher: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png", "x-content-sha256": SHA } }),
            uploader: async (blob) => {
                uploaded = blob;
                return { url: "blob:persisted", storageKey: "image:persisted", width: 1254, height: 1254, bytes: blob.size, mimeType: "image/png" };
            },
        });
        expect(await uploaded?.text()).toBe("production-png");
        expect(result).toMatchObject({ content: "blob:persisted", storageKey: "image:persisted", naturalWidth: 1254, naturalHeight: 1254, status: "success" });
        expect(result.content.startsWith("data:")).toBe(false);
    });

    test("rejects wrong bytes before browser storage and does not retry", async () => {
        let uploads = 0;
        await expect(
            importProductionOutput(outputNode(), "canvas-token", {
                fetcher: async () => new Response(new Blob(["changed"], { type: "image/png" }), { status: 200, headers: { "x-content-sha256": SHA } }),
                uploader: async () => {
                    uploads += 1;
                    throw new Error("must not upload");
                },
            }),
        ).rejects.toThrow("正式图片完整性核对失败");
        expect(uploads).toBe(0);
    });

    test("rejects a non-loopback route or missing server hash proof", async () => {
        const unsafe = outputNode();
        unsafe.metadata!.workflowProductionOutput!.downloadUrl = "https://example.com/main.png";
        await expect(importProductionOutput(unsafe, "canvas-token", { fetcher: async () => new Response(PNG), uploader: async () => { throw new Error("must not upload"); } })).rejects.toThrow("正式图片接收地址无效");
        await expect(importProductionOutput(outputNode(), "canvas-token", { fetcher: async () => new Response(PNG), uploader: async () => { throw new Error("must not upload"); } })).rejects.toThrow("正式图片完整性核对失败");
    });

    test("imports only production image nodes that have not reached localforage", () => {
        expect(productionOutputNeedsImport(outputNode())).toBe(true);
        expect(productionOutputNeedsImport(outputNode("image:ready"))).toBe(false);
        expect(productionOutputNeedsImport({ ...outputNode(), type: CanvasNodeType.Text })).toBe(false);
    });
});
