import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildImageReferencePromptText } from "../src/lib/image-reference-prompt";
import { buildSeedancePromptText } from "../src/lib/seedance-video";
import { buildNodeMentionReferences } from "../src/lib/canvas/canvas-resource-references";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
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

describe("UX-03 @ 候选使用全局编号", () => {
    test("候选恰为当前连线集合并沿用全局编号", () => {
        const nodes = [
            node("image-a", CanvasNodeType.Image, "image-a"),
            node("video-a", CanvasNodeType.Video, "video-a"),
            node("image-b", CanvasNodeType.Image, "image-b"),
            node("text-a", CanvasNodeType.Text, "text-a"),
            node("target", CanvasNodeType.Config),
        ];
        const references = buildNodeMentionReferences(node("target", CanvasNodeType.Config), nodes, [connection("image-a", "target"), connection("video-a", "target"), connection("text-a", "target")]);

        expect(references.map(({ nodeId, label, active }) => ({ nodeId, label, active }))).toEqual([
            { nodeId: "image-a", label: "图片1", active: true },
            { nodeId: "video-a", label: "视频1", active: true },
            { nodeId: "text-a", label: "文本1", active: true },
        ]);
    });

    test("退役通道的专用函数已从两个生产模块清理", () => {
        const sourceFiles = [
            readFileSync(new URL("../src/lib/canvas/canvas-resource-references.ts", import.meta.url), "utf8"),
            readFileSync(new URL("../src/components/canvas/canvas-node-generation.ts", import.meta.url), "utf8"),
        ];
        const retiredNames = [["extract", "ReferencedImageNodeIds"].join(""), ["buildGlobal", "ImageGenerationInputs"].join("")];

        for (const source of sourceFiles) {
            for (const retiredName of retiredNames) expect(source).not.toContain(retiredName);
        }
    });
});

describe("UX-03 普通节点纯连线送图", () => {
    const nodes = [node("image-a", CanvasNodeType.Image, "image-a"), node("image-b", CanvasNodeType.Image, "image-b"), node("target", CanvasNodeType.Text), node("image-d", CanvasNodeType.Image, "image-d")];
    const connections = [connection("image-a", "target"), connection("image-b", "target")];

    test("参考图恰为连线图片并保持顺序与全局标签", () => {
        const connectedOnly = buildNodeGenerationContext("target", nodes, connections, "普通正文");
        expect(connectedOnly.referenceImages.map(({ id, label }) => ({ id, label }))).toEqual([
            { id: "image-a", label: "图片1" },
            { id: "image-b", label: "图片2" },
        ]);
        expect(connectedOnly.imageCount).toBe(2);
    });

    test("提示词中的未连线图片编号只作普通文字且不会送图", () => {
        const referenced = buildNodeGenerationContext("target", nodes, connections, "请参考图片3");
        expect(referenced.referenceImages.map(({ id, label }) => ({ id, label }))).toEqual([
            { id: "image-a", label: "图片1" },
            { id: "image-b", label: "图片2" },
        ]);
        expect(referenced.referenceImages.map((image) => image.id)).not.toContain("image-d");
        expect(referenced.imageCount).toBe(2);
    });
});

describe("UX-03 Config 统一送图", () => {
    test("无 token 时连线图片全部参与，指向未连线节点的 token 被忽略", () => {
        const config = { ...node("config", CanvasNodeType.Config), metadata: { composerContent: "已启用组装提示词" } };
        const nodes = [
            node("image-a", CanvasNodeType.Image, "image-a"),
            node("text-a", CanvasNodeType.Text, "text-a"),
            node("image-d", CanvasNodeType.Image, "image-d"),
            node("text-b", CanvasNodeType.Text, "text-b"),
            config,
        ];
        const connections = [connection("image-a", "config"), connection("text-b", "config")];

        const withoutToken = buildNodeGenerationContext("config", nodes, connections, "普通正文");
        expect(withoutToken.referenceImages.map(({ id, label }) => ({ id, label }))).toEqual([{ id: "image-a", label: "图片1" }]);
        expect(withoutToken.prompt).toBe("普通正文");
        expect(withoutToken.imageCount).toBe(1);

        const withTokens = buildNodeGenerationContext("config", nodes, connections, "编辑 @[node:image-d]，说明见 @[node:text-b]");
        expect(withTokens.referenceImages.map(({ id, label }) => ({ id, label }))).toEqual([{ id: "image-a", label: "图片1" }]);
        expect(withTokens.prompt).toBe("编辑 ，说明见 【文本2】\n\n【文本2】\ntext-b");
        expect(withTokens.prompt).not.toContain("图片2");
        expect({ imageCount: withTokens.imageCount, textCount: withTokens.textCount }).toEqual({ imageCount: 1, textCount: 1 });
    });
});

describe("UX-03 编号注入保留独立页回落", () => {
    test("图片引用优先使用自带标签，缺省时逐字回落位置编号", () => {
        const base = { id: "image-a", name: "a.png", type: "image/png", dataUrl: "image-a" };
        expect(buildImageReferencePromptText("  生成图片  ", [{ ...base, label: "图片6" }])).toBe("参考图片编号：图片6。请按这些编号理解提示词中的图片引用。\n\n生成图片");
        expect(buildImageReferencePromptText("  生成图片  ", [base])).toBe("参考图片编号：图片1。请按这些编号理解提示词中的图片引用。\n\n生成图片");
    });

    test("视频链三类引用优先使用自带标签，缺省时逐字回落各类位置编号", () => {
        const image = { id: "image-a", name: "a.png", type: "image/png", dataUrl: "image-a" };
        const video = { id: "video-a", name: "a.mp4", type: "video/mp4", url: "video-a" };
        const audio = { id: "audio-a", name: "a.mp3", type: "audio/mpeg", url: "audio-a" };
        expect(buildSeedancePromptText("  生成视频  ", [{ ...image, label: "图片6" }], [{ ...video, label: "视频3" }], [{ ...audio, label: "音频2" }])).toBe(
            "参考素材编号：图片6、视频3、音频2。请按这些编号理解提示词中的图片、视频和音频引用。\n\n生成视频",
        );
        expect(buildSeedancePromptText("  生成视频  ", [image], [video], [audio])).toBe("参考素材编号：图片1、视频1、音频1。请按这些编号理解提示词中的图片、视频和音频引用。\n\n生成视频");
    });
});

describe("UX-03 组件层接线锚定", () => {
    const configComposerSource = readFileSync(new URL("../src/components/canvas/canvas-config-composer.tsx", import.meta.url), "utf8");
    const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

    test("Config 胶囊第一动作优先使用全局标签", () => {
        const start = configComposerSource.indexOf("function resourceLabel");
        const end = configComposerSource.indexOf("\nfunction ", start);
        const resourceLabelSource = configComposerSource.slice(start, end);

        expect(resourceLabelSource).toContain("function resourceLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {\n    if (input.label) return input.label;");
    });

    test("图片自身生成将自身置前并合并其余参考图", () => {
        expect(projectSource).toContain(
            "const referenceImages = [...(sourceReference ? [sourceReference] : []), ...generationContext.referenceImages.filter((reference) => reference.id !== sourceNode?.id)];",
        );
        expect(projectSource).not.toContain("sourceReference.length ? sourceReference : generationContext.referenceImages");
    });
});
