import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildCanvasResourceReferences, buildGlobalResourceReferences } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, type: CanvasNodeType, content?: string): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: content ? { content } : undefined,
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

describe("UX-02 全局资源编号", () => {
    test("按全画布顺序独立标注图片与文本且全部保持非激活", () => {
        const references = buildGlobalResourceReferences([
            node("image-a", CanvasNodeType.Image, "image-a"),
            node("image-b", CanvasNodeType.Image, "image-b"),
            node("text-a", CanvasNodeType.Text, "text-a"),
            node("image-c", CanvasNodeType.Image, "image-c"),
        ]);

        expect(references.map(({ nodeId, label, active }) => ({ nodeId, label, active }))).toEqual([
            { nodeId: "image-a", label: "图片1", active: false },
            { nodeId: "image-b", label: "图片2", active: false },
            { nodeId: "text-a", label: "文本1", active: false },
            { nodeId: "image-c", label: "图片3", active: false },
        ]);
    });

    test("无资源内容时返回空列表", () => {
        expect(buildGlobalResourceReferences([node("empty-image", CanvasNodeType.Image), node("empty-text", CanvasNodeType.Text)])).toEqual([]);
    });
});

describe("UX-03 单轨全局编号", () => {
    test("激活上下文内只变 active 状态且上下文内外都保持全局编号", () => {
        const nodes = [
            node("image-a", CanvasNodeType.Image, "image-a"),
            node("image-b", CanvasNodeType.Image, "image-b"),
            node("image-c", CanvasNodeType.Image, "image-c"),
        ];
        const connections = [connection("image-b", "image-c")];

        const mergedReferences = buildCanvasResourceReferences(nodes, connections, "image-c");
        expect(mergedReferences.map(({ nodeId, label, active }) => ({ nodeId, label, active }))).toEqual([
            { nodeId: "image-a", label: "图片1", active: false },
            { nodeId: "image-b", label: "图片2", active: true },
            { nodeId: "image-c", label: "图片3", active: false },
        ]);
    });
});

describe("UX-03 单角标源码接线", () => {
    const canvasNodeSource = readFileSync(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url), "utf8");
    const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

    test("角标恒在左上且激活只改变配色", () => {
        expect(canvasNodeSource).toContain("{resourceLabel ? <ResourceLabelBadge reference={resourceLabel} /> : null}");
        expect(canvasNodeSource.match(/<ResourceLabelBadge reference=/g)).toHaveLength(1);

        const badgeSource = canvasNodeSource.slice(canvasNodeSource.indexOf("function ResourceLabelBadge"), canvasNodeSource.indexOf("function ImageNodeContent"));
        expect(badgeSource).toContain("left-2 top-2");
        expect(badgeSource).not.toContain('reference.active ? "right-2 top-2" : "left-2 top-2"');
        expect(badgeSource).not.toContain("right-2 top-2");
        expect(badgeSource).toContain('reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"');
        expect(canvasNodeSource).not.toContain("globalResourceLabel");
        expect(projectSource).not.toContain("globalResourceLabel");
    });
});
