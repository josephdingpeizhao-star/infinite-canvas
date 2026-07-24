import { sha256Blob } from "@/lib/canvas/canvas-batch-intake";
import { uploadImage, type UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

const PRODUCTION_ORIGIN = "http://127.0.0.1:17373";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class ProductionOutputIntegrityError extends Error {
    constructor(message = "正式图片完整性核对失败，已停止接收且不会自动重试。") {
        super(message);
        this.name = "ProductionOutputIntegrityError";
    }
}

export function productionOutputNeedsImport(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image && Boolean(node.metadata?.workflowProductionOutput) && !node.metadata?.storageKey;
}

export async function importProductionOutput(
    node: CanvasNodeData,
    token: string,
    {
        fetcher = globalThis.fetch,
        uploader = uploadImage,
        signal,
    }: { fetcher?: typeof fetch; uploader?: (blob: Blob) => Promise<UploadedImage>; signal?: AbortSignal } = {},
): Promise<CanvasNodeMetadata> {
    const proof = node.metadata?.workflowProductionOutput;
    if (node.type !== CanvasNodeType.Image || !proof || !token.trim()) throw new Error("正式图片接收信息不完整，已停止。");
    if (!validDownloadUrl(proof.downloadUrl, proof.batchId, proof.configId, proof.source)) throw new Error("正式图片接收地址无效，已停止。");
    if (!SHA256_PATTERN.test(proof.sha256) || !Number.isInteger(proof.byteCount) || proof.byteCount <= 0) throw new ProductionOutputIntegrityError();
    const response = await fetcher(proof.downloadUrl, { method: "GET", headers: { "X-Canvas-Agent-Token": token.trim() }, signal });
    if (!response.ok) throw new Error("本机正式图片服务拒绝了接收，本次已停止且不会自动重试。");
    const serverSha = (response.headers.get("x-content-sha256") || "").toLowerCase();
    const blob = await response.blob();
    const browserSha = await sha256Blob(blob);
    if (serverSha !== proof.sha256 || browserSha !== proof.sha256 || blob.size !== proof.byteCount || blob.type !== "image/png") throw new ProductionOutputIntegrityError();
    const uploaded = await uploader(blob);
    return {
        ...node.metadata,
        content: uploaded.url,
        storageKey: uploaded.storageKey,
        naturalWidth: uploaded.width,
        naturalHeight: uploaded.height,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
        status: "success",
        errorDetails: undefined,
        workflowProductionOutput: { ...proof, persistedAt: Date.now() },
    };
}

function validDownloadUrl(value: string, batchId: string, configId: string, source?: "renders" | "repaired") {
    try {
        const parsed = new URL(value);
        const sourcePath = source === "renders" || source === "repaired" ? `/${source}` : "";
        return parsed.origin === PRODUCTION_ORIGIN && parsed.pathname === `/workflow-production/${encodeURIComponent(batchId)}/outputs${sourcePath}/${encodeURIComponent(configId)}` && !parsed.search && !parsed.hash;
    } catch {
        return false;
    }
}
