import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

export const MAX_MATERIAL_UPLOAD_FILES = 20;
export const MATERIAL_UPLOAD_ACCEPT = "image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";

export type MaterialFileKind = "image" | "video" | "audio";
export type MaterialUploadMode = "single" | "multiple";

type MaterialUploadBatchOptions = {
    files: File[];
    mode: MaterialUploadMode;
    anchor: Position;
    uploadFile: (file: File, kind: MaterialFileKind, oneBasedIndex: number) => Promise<CanvasNodeData>;
    commitNode: (update: (current: CanvasNodeData[]) => CanvasNodeData[]) => void;
};

type MaterialUploadBatchResult =
    | { status: "completed"; uploadedCount: number }
    | { status: "rejected"; uploadedCount: 0; message: string }
    | { status: "failed"; uploadedCount: number; failedIndex: number; message: string };

const PLACEMENT_GAP = 32;
const MAX_PLACEMENT_RINGS = 100;

export function materialFileKind(file: File): MaterialFileKind | null {
    if (file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name)) return "audio";
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    return null;
}

export function materialUploadFocus(nodes: CanvasNodeData[]): { selectedNodeId?: string; dialogNodeId?: string } {
    const selectedNodeId = nodes[nodes.length - 1]?.id;
    const dialogNodeId = [...nodes].reverse().find((node) => node.type !== CanvasNodeType.Audio)?.id;
    return { selectedNodeId, dialogNodeId };
}

export function appendMaterialUploadNode(
    current: CanvasNodeData[],
    node: CanvasNodeData,
    options: { anchor: Position; avoidOverlap: boolean },
): CanvasNodeData[] {
    if (current.some((item) => item.id === node.id)) return current;

    const centeredPosition = {
        x: options.anchor.x - node.width / 2,
        y: options.anchor.y - node.height / 2,
    };
    const position = options.avoidOverlap ? findOpenPosition(current, node, centeredPosition) : centeredPosition;

    return [...current, { ...node, position }];
}

export async function runMaterialUploadBatch(options: MaterialUploadBatchOptions): Promise<MaterialUploadBatchResult> {
    if (options.mode === "single" && options.files.length > 1) {
        return {
            status: "rejected",
            uploadedCount: 0,
            message: "此入口一次只能选择 1 个素材，请重新选择。",
        };
    }
    if (options.files.length > MAX_MATERIAL_UPLOAD_FILES) {
        return {
            status: "rejected",
            uploadedCount: 0,
            message: `一次最多选择 ${MAX_MATERIAL_UPLOAD_FILES} 个素材，请减少后重试。`,
        };
    }

    const avoidOverlap = options.mode === "multiple" && options.files.length > 1;
    let uploadedCount = 0;

    for (let index = 0; index < options.files.length; index += 1) {
        const file = options.files[index];
        const oneBasedIndex = index + 1;
        const kind = materialFileKind(file);
        if (!kind) {
            return {
                status: "failed",
                uploadedCount,
                failedIndex: oneBasedIndex,
                message: `第 ${oneBasedIndex} 个素材格式不支持，已停止后续上传。`,
            };
        }

        try {
            const node = await options.uploadFile(file, kind, oneBasedIndex);
            options.commitNode((current) => appendMaterialUploadNode(current, node, { anchor: options.anchor, avoidOverlap }));
            uploadedCount += 1;
        } catch {
            return {
                status: "failed",
                uploadedCount,
                failedIndex: oneBasedIndex,
                message: `第 ${oneBasedIndex} 个素材上传失败，已停止后续上传。`,
            };
        }
    }

    return { status: "completed", uploadedCount };
}

function findOpenPosition(current: CanvasNodeData[], node: CanvasNodeData, centeredPosition: Position): Position {
    const fits = (position: Position) => current.every((item) => !overlapsWithGap(position, node, item));
    if (fits(centeredPosition)) return centeredPosition;

    const horizontalStep = Math.max(1, node.width + PLACEMENT_GAP);
    const verticalStep = Math.max(1, node.height + PLACEMENT_GAP);

    for (let ring = 1; ring <= MAX_PLACEMENT_RINGS; ring += 1) {
        for (let row = -ring; row <= ring; row += 1) {
            for (let column = -ring; column <= ring; column += 1) {
                if (Math.max(Math.abs(column), Math.abs(row)) !== ring) continue;
                const candidate = {
                    x: centeredPosition.x + column * horizontalStep,
                    y: centeredPosition.y + row * verticalStep,
                };
                if (fits(candidate)) return candidate;
            }
        }
    }

    const rightEdge = current.reduce((maximum, item) => Math.max(maximum, item.position.x + item.width), centeredPosition.x);
    return { x: rightEdge + PLACEMENT_GAP, y: centeredPosition.y };
}

function overlapsWithGap(position: Position, node: CanvasNodeData, existing: CanvasNodeData) {
    return (
        position.x < existing.position.x + existing.width + PLACEMENT_GAP &&
        position.x + node.width + PLACEMENT_GAP > existing.position.x &&
        position.y < existing.position.y + existing.height + PLACEMENT_GAP &&
        position.y + node.height + PLACEMENT_GAP > existing.position.y
    );
}
