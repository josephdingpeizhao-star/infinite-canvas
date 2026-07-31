import { CanvasNodeType, type CanvasNodeData, type CanvasWorkflowQcBadgeMetadata, type CanvasWorkflowRepairedProjectionMetadata } from "@/types/canvas";
import { readExpectedImageSet, readProductionState, WORKFLOW_COUNT_DATA_MISSING_MESSAGE } from "@/lib/canvas/canvas-workflow-production";

// EX-01：返修投影入口休眠；接回时改为 true 并更新对应合同测试。
export const REPAIR_PROJECTION_ENTRY_ENABLED = false;

const PRODUCTION_ORIGIN = "http://127.0.0.1:17373";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type WorkflowQcSummary = {
    ok: true;
    batchId: string;
    totalCount: number;
    expectedConfigIds: string[];
    reportSha256: string;
    images: Array<{ configId: string; status: "pass" | "fail" | "needs_review"; issueCount: number; topCategories: string[] }>;
};

export function buildQcSummaryUrl(baseUrl: string, batchId: string) {
    try {
        const base = new URL(baseUrl);
        if (base.origin !== PRODUCTION_ORIGIN || base.pathname !== "/" || base.search || base.hash || !batchId) return null;
        return `${PRODUCTION_ORIGIN}/workflow-production/${encodeURIComponent(batchId)}/qc-summary`;
    } catch {
        return null;
    }
}

export async function fetchWorkflowQcSummary(batchId: string, token: string, fetcher: typeof fetch = globalThis.fetch): Promise<WorkflowQcSummary | null> {
    const url = buildQcSummaryUrl(`${PRODUCTION_ORIGIN}/`, batchId);
    if (!url || !token.trim()) return null;
    const response = await fetcher(url, { method: "GET", headers: { "X-Canvas-Agent-Token": token.trim() } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("qc summary unavailable");
    const payload: unknown = await response.json();
    if (!validQcSummary(payload, batchId)) throw new Error(qcCountError(payload) ? WORKFLOW_COUNT_DATA_MISSING_MESSAGE : "qc summary invalid");
    return payload;
}

export function applyQcSummaryToNodes(nodes: CanvasNodeData[], batchId: string, summary: WorkflowQcSummary) {
    const byConfig = new Map(summary.images.map((item) => [item.configId, item] as const));
    let changed = false;
    const nextNodes = nodes.map((node) => {
        const proof = node.metadata?.workflowProductionOutput;
        if (node.type !== CanvasNodeType.Image || proof?.batchId !== batchId) return node;
        if (proof.source !== "renders" || !node.metadata?.storageKey || !SHA256_PATTERN.test(proof.sha256)) {
            if (!node.metadata?.workflowProductionQc) return node;
            const { workflowProductionQc: _removed, ...metadata } = node.metadata;
            changed = true;
            return { ...node, metadata };
        }
        const badge = byConfig.get(proof.configId);
        if (!badge || qcBadgeMatches(node.metadata?.workflowProductionQc, badge)) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, workflowProductionQc: { status: badge.status, issueCount: badge.issueCount, topCategories: [...badge.topCategories] } } };
    });
    return changed ? nextNodes : nodes;
}

export function qcSummaryNeedsApplication(nodes: CanvasNodeData[], batchId: string, summary: WorkflowQcSummary) {
    const byConfig = new Map(summary.images.map((item) => [item.configId, item] as const));
    return nodes.some((node) => {
        const proof = node.metadata?.workflowProductionOutput;
        if (node.type !== CanvasNodeType.Image || proof?.batchId !== batchId) return false;
        if (proof.source !== "renders" || !node.metadata?.storageKey || !SHA256_PATTERN.test(proof.sha256)) return Boolean(node.metadata?.workflowProductionQc);
        const badge = byConfig.get(proof.configId);
        return Boolean(badge && !qcBadgeMatches(node.metadata?.workflowProductionQc, badge));
    });
}

export function qcBadgeView(badge: CanvasWorkflowQcBadgeMetadata | undefined) {
    if (!badge) return null;
    if (badge.status === "fail") return { text: `${badge.issueCount} 个问题`, tone: "problem" as const };
    if (badge.status === "needs_review") return { text: "待核对", tone: "review" as const };
    return { text: "通过", tone: "pass" as const };
}

export function buildRepairedProjectionRequest(batchId: string, requestId: string, now: number): CanvasWorkflowRepairedProjectionMetadata {
    return { status: "queued", batchId, requestId, requestedAt: now, projectedCount: 0 };
}

export function repairedProjectionCanStart(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Workflow && readProductionState(node.metadata).status === "completed" && node.metadata?.workflowRepairedProjection?.status !== "queued" && node.metadata?.workflowRepairedProjection?.status !== "running";
}

function validQcSummary(payload: unknown, batchId: string): payload is WorkflowQcSummary {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as Partial<WorkflowQcSummary>;
    const countInfo = readExpectedImageSet(value.totalCount, value.expectedConfigIds);
    if (value.ok !== true || value.batchId !== batchId || !countInfo || !SHA256_PATTERN.test(value.reportSha256 || "") || !Array.isArray(value.images) || value.images.length !== countInfo.totalCount) return false;
    const configIds = new Set(countInfo.expectedConfigIds);
    const seen = new Set<string>();
    for (const image of value.images) {
        if (!image || typeof image !== "object" || !configIds.has(image.configId) || seen.has(image.configId)) return false;
        if (!["pass", "fail", "needs_review"].includes(image.status) || !Number.isInteger(image.issueCount) || image.issueCount < 0 || !Array.isArray(image.topCategories) || image.topCategories.length > 3 || image.topCategories.some((item) => typeof item !== "string")) return false;
        if ((image.status === "fail") !== (image.issueCount > 0)) return false;
        seen.add(image.configId);
    }
    return seen.size === countInfo.totalCount;
}

function qcCountError(payload: unknown) {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as Partial<WorkflowQcSummary>;
    return value.ok === true && !readExpectedImageSet(value.totalCount, value.expectedConfigIds);
}

function qcBadgeMatches(current: CanvasWorkflowQcBadgeMetadata | undefined, next: WorkflowQcSummary["images"][number]) {
    return current?.status === next.status && current.issueCount === next.issueCount && current.topCategories.length === next.topCategories.length && current.topCategories.every((item, index) => item === next.topCategories[index]);
}
