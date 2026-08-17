import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkflowProductionMetadata, type CanvasWorkflowProductionRecovery } from "@/types/canvas";
import {
    requireClosedWorkflowCommand,
    type ClosedWorkflowCommand,
} from "@/lib/canvas/canvas-command-assistant";

export const WORKFLOW_PRODUCTION_ACK_TIMEOUT_MS = 8_000;
export const WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS = 12 * 60_000;
export const WORKFLOW_PRODUCTION_ORIGIN = "http://127.0.0.1:17373";
export const COMPLETED_PRODUCTION_ACTION_LABEL = "继续";
export const REBIND_RECOMPUTE_ACTION_LABEL = "剔除缺失图并重新分配";
export const IMAGE_SERVICE_FAILURE_ACTION_LABEL = "再次尝试";
export const WORKFLOW_COUNT_DATA_MISSING_MESSAGE = "本批次张数或编号信息不完整，请重启工作台 + 刷新画布后再试。";

const PRODUCTION_FAILURE_FALLBACK_TEXT = "这一步没做好，机器已停下。已经完成的成果都保留了。";
const IMAGE_SERVICE_FAILURE_SOURCE_TEXT = "本次异常来自图片服务，不是工作流的问题。";
const IMAGE_SERVICE_FAILURE_RETRY_TEXT = "待服务恢复后点下方按钮再试一次，费用会重新报价并需你亲手确认。";

const PRODUCTION_STATUSES = new Set(["idle", "queued", "running", "paused", "completed", "failed"]);
const CONFIG_ID_PATTERN = /^(main|detail)_(0[1-9]|[12][0-9]|30)$/;
const RECOVERY_FILE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._()（）-]{0,79}$/u;
const RECOVERY_FILE_DENY_PATTERN = /(authorization|password|bearer|token|api[ _-]?key|secret|sk-|令牌|密钥|凭据)/iu;
const TERMINAL_REBIND_ERRORS = new Set(["missing_files_restored", "render_outputs_exist", "inputs_unavailable"]);

export type WorkflowProductionQuote = {
    batchId: string;
    totalCount: number;
    expectedConfigIds: string[];
    readyCount: number;
    remainingCount: number;
    estimatedUnitUsd: number;
    estimatedTotalUsd: number;
    estimatedMinutes: number;
};

export type WorkflowProductionSelection =
    | { mode: "demo" }
    | { mode: "error"; message: string }
    | { mode: "production"; cardId: string; batchId: string; materialCount: number };

export type WorkflowProductionRebindResult = {
    batchId: string;
    missing: string[];
    remainingCount: number;
    superseded: string[];
    supersededDir: string;
    message?: string;
};

export class WorkflowProductionRebindError extends Error {
    constructor(
        message: string,
        readonly code?: string,
    ) {
        super(message);
        this.name = "WorkflowProductionRebindError";
    }
}

export type ConnectedProductionSummary = {
    batchId: string;
    materialCount: number;
    productType?: string;
    mainImageCount?: number;
    detailImageCount?: number;
    totalCount?: number;
    handheldMainCount?: number;
    handheldDetailCount?: number;
};

export function readProductionState(metadata?: CanvasNodeMetadata): CanvasWorkflowProductionMetadata {
    const value = metadata?.workflowProduction;
    const status = value && PRODUCTION_STATUSES.has(value.status) ? value.status : "idle";
    const countInfo = readExpectedImageSet(value?.totalCount, value?.expectedConfigIds);
    const missingCounts = status !== "idle" && !countInfo;
    const realErrorMessage = stringValue(value?.errorMessage);
    const producedCount = nonnegativeInteger(value?.producedCount) ?? 0;
    return {
        status: missingCounts ? "failed" : (status as CanvasWorkflowProductionMetadata["status"]),
        producedCount: countInfo ? Math.min(producedCount, countInfo.totalCount) : producedCount,
        totalCount: countInfo?.totalCount,
        expectedConfigIds: countInfo?.expectedConfigIds,
        requestId: stringValue(value?.requestId),
        batchId: stringValue(value?.batchId),
        requestedAt: timestamp(value?.requestedAt),
        updatedAt: timestamp(value?.updatedAt),
        step: stringValue(value?.step),
        message: stringValue(value?.message),
        errorMessage: realErrorMessage ?? (missingCounts ? WORKFLOW_COUNT_DATA_MISSING_MESSAGE : undefined),
        failureSource: value?.failureSource === "image_service" ? value.failureSource : undefined,
        recovery: readProductionRecovery(value?.recovery),
    };
}

export function readProductionRecovery(value: unknown): CanvasWorkflowProductionRecovery | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "files,kind,recomputeEligible") return undefined;
    if (record.kind !== "missing_reference" && record.kind !== "inputs_unavailable") return undefined;
    if (typeof record.recomputeEligible !== "boolean" || !Array.isArray(record.files) || record.files.length > 60) return undefined;
    if (!record.files.every(isSafeRecoveryFile) || new Set(record.files).size !== record.files.length) return undefined;
    if (record.kind === "inputs_unavailable" && (record.recomputeEligible || record.files.length)) return undefined;
    return { kind: record.kind, files: [...record.files] as string[], recomputeEligible: record.recomputeEligible };
}

export function resolveProductionSelection(machineId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): WorkflowProductionSelection {
    const machine = nodes.find((node) => node.id === machineId && node.type === CanvasNodeType.Workflow);
    if (!machine) return { mode: "error", message: "找不到这台工作流机器。" };
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const cards = Array.from(
        new Set(
            connections
                .filter((item) => item.toNodeId === machineId && nodeById.get(item.fromNodeId)?.type === CanvasNodeType.BatchInfo)
                .map((item) => item.fromNodeId),
        ),
    ).map((id) => nodeById.get(id)!);
    if (!cards.length) return { mode: "demo" };
    if (cards.length !== 1) return { mode: "error", message: "一台真实工作流机器只能连接一张批次信息卡。" };
    const card = cards[0]!;
    const intake = card.metadata?.batchIntake;
    const batchId = intake?.receipt?.batchId;
    if (intake?.status !== "completed" || !batchId) return { mode: "error", message: "信息卡尚未登记完成，不能进入真实制作。" };
    const materialIds = new Set(
        connections
            .filter((item) => item.toNodeId === machineId)
            .map((item) => nodeById.get(item.fromNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node && node.type === CanvasNodeType.Image && node.metadata?.storageKey?.startsWith("image:") && node.metadata.content))
            .map((node) => node.id),
    );
    if (!materialIds.size) return { mode: "error", message: "请保留已登记信息卡，并把至少 1 张批次素材连到工作流机器。" };
    return { mode: "production", cardId: card.id, batchId, materialCount: materialIds.size };
}

export function connectedProductionSummary(machineId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): ConnectedProductionSummary | undefined {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const card = connections
        .filter((item) => item.toNodeId === machineId)
        .map((item) => nodeById.get(item.fromNodeId))
        .find((node) => node?.type === CanvasNodeType.BatchInfo && node.metadata?.batchIntake?.status === "completed" && node.metadata.batchIntake.receipt?.batchId);
    if (!card) return undefined;
    const materialCount = new Set(
        connections
            .filter((item) => item.toNodeId === machineId)
            .map((item) => nodeById.get(item.fromNodeId))
            .filter((node) => node?.type === CanvasNodeType.Image && node.metadata?.storageKey?.startsWith("image:") && node.metadata.content)
            .map((node) => node!.id),
    ).size;
    const intake = card.metadata!.batchIntake!;
    const facts = intake.receipt?.facts || intake.facts;
    const mainImageCount = boundedImageCount(facts?.main_image_count) ?? boundedImageCount(intake.mainImageCount);
    const detailImageCount = boundedImageCount(facts?.detail_image_count) ?? boundedImageCount(intake.detailImageCount);
    return {
        batchId: card.metadata!.batchIntake!.receipt!.batchId,
        materialCount,
        productType: typeof facts?.product_type === "string" ? facts.product_type : undefined,
        mainImageCount,
        detailImageCount,
        totalCount: mainImageCount !== undefined && detailImageCount !== undefined ? mainImageCount + detailImageCount : undefined,
        handheldMainCount: nonnegativeInteger(facts?.handheld_main),
        handheldDetailCount: nonnegativeInteger(facts?.handheld_detail),
    };
}

export function buildProductionQuoteUrl(baseUrl: string, batchId: string) {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        return null;
    }
    if (parsed.origin !== WORKFLOW_PRODUCTION_ORIGIN || !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash || !batchId) return null;
    return `${WORKFLOW_PRODUCTION_ORIGIN}/workflow-production/${encodeURIComponent(batchId)}/quote`;
}

export function buildProductionRebindUrl(baseUrl: string, batchId: string) {
    const quoteUrl = buildProductionQuoteUrl(baseUrl, batchId);
    return quoteUrl ? quoteUrl.replace(/\/quote$/, "/rebind-recompute") : null;
}

export async function fetchProductionRebind(batchId: string, token: string, fetcher: typeof fetch = globalThis.fetch): Promise<WorkflowProductionRebindResult> {
    const url = buildProductionRebindUrl(WORKFLOW_PRODUCTION_ORIGIN, batchId);
    if (!url || !token.trim()) throw new WorkflowProductionRebindError("本机真实制作服务尚未就绪，请重新启动画布服务后再试。");
    const response = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Canvas-Agent-Token": token.trim() },
        body: "{}",
    });
    let payload: Record<string, unknown> = {};
    try {
        payload = (await response.json()) as Record<string, unknown>;
    } catch {
        payload = {};
    }
    if (!response.ok) {
        const message = safeRebindMessage(payload.message) ?? "白底图重新分配请求未被本机工作台接受，本次没有开始。";
        throw new WorkflowProductionRebindError(message, stringValue(payload.error));
    }
    if (
        payload.ok !== true ||
        payload.batchId !== batchId ||
        !Array.isArray(payload.missing) ||
        !payload.missing.every(isSafeRecoveryFile) ||
        new Set(payload.missing).size !== payload.missing.length ||
        !Array.isArray(payload.superseded) ||
        !payload.superseded.every(safeArtifactKey) ||
        new Set(payload.superseded).size !== payload.superseded.length ||
        typeof payload.remainingCount !== "number" ||
        !Number.isInteger(payload.remainingCount) ||
        payload.remainingCount < 1 ||
        typeof payload.supersededDir !== "string" ||
        !/^artifacts\/_superseded\/[0-9]{8}T[0-9]{6}Z_[a-f0-9]{8}$/.test(payload.supersededDir) ||
        (payload.message !== undefined && !safeRebindMessage(payload.message))
    ) {
        throw new WorkflowProductionRebindError("本机真实制作服务没有返回可信的重新分配结果，本次没有开始。");
    }
    return {
        batchId,
        missing: [...payload.missing] as string[],
        remainingCount: payload.remainingCount,
        superseded: [...payload.superseded] as string[],
        supersededDir: payload.supersededDir,
        message: safeRebindMessage(payload.message),
    };
}

export function isRebindRecomputeVisible(state: CanvasWorkflowProductionMetadata, batchId: string | undefined = state.batchId) {
    return Boolean(batchId && state.batchId === batchId && state.status === "failed" && state.recovery?.kind === "missing_reference" && state.recovery.recomputeEligible === true);
}

export function shouldRebindBeforeQuote(state: CanvasWorkflowProductionMetadata, batchId: string, requestedCommand?: ClosedWorkflowCommand) {
    return requestedCommand === undefined && isRebindRecomputeVisible(state, batchId);
}

export function isSameProductionTarget(expected: WorkflowProductionSelection, current: WorkflowProductionSelection) {
    return expected.mode === "production" && current.mode === "production" && expected.cardId === current.cardId && expected.batchId === current.batchId;
}

export async function rebindBeforeQuoteIfEligible(
    state: CanvasWorkflowProductionMetadata,
    batchId: string,
    token: string,
    fetcher: typeof fetch = globalThis.fetch,
    requestedCommand?: ClosedWorkflowCommand,
) {
    return shouldRebindBeforeQuote(state, batchId, requestedCommand) ? fetchProductionRebind(batchId, token, fetcher) : undefined;
}

export function isTerminalRebindError(error: unknown) {
    return error instanceof WorkflowProductionRebindError && Boolean(error.code && TERMINAL_REBIND_ERRORS.has(error.code));
}

export function productionActionLabel(state: CanvasWorkflowProductionMetadata, batchId: string | undefined = state.batchId) {
    if (state.status === "queued") return "等待接单";
    if (state.status === "running") return "真实制作中";
    if (state.status === "paused") return "继续制作";
    if (state.status === "completed") return COMPLETED_PRODUCTION_ACTION_LABEL;
    if (isRebindRecomputeVisible(state, batchId)) return REBIND_RECOMPUTE_ACTION_LABEL;
    if (state.status === "failed") return isImageServiceFailure(state.status, state.failureSource) ? IMAGE_SERVICE_FAILURE_ACTION_LABEL : "重新开始";
    return "开始真实制作";
}

export function productionFailureStatusText(errorMessage: string | undefined, failureSource: CanvasWorkflowProductionMetadata["failureSource"]) {
    const baseText = errorMessage || PRODUCTION_FAILURE_FALLBACK_TEXT;
    return isImageServiceFailure("failed", failureSource) ? `${baseText} ${IMAGE_SERVICE_FAILURE_SOURCE_TEXT} ${IMAGE_SERVICE_FAILURE_RETRY_TEXT}` : baseText;
}

export async function fetchProductionQuote(batchId: string, token: string, fetcher: typeof fetch = globalThis.fetch): Promise<WorkflowProductionQuote> {
    const url = buildProductionQuoteUrl(WORKFLOW_PRODUCTION_ORIGIN, batchId);
    if (!url || !token.trim()) throw new Error("本机真实制作服务尚未就绪，请重新启动画布服务后再试。");
    const response = await fetcher(url, { method: "GET", headers: { "X-Canvas-Agent-Token": token.trim() } });
    let payload: Record<string, unknown> = {};
    try {
        payload = (await response.json()) as Record<string, unknown>;
    } catch {
        payload = {};
    }
    const countInfo = readExpectedImageSet(payload.totalCount, payload.expectedConfigIds);
    if (response.ok && payload.ok === true && payload.batchId === batchId && !countInfo) throw new Error(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
    if (
        !response.ok ||
        payload.ok !== true ||
        payload.batchId !== batchId ||
        !countInfo ||
        !validCount(payload.readyCount, countInfo.totalCount) ||
        !validCount(payload.remainingCount, countInfo.totalCount) ||
        Number(payload.readyCount) + Number(payload.remainingCount) !== countInfo.totalCount ||
        !validMoney(payload.estimatedUnitUsd) ||
        !validMoney(payload.estimatedTotalUsd) ||
        !validMinutes(payload.estimatedMinutes)
    ) {
        throw new Error("本机真实制作服务没有返回可信的费用估算，本次没有开始。");
    }
    return {
        batchId,
        totalCount: countInfo.totalCount,
        expectedConfigIds: countInfo.expectedConfigIds,
        readyCount: Number(payload.readyCount),
        remainingCount: Number(payload.remainingCount),
        estimatedUnitUsd: Number(payload.estimatedUnitUsd),
        estimatedTotalUsd: Number(payload.estimatedTotalUsd),
        estimatedMinutes: Number(payload.estimatedMinutes),
    };
}

export function buildProductionCommand(
    state: CanvasWorkflowProductionMetadata,
    batchId: string,
    requestId: string,
    now: number,
    requestedCommand?: ClosedWorkflowCommand,
    quote?: Pick<WorkflowProductionQuote, "remainingCount">,
) {
    const action = requestedCommand
        ? requireClosedWorkflowCommand(requestedCommand)
        : state.status === "completed"
          ? "run: next"
          : quote?.remainingCount === 0
            ? "run: next"
            : state.producedCount > 0
              ? "retry: renders"
              : "run: next";
    if (!readExpectedImageSet(state.totalCount, state.expectedConfigIds)) throw new Error(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
    return {
        content: `# workflow-production\n# request-id: ${requestId}\n# requested-at: ${now}\n${action}`,
        state: {
            ...state,
            status: "queued" as const,
            requestId,
            batchId,
            requestedAt: now,
            updatedAt: now,
            errorMessage: undefined,
            message: undefined,
            step: undefined,
            recovery: undefined,
        },
    };
}

export function applyProductionQuote(
    state: CanvasWorkflowProductionMetadata,
    quote: Pick<WorkflowProductionQuote, "totalCount" | "expectedConfigIds">,
): CanvasWorkflowProductionMetadata {
    return {
        ...state,
        totalCount: quote.totalCount,
        expectedConfigIds: [...quote.expectedConfigIds],
    };
}

export function isProductionStartBlocked(state: CanvasWorkflowProductionMetadata) {
    return state.status === "queued" || state.status === "running";
}

export function completedProductionStatusText(message: string | undefined, totalCount: number | undefined) {
    return message || (totalCount === undefined ? WORKFLOW_COUNT_DATA_MISSING_MESSAGE : `${totalCount} 张真实图片已上桌。点击继续后，机器会按当前批次状态处理下一步。`);
}

export function expireProductionState(state: CanvasWorkflowProductionMetadata, now: number): CanvasWorkflowProductionMetadata {
    const ackExpired = state.status === "queued" && state.requestedAt !== undefined && now - state.requestedAt >= WORKFLOW_PRODUCTION_ACK_TIMEOUT_MS;
    const progressExpired = state.status === "running" && state.updatedAt !== undefined && now - state.updatedAt >= WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS;
    if (!ackExpired && !progressExpired) return state;
    return {
        ...state,
        status: "failed",
        updatedAt: now,
        errorMessage: ackExpired ? "本机工作台没有及时接单，本次没有开始。" : "本机真实制作服务已中断，已经完成的成果都保留了。",
    };
}

export function resetInterruptedProductions(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.Workflow) return node;
        const state = readProductionState(node.metadata);
        if (state.status !== "running") return node;
        return { ...node, metadata: { ...node.metadata, workflowProduction: { ...state, status: "failed" as const, errorMessage: "页面刷新后真实制作状态已中断，已经完成的成果都保留了。" } } };
    });
}

function stringValue(value: unknown) {
    return typeof value === "string" && value ? value : undefined;
}

function isImageServiceFailure(status: CanvasWorkflowProductionMetadata["status"], failureSource: CanvasWorkflowProductionMetadata["failureSource"]) {
    return status === "failed" && failureSource === "image_service";
}

function isSafeRecoveryFile(value: unknown): value is string {
    return typeof value === "string" && RECOVERY_FILE_PATTERN.test(value) && !RECOVERY_FILE_DENY_PATTERN.test(value);
}

function safeArtifactKey(value: unknown): value is string {
    return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

function safeRebindMessage(value: unknown) {
    if (typeof value !== "string" || !value.length || value.length > 240 || /[\r\n]/.test(value) || RECOVERY_FILE_DENY_PATTERN.test(value)) return undefined;
    return /[\\/]/.test(value.replaceAll("inputs/white_bg", "inputs_white_bg")) ? undefined : value;
}

function timestamp(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validCount(value: unknown, totalCount: number) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= totalCount;
}

function validMoney(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validMinutes(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function readExpectedImageSet(totalCountValue: unknown, expectedConfigIdsValue: unknown) {
    if (typeof totalCountValue !== "number" || !Number.isInteger(totalCountValue) || totalCountValue < 2 || totalCountValue > 60 || !Array.isArray(expectedConfigIdsValue) || expectedConfigIdsValue.length !== totalCountValue) return undefined;
    const expectedConfigIds = expectedConfigIdsValue.filter((item): item is string => typeof item === "string");
    if (expectedConfigIds.length !== totalCountValue || new Set(expectedConfigIds).size !== totalCountValue) return undefined;
    let mainCount = 0;
    let detailCount = 0;
    let detailStarted = false;
    for (const configId of expectedConfigIds) {
        const match = CONFIG_ID_PATTERN.exec(configId);
        if (!match) return undefined;
        const kind = match[1];
        const ordinal = Number(match[2]);
        if (kind === "main") {
            if (detailStarted || ordinal !== mainCount + 1) return undefined;
            mainCount += 1;
        } else {
            detailStarted = true;
            if (ordinal !== detailCount + 1) return undefined;
            detailCount += 1;
        }
    }
    if (mainCount < 1 || mainCount > 30 || detailCount < 1 || detailCount > 30) return undefined;
    return { totalCount: totalCountValue, expectedConfigIds: [...expectedConfigIds], mainCount, detailCount };
}

function nonnegativeInteger(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function boundedImageCount(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 30 ? value : undefined;
}
