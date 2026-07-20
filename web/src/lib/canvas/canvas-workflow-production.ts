import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkflowProductionMetadata } from "@/types/canvas";

export const WORKFLOW_PRODUCTION_TOTAL = 14;
export const WORKFLOW_PRODUCTION_ACK_TIMEOUT_MS = 8_000;
export const WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS = 12 * 60_000;
export const WORKFLOW_PRODUCTION_ORIGIN = "http://127.0.0.1:17373";

const PRODUCTION_STATUSES = new Set(["idle", "queued", "running", "paused", "completed", "failed"]);

export type WorkflowProductionQuote = {
    batchId: string;
    totalCount: 14;
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

export function readProductionState(metadata?: CanvasNodeMetadata): CanvasWorkflowProductionMetadata {
    const value = metadata?.workflowProduction;
    const status = value && PRODUCTION_STATUSES.has(value.status) ? value.status : "idle";
    return {
        status: status as CanvasWorkflowProductionMetadata["status"],
        producedCount: clampInteger(value?.producedCount, 0, WORKFLOW_PRODUCTION_TOTAL),
        totalCount: WORKFLOW_PRODUCTION_TOTAL,
        requestId: stringValue(value?.requestId),
        batchId: stringValue(value?.batchId),
        requestedAt: timestamp(value?.requestedAt),
        updatedAt: timestamp(value?.updatedAt),
        step: stringValue(value?.step),
        message: stringValue(value?.message),
        errorMessage: stringValue(value?.errorMessage),
    };
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

export function connectedProductionSummary(machineId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
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
    return { batchId: card.metadata!.batchIntake!.receipt!.batchId, materialCount };
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
    if (
        !response.ok ||
        payload.ok !== true ||
        payload.batchId !== batchId ||
        payload.totalCount !== WORKFLOW_PRODUCTION_TOTAL ||
        !validCount(payload.readyCount) ||
        !validCount(payload.remainingCount) ||
        Number(payload.readyCount) + Number(payload.remainingCount) !== WORKFLOW_PRODUCTION_TOTAL ||
        !validMoney(payload.estimatedUnitUsd) ||
        !validMoney(payload.estimatedTotalUsd) ||
        !validMinutes(payload.estimatedMinutes)
    ) {
        throw new Error("本机真实制作服务没有返回可信的费用估算，本次没有开始。");
    }
    return {
        batchId,
        totalCount: WORKFLOW_PRODUCTION_TOTAL,
        readyCount: Number(payload.readyCount),
        remainingCount: Number(payload.remainingCount),
        estimatedUnitUsd: Number(payload.estimatedUnitUsd),
        estimatedTotalUsd: Number(payload.estimatedTotalUsd),
        estimatedMinutes: Number(payload.estimatedMinutes),
    };
}

export function buildProductionCommand(state: CanvasWorkflowProductionMetadata, batchId: string, requestId: string, now: number) {
    const retry = state.producedCount > 0 || state.status === "paused";
    return {
        content: `# workflow-production\n# request-id: ${requestId}\n# requested-at: ${now}\n${retry ? "retry: renders" : "run: next"}`,
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
        },
    };
}

export function hasProductionSubmission(submissions: ReadonlySet<string>, machineId: string, batchId: string) {
    return submissions.has(`${machineId}\u0000${batchId}`);
}

export function reserveProductionSubmission(submissions: Set<string>, machineId: string, batchId: string) {
    const key = `${machineId}\u0000${batchId}`;
    if (submissions.has(key)) return false;
    submissions.add(key);
    return true;
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

function clampInteger(value: unknown, minimum: number, maximum: number) {
    const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : minimum;
    return Math.max(minimum, Math.min(maximum, parsed));
}

function stringValue(value: unknown) {
    return typeof value === "string" && value ? value : undefined;
}

function timestamp(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validCount(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= WORKFLOW_PRODUCTION_TOTAL;
}

function validMoney(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validMinutes(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
