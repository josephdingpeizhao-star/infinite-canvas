import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasBatchInfoNode } from "../src/components/canvas/canvas-batch-info-node";
import {
    buildStyleReferenceRemovalCommand,
    expireStyleReferenceRemovalState,
    prepareStyleReferenceRemovalCommand,
    readStyleReferenceRemovalState,
    resolveStyleReferenceSelection,
} from "../src/lib/canvas/canvas-style-reference-intake";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";


const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);


function card(status: "draft" | "completed" = "completed"): CanvasNodeData {
    return {
        id: "card",
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 0, y: 0 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status,
                productType: "杯子",
                allowClearWater: true,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                receipt: status === "completed" ? { batchId: "cup", imageCount: 2, facts: {} } : undefined,
            },
        },
    } as CanvasNodeData;
}


function image(id: string, sha256: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: `${id}.jpg`,
        position: { x: -300, y: 0 },
        width: 180,
        height: 180,
        metadata: {
            content: `blob:${id}`,
            storageKey: `image:${id}`,
            sourceFile: {
                name: `${id}.jpg`,
                size: 3,
                type: "image/jpeg",
                lastModified: 1_000,
                sha256,
            },
        },
    };
}


const connection = (fromNodeId: string): CanvasConnection => ({
    id: `${fromNodeId}-card`,
    fromNodeId,
    toNodeId: "card",
});


function renderCard(node: CanvasNodeData, styleNames: string[]) {
    return renderToStaticMarkup(
        createElement(CanvasBatchInfoNode, {
            node,
            connectedOriginalCount: 1,
            connectedStyleReferenceCount: styleNames.length,
            connectedOriginalFileNames: ["product.jpg"],
            connectedStyleReferenceFileNames: styleNames,
            categoryCatalogStatus: "loading",
            onChange: () => undefined,
            onRegister: () => undefined,
            onSupplementStyle: () => undefined,
            onRemoveStyle: () => undefined,
        }),
    );
}


describe("SR-01 style reference governance", () => {
    test("selection fails closed for zero or multiple images and accepts exactly one", () => {
        const info = card();
        const first = image("first", SHA_A);
        const second = image("second", SHA_B);

        expect(resolveStyleReferenceSelection(info.id, [info, first, second], [])).toEqual({
            ok: false,
            message: "请把 1 张风格参考图直接连到这张信息卡。",
        });
        expect(resolveStyleReferenceSelection(info.id, [info, first], [connection(first.id)])).toEqual({
            ok: true,
            batchId: "cup",
            sourceNodeIds: ["first"],
        });
        expect(resolveStyleReferenceSelection(info.id, [info, first, second], [connection(first.id), connection(second.id)])).toEqual({
            ok: false,
            message: "多张风格会互相冲突，每批只登记 1 张。请只保留 1 张后重新补登。",
        });
    });

    test("an active receipt blocks another supplement until removal completes", () => {
        const info = card();
        const style = image("style", SHA_A);
        info.metadata!.styleReferenceIntake = {
            status: "completed",
            sources: [],
            receipt: { batchId: "cup", fileCount: 1, files: ["style.jpg"] },
        };

        expect(resolveStyleReferenceSelection(info.id, [info, style], [connection(style.id)])).toEqual({
            ok: false,
            message: "本批已有风格参考图，如需更换请先移除再补登",
        });

        info.metadata!.styleReferenceRemoval = { status: "completed" };
        expect(resolveStyleReferenceSelection(info.id, [info, style], [connection(style.id)])).toEqual({
            ok: true,
            batchId: "cup",
            sourceNodeIds: ["style"],
        });
    });

    test("removal uses its own command metadata and the same worker health key", async () => {
        const info = card();
        info.metadata!.styleReferenceIntake = {
            status: "completed",
            sources: [],
            receipt: { batchId: "cup", fileCount: 1, files: ["style.jpg"] },
        };
        const command = buildStyleReferenceRemovalCommand(info, "remove-001", 1_000);
        expect(command.content).toBe("# style-reference-remove\n# request-id: remove-001\n# requested-at: 1000\nremove: style-references");
        expect(command.state).toMatchObject({ status: "queued", requestId: "remove-001", batchId: "cup" });
        expect(readStyleReferenceRemovalState({ styleReferenceRemoval: command.state })).toMatchObject({ status: "queued", requestId: "remove-001" });
        expect(expireStyleReferenceRemovalState(command.state, 9_000)).toMatchObject({
            status: "failed",
            errorMessage: "工作台在线，但本次请求在 8 秒内没有获得确认，已停止。",
        });

        const prepared = await prepareStyleReferenceRemovalCommand({
            card: info,
            token: "",
            requestIdFactory: () => "remove-002",
            clock: () => 2_000,
            fetcher: async () => new Response(
                JSON.stringify({ workers: { style_reference_intake: { status: "running", lastStatusAt: 2_000 } } }),
                { status: 200 },
            ),
        });
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) throw new Error(prepared.message);
        expect(prepared.command.state.requestId).toBe("remove-002");
    });

    test("draft card shows a disabled read-only style section", () => {
        const html = renderCard(card("draft"), ["look.jpg"]);
        expect(html).toContain("风格参考");
        expect(html).toContain("已连 1 张");
        expect(html).toContain("look.jpg");
        expect(html).toContain("登记完成后可补登");
        expect(html).toContain("先登记产品原图；批次登记完成后这里才能补登风格参考图（每批 1 张）。");
    });

    test("completed card exposes removal, disables both actions while busy, then shows re-supplement state", () => {
        const active = card();
        active.metadata!.styleReferenceIntake = {
            status: "uploading",
            sources: [],
            receipt: { batchId: "cup", fileCount: 1, files: ["look.jpg"] },
        };
        const busyHtml = renderCard(active, ["look.jpg"]);
        expect(busyHtml).toContain("移除风格参考图");
        expect(busyHtml.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);

        active.metadata!.styleReferenceIntake!.status = "completed";
        active.metadata!.styleReferenceRemoval = {
            status: "completed",
            receipt: { batchId: "cup", fileCount: 1, files: ["look.jpg"] },
        };
        const removedHtml = renderCard(active, ["look.jpg"]);
        expect(removedHtml).toContain("已移除，可重新补登");
        expect(removedHtml).not.toContain(">移除风格参考图<");
    });

    test("project requires one explicit destructive confirmation and wires the independent hook", () => {
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        expect(projectSource).toContain('title: "移除本批风格参考图？"');
        expect(projectSource).toContain("全部移入 Windows 系统回收站");
        expect(projectSource).toContain('okText: "确认移除"');
        expect(projectSource).toContain("styleReferenceRemoval.requestRemoval(nodeId)");
        expect(projectSource).toContain("onRemoveStyle={confirmStyleReferenceRemoval}");
    });
});
