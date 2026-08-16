import type { AiTextMessage } from "@/services/api/image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { buildGlobalResourceReferences, getGenerationResourceNodes, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    label?: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const globalReferences = buildGlobalResourceReferences(nodes);
    const globalReferenceByNodeId = new Map(globalReferences.map((reference) => [reference.nodeId, reference]));
    const inputs = buildGenerationInputs(getGenerationResourceNodes(nodeId, nodes, connections), globalReferenceByNodeId);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceImageIds = new Set(referenceImages.map((image) => image.id));
    const referenceVideos: ReferenceVideo[] = [];
    const referenceAudios: ReferenceAudio[] = [];
    const referencedNodeIds = new Set<string>();
    const textBlocks: string[] = [];
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input?.label) {
            if (!referencedNodeIds.has(input.nodeId)) {
                referencedNodeIds.add(input.nodeId);
                if (input.type === "text") textBlocks.push(`【${input.label}】\n${input.text || ""}`);
                if (input.type === "image" && input.image && !referenceImageIds.has(input.image.id)) {
                    referenceImageIds.add(input.image.id);
                    referenceImages.push(input.image);
                }
                if (input.type === "video" && input.video) referenceVideos.push(input.video);
                if (input.type === "audio" && input.audio) referenceAudios.push(input.audio);
            }
            nextPrompt += input.type === "text" ? `【${input.label}】` : input.label;
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    if (!hasToken) {
        return {
            prompt,
            referenceImages,
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: referenceImages.length,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: textBlocks.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const globalReferenceByNodeId = new Map(buildGlobalResourceReferences(nodes).map((reference) => [reference.nodeId, reference]));
    return buildGenerationInputs(getGenerationResourceNodes(nodeId, nodes, connections), globalReferenceByNodeId);
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function buildGenerationInputs(resourceNodes: CanvasNodeData[], globalReferenceByNodeId: Map<string, CanvasResourceReference>) {
    const seenNodeIds = new Set<string>();
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        if (seenNodeIds.has(node.id)) return [];
        seenNodeIds.add(node.id);
        const label = globalReferenceByNodeId.get(node.id)?.label;
        const image = readReferenceImage(node, label);
        if (image) return [{ nodeId: node.id, type: "image", title: node.title, label, image }];
        const video = readReferenceVideo(node, label);
        if (video) return [{ nodeId: node.id, type: "video", title: node.title, label, video }];
        const audio = readReferenceAudio(node, label);
        if (audio) return [{ nodeId: node.id, type: "audio", title: node.title, label, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text", title: node.title, label, text }];
        return [];
    });
}

function readReferenceImage(node: CanvasNodeData, label?: string): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        label,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData, label?: string): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        label,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData, label?: string): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        label,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
