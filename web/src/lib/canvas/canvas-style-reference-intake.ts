import { sha256Blob } from "@/lib/canvas/canvas-batch-intake";
import { CanvasNodeType, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasStyleReferenceMetadata } from "@/types/canvas";

export const STYLE_REFERENCE_ORIGIN = "http://127.0.0.1:17373";
export const STYLE_REFERENCE_ACK_TIMEOUT_MS = 8_000;
const STATUSES = new Set(["idle", "queued", "upload_ready", "uploading", "completed", "failed", "integrity_blocked"]);

export class StyleReferenceIntegrityError extends Error {
    constructor(message = "风格参考图完整性核对失败，已硬停止且不会自动重试。") {
        super(message);
        this.name = "StyleReferenceIntegrityError";
    }
}

export function readStyleReferenceState(metadata?: CanvasNodeMetadata): CanvasStyleReferenceMetadata {
    const value = metadata?.styleReferenceIntake;
    return {
        status: (value && STATUSES.has(value.status) ? value.status : "idle") as CanvasStyleReferenceMetadata["status"],
        requestId: stringValue(value?.requestId),
        requestedAt: timestamp(value?.requestedAt),
        updatedAt: timestamp(value?.updatedAt),
        batchId: stringValue(value?.batchId),
        sources: Array.isArray(value?.sources) ? value.sources : [],
        uploadBaseUrl: stringValue(value?.uploadBaseUrl),
        errorMessage: stringValue(value?.errorMessage),
        receipt: value?.receipt,
    };
}

export function resolveStyleReferenceSelection(cardId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): { ok: true; batchId: string; sourceNodeIds: string[] } | { ok: false; message: string } {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const card = nodeById.get(cardId);
    const batchId = card?.metadata?.batchIntake?.receipt?.batchId;
    if (!card || card.type !== CanvasNodeType.BatchInfo || card.metadata?.batchIntake?.status !== "completed" || !batchId) return { ok: false, message: "这张信息卡尚未登记完成，不能补登风格参考图。" };
    const sourceNodes = Array.from(
        new Set(connections.filter((item) => item.toNodeId === cardId && nodeById.get(item.fromNodeId)?.type === CanvasNodeType.Image).map((item) => item.fromNodeId)),
    ).map((id) => nodeById.get(id)!);
    if (!sourceNodes.length) return { ok: false, message: "请把至少 1 张风格参考图直接连到这张信息卡。" };
    for (const node of sourceNodes) {
        if (!node.metadata?.storageKey?.startsWith("image:") || !validSourceFile(node.metadata.sourceFile)) return { ok: false, message: `“${node.title || node.id}”缺少磁盘原文件凭证，请重新拖入。` };
    }
    return { ok: true, batchId, sourceNodeIds: sourceNodes.map((node) => node.id) };
}

export function connectedStyleReferenceImageIds(cardId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(new Set(connections.filter((item) => item.toNodeId === cardId).map((item) => nodeById.get(item.fromNodeId)).filter((node) => node?.type === CanvasNodeType.Image && node.metadata?.storageKey?.startsWith("image:") && node.metadata.sourceFile).map((node) => node!.id)));
}

export function buildStyleReferenceCommand(card: CanvasNodeData, sources: CanvasNodeData[], requestId: string, now: number) {
    const batchId = card.metadata?.batchIntake?.receipt?.batchId;
    if (!batchId || !requestId || !sources.length) throw new Error("风格补登信息不完整，本次没有开始。");
    const proofs = sources.map((node) => {
        const source = node.metadata?.sourceFile;
        if (!source || !validSourceFile(source)) throw new Error("风格参考图缺少磁盘原文件凭证，本次没有开始。");
        return { nodeId: node.id, name: source.name, mimeType: source.type, size: source.size, sha256: source.sha256.toLowerCase() };
    });
    return {
        content: `# style-reference-intake\n# request-id: ${requestId}\n# requested-at: ${now}\nsupplement: style-references`,
        state: {
            status: "queued" as const,
            requestId,
            requestedAt: now,
            updatedAt: now,
            batchId,
            sources: proofs,
            uploadBaseUrl: undefined,
            errorMessage: undefined,
            receipt: undefined,
        },
    };
}

export async function uploadStyleReferences({ uploadBaseUrl, batchId, requestId, token, sources, fetcher = globalThis.fetch, signal }: { uploadBaseUrl: string; batchId: string; requestId: string; token: string; sources: Array<{ nodeId: string; sourceFile: CanvasBatchSourceFile; blob: Blob }>; fetcher?: typeof fetch; signal?: AbortSignal }) {
    if (!token.trim() || uploadBaseUrl !== STYLE_REFERENCE_ORIGIN) throw new Error("本机风格补登服务尚未就绪，本次已停止。");
    const verified: Array<{ nodeId: string; sourceFile: CanvasBatchSourceFile; blob: Blob; sha256: string }> = [];
    for (const source of sources) {
        const sha256 = await sha256Blob(source.blob);
        if (source.blob.size !== source.sourceFile.size || source.blob.type !== source.sourceFile.type || sha256 !== source.sourceFile.sha256.toLowerCase()) throw new StyleReferenceIntegrityError();
        verified.push({ ...source, sha256 });
    }
    const uploaded: Array<{ nodeId: string; sha256: string }> = [];
    for (const source of verified) {
        const url = `${STYLE_REFERENCE_ORIGIN}/style-reference-intake/${encodeURIComponent(batchId)}/${encodeURIComponent(requestId)}/files/${encodeURIComponent(source.nodeId)}`;
        const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Canvas-Agent-Token": token.trim() }, body: source.blob, signal });
        let payload: Record<string, unknown> = {};
        try {
            payload = (await response.json()) as Record<string, unknown>;
        } catch {
            payload = {};
        }
        if (!response.ok || payload.ok !== true) throw new Error("本机风格补登服务拒绝了图片，本次已停止且不会自动重试。");
        if (payload.sha256 !== source.sha256) throw new StyleReferenceIntegrityError();
        uploaded.push({ nodeId: source.nodeId, sha256: source.sha256 });
    }
    return uploaded;
}

export function expireStyleReferenceState(state: CanvasStyleReferenceMetadata, now: number): CanvasStyleReferenceMetadata {
    if (state.status !== "queued" || state.requestedAt === undefined || now - state.requestedAt < STYLE_REFERENCE_ACK_TIMEOUT_MS) return state;
    return { ...state, status: "failed", updatedAt: now, errorMessage: "本机风格补登服务没有及时接单，本次没有开始。" };
}

export function resetInterruptedStyleReferenceIntakes(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.BatchInfo) return node;
        const state = readStyleReferenceState(node.metadata);
        if (state.status !== "upload_ready" && state.status !== "uploading") return node;
        return { ...node, metadata: { ...node.metadata, styleReferenceIntake: { ...state, status: "failed" as const, updatedAt: Date.now(), errorMessage: "页面刷新后本次风格补登已停止，不会自动重试。请重新发起。" } } };
    });
}

function validSourceFile(value?: CanvasBatchSourceFile) {
    return Boolean(value?.name && Number.isInteger(value.size) && value.size > 0 && value.type.startsWith("image/") && /^[0-9a-f]{64}$/i.test(value.sha256));
}

function stringValue(value: unknown) {
    return typeof value === "string" && value ? value : undefined;
}

function timestamp(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
