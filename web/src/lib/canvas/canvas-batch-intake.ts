import { CanvasNodeType, type CanvasBatchAdvancedOptionKey, type CanvasBatchCategoryCatalog, type CanvasBatchCategoryMetadata, type CanvasBatchDimensionKey, type CanvasBatchIntakeFacts, type CanvasBatchIntakeMetadata, type CanvasBatchIntakeStatus, type CanvasBatchSourceFile, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const BATCH_INTAKE_ACK_TIMEOUT_MS = 8000;
export const BATCH_INTAKE_UPLOAD_ORIGIN = "http://127.0.0.1:17372";
export const BATCH_CATEGORY_ORIGIN = "http://127.0.0.1:17373";
export const BATCH_CATEGORY_URL = `${BATCH_CATEGORY_ORIGIN}/batch-categories`;
export const BATCH_INTAKE_CONTRACT_SHA256 = "ac9e633c814b2032eb5d72c436a773c03a7dc3f4500d3383580ee7b3f3c18de0";
export const BATCH_CATEGORY_UNAVAILABLE_MESSAGE = "产品品类暂时无法读取，请重启工作台并刷新画布后再登记。";
export const DUPLICATE_PRODUCT_IMAGE_MESSAGE =
    "同一张图被重复加入本次产品原图登记，不能建批。" +
    "请删除重复项，只保留一张；产品原图连工作流机器，风格参考图连信息卡。";
export const CROSS_ROLE_IMAGE_MESSAGE =
    "这张图已经是本批的产品原图，不能再登记为风格参考。" +
    "若是接反了：产品原图连工作流机器，风格参考图连信息卡。";

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
        category: nonemptyString(value?.category),
        contractHash: nonemptyString(value?.contractHash),
        productType: nonemptyString(value?.productType),
        productLengthCm: finiteNumber(value?.productLengthCm),
        productWidthCm: finiteNumber(value?.productWidthCm),
        productHeightCm: finiteNumber(value?.productHeightCm),
        allowClearWater: typeof value?.allowClearWater === "boolean" ? value.allowClearWater : undefined,
        prohibitPouringAndHeating: typeof value?.prohibitPouringAndHeating === "boolean" ? value.prohibitPouringAndHeating : undefined,
        skipMissingDAngle: typeof value?.skipMissingDAngle === "boolean" ? value.skipMissingDAngle : undefined,
        mainImageCount: positiveInteger(value?.mainImageCount),
        detailImageCount: positiveInteger(value?.detailImageCount),
        handheldMainCount: nonnegativeInteger(value?.handheldMainCount),
        handheldDetailCount: nonnegativeInteger(value?.handheldDetailCount),
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

export function validateBatchIntakeFacts(
    state: CanvasBatchIntakeMetadata,
    category: CanvasBatchCategoryMetadata | undefined,
    contractHash: string,
): { ok: true; facts: CanvasBatchIntakeFacts } | { ok: false; message: string } {
    if (!category || state.category !== category.key || state.contractHash !== contractHash || contractHash !== BATCH_INTAKE_CONTRACT_SHA256) {
        return { ok: false, message: BATCH_CATEGORY_UNAVAILABLE_MESSAGE };
    }
    const dimensions: Record<CanvasBatchDimensionKey, number | undefined> = {
        length_cm: state.productLengthCm,
        width_cm: state.productWidthCm,
        height_cm: state.productHeightCm,
    };
    for (const field of category.form.dimensions.fields) {
        const value = dimensions[field.key];
        if (value === undefined && !category.form.dimensions.required.includes(field.key)) continue;
        if (!Number.isInteger(value) || value! < field.minimum || value! > field.maximum) {
            return { ok: false, message: `${field.label}必须填写 ${field.minimum}–${field.maximum} 的整数${field.unit}。` };
        }
    }
    for (const [label, value, bounds] of [
        ["主图张数", state.mainImageCount, category.form.image_counts.main],
        ["详情图张数", state.detailImageCount, category.form.image_counts.detail],
    ] as const) {
        if (!Number.isInteger(value) || value! < bounds.minimum || value! > bounds.maximum) {
            return { ok: false, message: `${label}必须填写 ${bounds.minimum}–${bounds.maximum} 的整数。` };
        }
    }
    for (const [label, value, bounds] of [
        ["主图手持", state.handheldMainCount, { minimum: category.form.handheld.main.minimum, maximum: state.mainImageCount! }],
        ["详情图手持", state.handheldDetailCount, { minimum: category.form.handheld.detail.minimum, maximum: state.detailImageCount! }],
    ] as const) {
        if (!Number.isInteger(value) || value! < bounds.minimum || value! > bounds.maximum) {
            return { ok: false, message: `${label}必须填写 ${bounds.minimum}–${bounds.maximum} 的整数。` };
        }
    }
    if ([state.prohibitPouringAndHeating, state.skipMissingDAngle].some((value) => typeof value !== "boolean")) {
        return { ok: false, message: "高级选项没有准备完整，请重新选择产品品类。" };
    }
    return {
        ok: true,
        facts: {
            product_type: category.product_noun,
            length_cm: dimensions.length_cm ?? null,
            width_cm: dimensions.width_cm ?? null,
            height_cm: dimensions.height_cm!,
            main_image_count: state.mainImageCount!,
            detail_image_count: state.detailImageCount!,
            handheld_main: state.handheldMainCount!,
            handheld_detail: state.handheldDetailCount!,
            forbid_pouring_and_heating: state.prohibitPouringAndHeating!,
            missing_d_no_retake: state.skipMissingDAngle!,
        },
    };
}

export function categoryDefaultPatch(category: CanvasBatchCategoryMetadata, contractHash: string) {
    const option = (field: CanvasBatchAdvancedOptionKey) => category.form.advanced_options.find((item) => item.field === field)!;
    return {
        category: category.key,
        contractHash,
        productType: category.product_noun,
        productLengthCm: undefined,
        productWidthCm: undefined,
        productHeightCm: undefined,
        mainImageCount: category.form.image_counts.main.default,
        detailImageCount: category.form.image_counts.detail.default,
        handheldMainCount: category.form.handheld.main.default,
        handheldDetailCount: category.form.handheld.detail.default,
        prohibitPouringAndHeating: option("forbid_pouring_and_heating").default,
        skipMissingDAngle: option("missing_d_no_retake").default,
    };
}

export function categorySwitchPatch(state: CanvasBatchIntakeMetadata, category: CanvasBatchCategoryMetadata, contractHash: string) {
    return {
        ...categoryDefaultPatch(category, contractHash),
        productLengthCm: state.productLengthCm,
        productWidthCm: state.productWidthCm,
        productHeightCm: state.productHeightCm,
    };
}

export async function fetchBatchCategoryCatalog(token: string, fetcher: typeof fetch = globalThis.fetch): Promise<CanvasBatchCategoryCatalog> {
    if (!token.trim()) throw new Error(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    let response: Response;
    try {
        response = await fetcher(BATCH_CATEGORY_URL, {
            method: "GET",
            headers: { "X-Canvas-Agent-Token": token.trim() },
        });
    } catch {
        throw new Error(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    }
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    }
    if (!response.ok || !validCategoryCatalog(payload)) throw new Error(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    return { contractHash: payload.contractHash, categories: payload.categories };
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
    const sourceHashes = sourceImages.map((image) => image.metadata!.sourceFile!.sha256.toLowerCase());
    if (sourceHashes.length !== new Set(sourceHashes).size) return { ok: false, message: DUPLICATE_PRODUCT_IMAGE_MESSAGE };

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

export function connectedBatchOriginalFileNames(batchInfoNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return connectedBatchOriginalImageIds(batchInfoNodeId, nodes, connections).map((id) => nodesById.get(id)?.metadata?.sourceFile?.name || nodesById.get(id)?.title || id);
}

export function buildBatchIntakeCommand(
    state: CanvasBatchIntakeMetadata,
    category: CanvasBatchCategoryMetadata | undefined,
    contractHash: string,
    selection: BatchIntakeSelection,
    requestId: string,
    now: number,
) {
    const factsResult = validateBatchIntakeFacts(state, category, contractHash);
    if (!factsResult.ok) throw new Error(factsResult.message);
    return {
        content: `# batch-intake\n# request-id: ${requestId}\n# requested-at: ${now}\nbuild: batch`,
        state: {
            ...state,
            category: category!.key,
            contractHash,
            productType: factsResult.facts.product_type,
            productLengthCm: factsResult.facts.length_cm ?? undefined,
            productWidthCm: factsResult.facts.width_cm ?? undefined,
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

function validCategoryCatalog(value: unknown): value is { ok: true; contractHash: string; categories: CanvasBatchCategoryMetadata[] } {
    if (!value || typeof value !== "object") return false;
    const payload = value as Record<string, unknown>;
    if (payload.ok !== true || payload.contractHash !== BATCH_INTAKE_CONTRACT_SHA256 || !Array.isArray(payload.categories) || !payload.categories.length) return false;
    const keys = new Set<string>();
    for (const category of payload.categories) {
        if (!validCategory(category) || keys.has(category.key)) return false;
        keys.add(category.key);
    }
    return true;
}

function validCategory(value: unknown): value is CanvasBatchCategoryMetadata {
    if (!value || typeof value !== "object") return false;
    const category = value as CanvasBatchCategoryMetadata;
    if (![category.key, category.display_name, category.product_noun].every((item) => typeof item === "string" && item.length > 0)) return false;
    const dimensions = category.form?.dimensions;
    const dimensionKeys = new Set<CanvasBatchDimensionKey>(["length_cm", "width_cm", "height_cm"]);
    if (!dimensions || !Array.isArray(dimensions.required) || !Array.isArray(dimensions.fields) || dimensions.fields.length !== 3) return false;
    if (dimensions.required.some((item) => !dimensionKeys.has(item)) || new Set(dimensions.fields.map((item) => item.key)).size !== 3) return false;
    if (
        dimensions.fields.some(
            (field) =>
                !dimensionKeys.has(field.key) ||
                !field.label ||
                !field.unit ||
                !validIntegerBounds(field.minimum, field.maximum),
        )
    )
        return false;
    if (!validIntegerBounds(category.form.image_counts?.main?.minimum, category.form.image_counts?.main?.maximum, category.form.image_counts?.main?.default, 1)) return false;
    if (!validIntegerBounds(category.form.image_counts?.detail?.minimum, category.form.image_counts?.detail?.maximum, category.form.image_counts?.detail?.default, 1)) return false;
    if (!validMinimumDefault(category.form.handheld?.main?.minimum, category.form.handheld?.main?.default)) return false;
    if (!validMinimumDefault(category.form.handheld?.detail?.minimum, category.form.handheld?.detail?.default)) return false;
    const advancedKeys = new Set<CanvasBatchAdvancedOptionKey>(["forbid_pouring_and_heating", "missing_d_no_retake"]);
    const advanced = category.form.advanced_options;
    return (
        Array.isArray(advanced) &&
        advanced.length === 2 &&
        new Set(advanced.map((item) => item.field)).size === 2 &&
        advanced.every((item) => advancedKeys.has(item.field) && typeof item.default === "boolean" && Boolean(item.label) && Boolean(item.description))
    );
}

function validIntegerBounds(minimum: unknown, maximum: unknown, defaultValue?: unknown, floor = 0) {
    return (
        Number.isInteger(minimum) &&
        Number.isInteger(maximum) &&
        (minimum as number) >= floor &&
        (maximum as number) >= (minimum as number) &&
        (defaultValue === undefined || (Number.isInteger(defaultValue) && (defaultValue as number) >= (minimum as number) && (defaultValue as number) <= (maximum as number)))
    );
}

function validMinimumDefault(minimum: unknown, defaultValue: unknown) {
    return Number.isInteger(minimum) && (minimum as number) >= 0 && Number.isInteger(defaultValue) && (defaultValue as number) >= (minimum as number);
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

function positiveInteger(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
