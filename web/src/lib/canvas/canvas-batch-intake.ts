import { CanvasNodeType, type CanvasBatchIntakeFacts, type CanvasBatchIntakeMetadata, type CanvasBatchIntakeStatus, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const BATCH_INTAKE_MAIN_COUNT = 6;
export const BATCH_INTAKE_DETAIL_COUNT = 8;
export const BATCH_INTAKE_TOTAL = 14;
export const BATCH_INTAKE_HANDHELD_MAIN_COUNT = 2;
export const BATCH_INTAKE_HANDHELD_DETAIL_COUNT = 1;
export const BATCH_INTAKE_ACK_TIMEOUT_MS = 8000;
export const BATCH_INTAKE_UPLOAD_ORIGIN = "http://127.0.0.1:17372";

const BATCH_INTAKE_STATUSES = new Set<CanvasBatchIntakeStatus>(["draft", "queued", "upload_ready", "uploading", "completed", "failed", "integrity_blocked"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type BatchIntakeSelection = {
    workflowNodeId: string;
    sourceImageNodeIds: string[];
};

export type BatchIntakeSource = {
    nodeId: string;
    sourceFile: CanvasBatchSourceFile;
    blob: Blob;
};

export class BatchIntakeIntegrityError extends Error {
    constructor(message = "原图完整性核对失败，登记已硬停止，不会重试或降低无损标准。") {
        super(message);
        this.name = "BatchIntakeIntegrityError";
    }
}

export function readBatchIntakeState(metadata?: CanvasNodeMetadata): CanvasBatchIntakeMetadata {
    const value = metadata?.batchIntake;
    const status = value && BATCH_INTAKE_STATUSES.has(value.status) ? value.status : "draft";
    return {
        status,
        productType: typeof value?.productType === "string" ? value.productType : "",
        productHeightCm: finiteNumber(value?.productHeightCm),
        allowClearWater: typeof value?.allowClearWater === "boolean" ? value.allowClearWater : false,
        prohibitPouringAndHeating: typeof value?.prohibitPouringAndHeating === "boolean" ? value.prohibitPouringAndHeating : true,
        skipMissingDAngle: typeof value?.skipMissingDAngle === "boolean" ? value.skipMissingDAngle : true,
        mainImageCount: BATCH_INTAKE_MAIN_COUNT,
        detailImageCount: BATCH_INTAKE_DETAIL_COUNT,
        handheldMainCount: BATCH_INTAKE_HANDHELD_MAIN_COUNT,
        handheldDetailCount: BATCH_INTAKE_HANDHELD_DETAIL_COUNT,
        facts: value?.facts,
        requestId: nonemptyString(value?.requestId),
        requestedAt: finiteTimestamp(value?.requestedAt),
        updatedAt: finiteTimestamp(value?.updatedAt),
        workflowNodeId: nonemptyString(value?.workflowNodeId),
        sourceImageNodeIds: uniqueStrings(value?.sourceImageNodeIds),
        batchId: nonemptyString(value?.batchId),
        uploadBaseUrl: nonemptyString(value?.uploadBaseUrl),
        expectedCount: nonnegativeInteger(value?.expectedCount),
        receivedCount: nonnegativeInteger(value?.receivedCount),
        errorMessage: nonemptyString(value?.errorMessage),
        receipt: value?.receipt,
    };
}

export function validateBatchIntakeFacts(state: CanvasBatchIntakeMetadata): { ok: true; facts: CanvasBatchIntakeFacts } | { ok: false; message: string } {
    const productType = state.productType.trim();
    if (!productType) return { ok: false, message: "请填写产品品类。" };
    if (!Number.isInteger(state.productHeightCm) || (state.productHeightCm || 0) <= 0) return { ok: false, message: "产品高度必须填写正整数厘米。" };
    return {
        ok: true,
        facts: {
            product_type: productType,
            height_cm: state.productHeightCm!,
            handheld_main: BATCH_INTAKE_HANDHELD_MAIN_COUNT,
            handheld_detail: BATCH_INTAKE_HANDHELD_DETAIL_COUNT,
            allow_clear_water: state.allowClearWater,
            forbid_pouring_and_heating: state.prohibitPouringAndHeating,
            missing_d_no_retake: state.skipMissingDAngle,
        },
    };
}

export function resolveBatchIntakeSelection(batchInfoNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): ({ ok: true } & BatchIntakeSelection) | { ok: false; message: string } {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const card = nodesById.get(batchInfoNodeId);
    if (!card || card.type !== CanvasNodeType.BatchInfo) return { ok: false, message: "批次信息卡已不存在，本次没有登记。" };

    const workflowIds = uniqueStrings(connections.filter((item) => item.fromNodeId === card.id && nodesById.get(item.toNodeId)?.type === CanvasNodeType.Workflow).map((item) => item.toNodeId));
    if (!workflowIds.length) return { ok: false, message: "请把这张信息卡连接到一台工作流机器。" };
    if (workflowIds.length > 1) return { ok: false, message: "一张信息卡只能连接一台工作流机器。" };

    const workflowNodeId = workflowIds[0]!;
    const connectedCardIds = uniqueStrings(connections.filter((item) => item.toNodeId === workflowNodeId && nodesById.get(item.fromNodeId)?.type === CanvasNodeType.BatchInfo).map((item) => item.fromNodeId));
    if (connectedCardIds.length !== 1 || connectedCardIds[0] !== card.id) return { ok: false, message: "一台工作流机器只能连接一张批次信息卡。" };

    const sourceImages = uniqueStrings(connections.filter((item) => item.toNodeId === workflowNodeId && nodesById.get(item.fromNodeId)?.type === CanvasNodeType.Image).map((item) => item.fromNodeId)).map((id) => nodesById.get(id)!);
    if (!sourceImages.length) return { ok: false, message: "请把至少 1 张磁盘原图连接到同一台工作流机器。" };

    for (const image of sourceImages) {
        const sourceFile = image.metadata?.sourceFile;
        if (!sourceFile) return { ok: false, message: `“${image.title || image.id}”不是从磁盘直接拖入的原图，请移除后再登记。` };
        if (!image.metadata?.storageKey?.startsWith("image:") || !validSourceFile(sourceFile)) {
            return { ok: false, message: `“${image.title || image.id}”缺少完整的原图凭证，请从磁盘重新拖入。` };
        }
    }

    return { ok: true, workflowNodeId, sourceImageNodeIds: sourceImages.map((image) => image.id) };
}

export function connectedBatchOriginalImageIds(batchInfoNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const workflowIds = uniqueStrings(connections.filter((item) => item.fromNodeId === batchInfoNodeId && nodesById.get(item.toNodeId)?.type === CanvasNodeType.Workflow).map((item) => item.toNodeId));
    if (workflowIds.length !== 1) return [];
    return uniqueStrings(
        connections
            .filter((item) => item.toNodeId === workflowIds[0])
            .map((item) => nodesById.get(item.fromNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node && node.type === CanvasNodeType.Image && node.metadata?.sourceFile && node.metadata.storageKey?.startsWith("image:")))
            .map((node) => node.id),
    );
}

export function buildBatchIntakeCommand(state: CanvasBatchIntakeMetadata, selection: BatchIntakeSelection, requestId: string, now: number) {
    const factsResult = validateBatchIntakeFacts(state);
    if (!factsResult.ok) throw new Error(factsResult.message);
    return {
        content: `# batch-intake\n# request-id: ${requestId}\n# requested-at: ${now}\nbuild: batch`,
        state: {
            ...state,
            productType: factsResult.facts.product_type,
            productHeightCm: factsResult.facts.height_cm,
            facts: factsResult.facts,
            status: "queued" as const,
            requestId,
            requestedAt: now,
            updatedAt: now,
            workflowNodeId: selection.workflowNodeId,
            sourceImageNodeIds: [...selection.sourceImageNodeIds],
            batchId: undefined,
            uploadBaseUrl: undefined,
            expectedCount: selection.sourceImageNodeIds.length,
            receivedCount: 0,
            errorMessage: undefined,
            receipt: undefined,
        },
    };
}

export function expireBatchIntakeState(state: CanvasBatchIntakeMetadata, now: number): CanvasBatchIntakeMetadata {
    if (state.status !== "queued" || state.requestedAt === undefined || now - state.requestedAt < BATCH_INTAKE_ACK_TIMEOUT_MS) return state;
    return {
        ...state,
        status: "failed",
        updatedAt: now,
        errorMessage: "本机批次登记服务没有响应，请重新启动画布服务后再试。",
    };
}

export function resetInterruptedBatchIntakes(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.BatchInfo) return node;
        const state = readBatchIntakeState(node.metadata);
        if (state.status !== "upload_ready" && state.status !== "uploading") return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                batchIntake: {
                    ...state,
                    status: "failed" as const,
                    updatedAt: Date.now(),
                    errorMessage: "页面刷新后本次原图接收已停止，不会自动重试。请核对现场后重新登记。",
                },
            },
        };
    });
}

export function buildBatchUploadUrl(uploadBaseUrl: string, batchId: string, requestId: string, nodeId: string) {
    let parsed: URL;
    try {
        parsed = new URL(uploadBaseUrl);
    } catch {
        throw new Error("原图接收地址无效，登记已停止。");
    }
    if (parsed.origin !== BATCH_INTAKE_UPLOAD_ORIGIN || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
        throw new Error("原图接收地址不是批准的本机地址，登记已停止。");
    }
    if (![batchId, requestId, nodeId].every((value) => typeof value === "string" && value.length > 0)) throw new Error("原图接收信息不完整，登记已停止。");
    return `${BATCH_INTAKE_UPLOAD_ORIGIN}/batch-intake/${encodeURIComponent(batchId)}/${encodeURIComponent(requestId)}/files/${encodeURIComponent(nodeId)}`;
}

export async function sha256Blob(blob: Blob) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createBatchSourceFile(file: File): Promise<CanvasBatchSourceFile> {
    return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        sha256: await sha256Blob(file),
    };
}

export function batchSourceFilePatch(sourceFile?: CanvasBatchSourceFile): Pick<CanvasNodeMetadata, "sourceFile"> {
    return { sourceFile };
}

export async function uploadBatchSourceImages({
    uploadBaseUrl,
    batchId,
    requestId,
    token,
    sources,
    fetcher = globalThis.fetch,
    signal,
}: {
    uploadBaseUrl: string;
    batchId: string;
    requestId: string;
    token: string;
    sources: BatchIntakeSource[];
    fetcher?: typeof fetch;
    signal?: AbortSignal;
}) {
    const cleanToken = token.trim();
    if (!cleanToken) throw new Error("本机画布连接令牌不可用，请重新启动画布服务后再试。");
    const uploaded: Array<{ nodeId: string; sha256: string }> = [];
    const verifiedSources: Array<{ source: BatchIntakeSource; browserSha256: string }> = [];
    for (const source of sources) {
        const browserSha256 = await sha256Blob(source.blob);
        if (source.blob.size !== source.sourceFile.size || (source.sourceFile.type && source.blob.type !== source.sourceFile.type) || browserSha256 !== source.sourceFile.sha256.toLowerCase()) {
            throw new BatchIntakeIntegrityError();
        }
        verifiedSources.push({ source, browserSha256 });
    }

    for (const { source, browserSha256 } of verifiedSources) {
        const response = await fetcher(buildBatchUploadUrl(uploadBaseUrl, batchId, requestId, source.nodeId), {
            method: "POST",
            headers: {
                "Content-Type": source.sourceFile.type || source.blob.type || "application/octet-stream",
                "X-Canvas-Agent-Token": cleanToken,
                "X-Canvas-File-Name": encodeURIComponent(source.sourceFile.name),
                "X-Canvas-File-Size": String(source.sourceFile.size),
                "X-Canvas-File-Sha256": browserSha256,
                "X-Canvas-File-Last-Modified": String(source.sourceFile.lastModified),
            },
            body: source.blob,
            signal,
        });
        const payload = await readUploadResponse(response);
        const serverSha256 = typeof payload.sha256 === "string" ? payload.sha256.toLowerCase() : "";
        if (payload.errorCode === "hash_mismatch" || payload.errorCode === "integrity_blocked" || payload.hashMatch === false) {
            throw new BatchIntakeIntegrityError();
        }
        if (!response.ok || payload.ok !== true) throw new Error("本机批次登记服务拒绝了原图，本次已停止且不会自动重试。");
        if (!SHA256_PATTERN.test(serverSha256) || serverSha256 !== browserSha256) throw new BatchIntakeIntegrityError();
        uploaded.push({ nodeId: source.nodeId, sha256: browserSha256 });
    }

    return uploaded;
}

async function readUploadResponse(response: Response): Promise<Record<string, unknown>> {
    try {
        const value = await response.json();
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function validSourceFile(value: CanvasBatchSourceFile) {
    return Boolean(value.name && Number.isInteger(value.size) && value.size > 0 && typeof value.type === "string" && Number.isFinite(value.lastModified) && value.lastModified >= 0 && SHA256_PATTERN.test(value.sha256));
}

function uniqueStrings(value: unknown) {
    return Array.from(new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []));
}

function nonemptyString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteTimestamp(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonnegativeInteger(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
