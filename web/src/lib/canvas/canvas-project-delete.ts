import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const PROJECT_DELETION_ORIGIN = "http://127.0.0.1:17373";
export const PROJECT_DELETION_PREVIEW_URL = `${PROJECT_DELETION_ORIGIN}/project-deletion/preview`;
export const PROJECT_DELETION_EXECUTE_URL = `${PROJECT_DELETION_ORIGIN}/project-deletion/execute`;
export const CLOSED_BATCH_CONFIRMATION_TEXT = "确认删除已关账批次";
export const DELETE_ALL_CONFIRMATION_TEXT = "删除全部";
export const PROJECT_DELETION_UNAVAILABLE_MESSAGE = "本机项目删除服务尚未就绪，项目没有删除。";
export const PROJECT_DELETION_UNTRUSTED_MESSAGE = "本机项目删除服务没有返回可信回执，项目没有删除。";
export const PROJECT_DELETION_MAX_BATCHES = 100;
export const PROJECT_DELETION_MAX_BATCH_ID_LENGTH = 120;
export const PROJECT_DELETION_MAX_REQUEST_ID_LENGTH = 8192;
export const PROJECT_DELETION_TOO_MANY_BATCHES_MESSAGE = "一次最多可安全删除 100 个关联批次，本次没有删除。请减少所选项目后重试。";
export const PROJECT_DELETION_INVALID_BATCH_LIST_MESSAGE = "关联批次清单包含无法安全识别的批次号，本次没有删除。";

export type ProjectDeletionPreviewStatus = "in_production" | "closed" | "delivered" | "recycled" | "deletion_pending" | "deleted";
export type ProjectDeletionExecuteStatus = "deleted" | "already_deleted" | "failed" | "not_started";

export type ProjectDeletionPreviewBatch = {
    batchId: string;
    status: ProjectDeletionPreviewStatus;
    closed: boolean;
    delivered: boolean;
    recycled: boolean;
    requiresTypedConfirmation: boolean;
};

export type ProjectDeletionPreviewReceipt = {
    ok: true;
    requestId: string;
    batches: ProjectDeletionPreviewBatch[];
};

export type ProjectDeletionExecuteBatch = {
    batchId: string;
    status: ProjectDeletionExecuteStatus;
    message: string;
};

export type ProjectDeletionExecuteReceipt =
    | {
          ok: true;
          requestId: string;
          status: "completed";
          batches: ProjectDeletionExecuteBatch[];
      }
    | {
          ok: false;
          requestId: string;
          status: "stopped";
          batches: ProjectDeletionExecuteBatch[];
      };

export type ProjectDeletionPlan = {
    ok: true;
    projectIds: string[];
    batchIds: string[];
    deleteAll: boolean;
};

export type ProjectDeletionPlanFailure = {
    ok: false;
    message: string;
};

const PREVIEW_STATUSES = new Set<ProjectDeletionPreviewStatus>(["in_production", "closed", "delivered", "recycled", "deletion_pending", "deleted"]);
const EXECUTE_STATUSES = new Set<ProjectDeletionExecuteStatus>(["deleted", "already_deleted", "failed", "not_started"]);
const PREVIEW_KEYS = ["batches", "ok", "requestId"] as const;
const PREVIEW_BATCH_KEYS = ["batchId", "closed", "delivered", "recycled", "requiresTypedConfirmation", "status"] as const;
const EXECUTE_KEYS = ["batches", "ok", "requestId", "status"] as const;
const EXECUTE_BATCH_KEYS = ["batchId", "message", "status"] as const;
const KNOWN_REJECTION_KEYS = ["batchId", "error", "message", "ok"] as const;

export function buildProjectDeletionPlan(allProjects: readonly CanvasProject[], requestedProjectIds: readonly string[], deleteAll: boolean): ProjectDeletionPlan | ProjectDeletionPlanFailure {
    const projectIds = uniqueSorted(requestedProjectIds);
    if (!projectIds.length) return { ok: false, message: "没有选中要删除的项目。" };
    if (deleteAll) {
        const allProjectIds = uniqueSorted(allProjects.map((project) => project.id));
        if (!sameStrings(projectIds, allProjectIds)) return { ok: false, message: "项目列表已经变化，请重新点击“删除全部”并再次确认。" };
    }

    const selectedIds = new Set(projectIds);
    const targetProjects = projectIds.map((id) => allProjects.find((project) => project.id === id));
    if (targetProjects.some((project) => !project)) return { ok: false, message: "有项目已经不存在，请关闭提示后重新选择。" };

    const collected = new Set<string>();
    for (const project of targetProjects as CanvasProject[]) {
        const result = collectRegisteredProjectBatchIds(project);
        if (!result.ok) return result;
        result.batchIds.forEach((batchId) => collected.add(batchId));
    }

    const batchIds = [...collected].sort();
    if (batchIds.length > PROJECT_DELETION_MAX_BATCHES) return { ok: false, message: PROJECT_DELETION_TOO_MANY_BATCHES_MESSAGE };
    if (batchIds.length) {
        const survivingReferences = collectKnownBatchReferences(allProjects.filter((project) => !selectedIds.has(project.id)));
        const shared = batchIds.filter((batchId) => survivingReferences.has(batchId));
        if (shared.length) {
            return {
                ok: false,
                message: `批次 ${shared.join("、")} 仍被其他项目引用。为避免影响其他项目，本次没有删除任何项目或批次。`,
            };
        }
    }

    return { ok: true, projectIds, batchIds, deleteAll };
}

export function sameProjectDeletionPlan(first: ProjectDeletionPlan, second: ProjectDeletionPlan) {
    return first.deleteAll === second.deleteAll && sameStrings(first.projectIds, second.projectIds) && sameStrings(first.batchIds, second.batchIds);
}

export async function previewProjectDeletion(batchIds: readonly string[], token: string, fetcher: typeof fetch = globalThis.fetch): Promise<ProjectDeletionPreviewReceipt> {
    const normalizedBatchIds = normalizeBatchIds(batchIds);
    if (!normalizedBatchIds.length) return { ok: true, requestId: "", batches: [] };
    if (!token.trim()) throw new Error(PROJECT_DELETION_UNAVAILABLE_MESSAGE);

    let response: Response;
    try {
        response = await fetcher(PROJECT_DELETION_PREVIEW_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Canvas-Agent-Token": token.trim(),
            },
            body: JSON.stringify({ batchIds: normalizedBatchIds }),
        });
    } catch {
        throw new Error(PROJECT_DELETION_UNAVAILABLE_MESSAGE);
    }

    const payload = await readResponseJson(response);
    if (response.status === 409 && validKnownRejection(payload, normalizedBatchIds)) throw new Error(payload.message);
    if (!response.ok || !validPreviewReceipt(payload, normalizedBatchIds)) throw new Error(PROJECT_DELETION_UNTRUSTED_MESSAGE);
    return payload;
}

export async function submitProjectDeletionExecution(requestId: string, batchIds: readonly string[], token: string, fetcher: typeof fetch = globalThis.fetch): Promise<ProjectDeletionExecuteReceipt> {
    const normalizedBatchIds = normalizeBatchIds(batchIds);
    if (!safeText(requestId, PROJECT_DELETION_MAX_REQUEST_ID_LENGTH) || !normalizedBatchIds.length || !token.trim()) throw new Error(PROJECT_DELETION_UNAVAILABLE_MESSAGE);

    let response: Response;
    try {
        response = await fetcher(PROJECT_DELETION_EXECUTE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Canvas-Agent-Token": token.trim(),
            },
            body: JSON.stringify({ requestId, batchIds: normalizedBatchIds }),
        });
    } catch {
        throw new Error(PROJECT_DELETION_UNAVAILABLE_MESSAGE);
    }

    const payload = await readResponseJson(response);
    if (!response.ok || !validExecuteReceipt(payload, requestId, normalizedBatchIds)) throw new Error(PROJECT_DELETION_UNTRUSTED_MESSAGE);
    return payload;
}

export function confirmationTextForProjectDeletion(deleteAll: boolean, preview: ProjectDeletionPreviewReceipt) {
    if (deleteAll) return DELETE_ALL_CONFIRMATION_TEXT;
    return preview.batches.some((batch) => batch.requiresTypedConfirmation) ? CLOSED_BATCH_CONFIRMATION_TEXT : null;
}

export function projectDeletionConfirmationMatches(input: string, requiredText: string | null) {
    return requiredText === null || input === requiredText;
}

export function projectDeletionPreviewStatusLabel(status: ProjectDeletionPreviewStatus) {
    if (status === "closed") return "已关账";
    if (status === "delivered") return "已交付";
    if (status === "recycled") return "已回收";
    if (status === "deletion_pending") return "上次删除未完成，可继续";
    if (status === "deleted") return "已删除，可继续移除项目";
    return "在产";
}

export function groupProjectDeletionResults(batches: readonly ProjectDeletionExecuteBatch[]) {
    return {
        deleted: batches.filter((batch) => batch.status === "deleted" || batch.status === "already_deleted"),
        failed: batches.filter((batch) => batch.status === "failed"),
        notStarted: batches.filter((batch) => batch.status === "not_started"),
    };
}

export async function commitFrontendProjectDeletion(receipt: ProjectDeletionExecuteReceipt, projectIds: string[], deleteProjects: (ids: string[]) => Promise<void>, cleanupImages: () => void) {
    if (receipt.status !== "completed" || !receipt.ok || receipt.batches.some((batch) => batch.status !== "deleted" && batch.status !== "already_deleted")) return false;
    await deleteProjects(projectIds);
    cleanupImages();
    return true;
}

function collectRegisteredProjectBatchIds(project: CanvasProject): { ok: true; batchIds: string[] } | ProjectDeletionPlanFailure {
    const batchIds: string[] = [];
    for (const node of project.nodes) {
        if (node.type !== CanvasNodeType.BatchInfo) continue;
        const intake = node.metadata?.batchIntake;
        if (!intake) continue;
        if (intake.status === "queued" || intake.status === "upload_ready" || intake.status === "uploading") {
            return { ok: false, message: `项目“${project.title}”仍有批次正在登记。为避免留下半成品，本次没有删除。` };
        }
        if (intake.status !== "completed") {
            if (intake.batchId || intake.receipt) return { ok: false, message: `项目“${project.title}”的批次登记记录不完整，无法安全核对，本次没有删除。` };
            continue;
        }
        const batchId = intake.receipt?.batchId;
        if (!validBatchId(batchId) || (intake.batchId && intake.batchId !== batchId)) {
            return { ok: false, message: `项目“${project.title}”的完成态信息卡缺少可信批次号，无法安全核对，本次没有删除。` };
        }
        batchIds.push(batchId);
    }
    return { ok: true, batchIds: uniqueSorted(batchIds) };
}

function collectKnownBatchReferences(projects: readonly CanvasProject[]) {
    const references = new Set<string>();
    projects.forEach((project) =>
        project.nodes.forEach((node) => {
            knownNodeBatchReferences(node).forEach((batchId) => {
                if (validBatchId(batchId)) references.add(batchId);
            });
        }),
    );
    return references;
}

function knownNodeBatchReferences(node: CanvasNodeData) {
    const metadata = node.metadata;
    return [
        metadata?.batchIntake?.batchId,
        metadata?.batchIntake?.receipt?.batchId,
        metadata?.styleReferenceIntake?.batchId,
        metadata?.styleReferenceIntake?.receipt?.batchId,
        metadata?.workflowProduction?.batchId,
        metadata?.workflowProductionOutput?.batchId,
        metadata?.workflowRepairedProjection?.batchId,
        metadata?.workflowReceivingBox?.batchId,
    ].filter((value): value is string => typeof value === "string");
}

function normalizeBatchIds(batchIds: readonly string[]) {
    if (batchIds.length > PROJECT_DELETION_MAX_BATCHES) throw new Error(PROJECT_DELETION_TOO_MANY_BATCHES_MESSAGE);
    const normalized = uniqueSorted(batchIds);
    if (normalized.length !== batchIds.length || normalized.some((batchId) => !validBatchId(batchId))) throw new Error(PROJECT_DELETION_INVALID_BATCH_LIST_MESSAGE);
    return normalized;
}

function validPreviewReceipt(value: unknown, expectedBatchIds: string[]): value is ProjectDeletionPreviewReceipt {
    if (!exactObject(value, PREVIEW_KEYS) || value.ok !== true || !safeText(value.requestId, PROJECT_DELETION_MAX_REQUEST_ID_LENGTH) || !Array.isArray(value.batches) || value.batches.length !== expectedBatchIds.length) return false;
    return value.batches.every((item, index) => {
        if (!exactObject(item, PREVIEW_BATCH_KEYS)) return false;
        if (item.batchId !== expectedBatchIds[index] || !PREVIEW_STATUSES.has(item.status as ProjectDeletionPreviewStatus)) return false;
        if (![item.closed, item.delivered, item.recycled, item.requiresTypedConfirmation].every((flag) => typeof flag === "boolean")) return false;
        return validPreviewLifecycle(item as ProjectDeletionPreviewBatch) && item.requiresTypedConfirmation === (item.closed || item.delivered);
    });
}

function validPreviewLifecycle(item: ProjectDeletionPreviewBatch) {
    if (item.status === "in_production") return !item.closed && !item.delivered && !item.recycled;
    if (item.status === "closed") return item.closed && !item.delivered && !item.recycled;
    if (item.status === "delivered") return item.delivered && !item.recycled;
    if (item.status === "recycled") return item.recycled;
    return true;
}

function validExecuteReceipt(value: unknown, requestId: string, expectedBatchIds: string[]): value is ProjectDeletionExecuteReceipt {
    if (!exactObject(value, EXECUTE_KEYS) || value.requestId !== requestId || !Array.isArray(value.batches) || value.batches.length !== expectedBatchIds.length) return false;
    if (!((value.ok === true && value.status === "completed") || (value.ok === false && value.status === "stopped"))) return false;
    const batchesValid = value.batches.every((item, index) => {
        if (!exactObject(item, EXECUTE_BATCH_KEYS)) return false;
        return item.batchId === expectedBatchIds[index] && EXECUTE_STATUSES.has(item.status as ProjectDeletionExecuteStatus) && safeText(item.message, 500);
    });
    if (!batchesValid) return false;
    if (value.status === "completed") return value.batches.every((item) => item.status === "deleted" || item.status === "already_deleted");
    return value.batches.some((item) => item.status === "failed");
}

function validKnownRejection(value: unknown, expectedBatchIds: string[]): value is { ok: false; error: "project_deletion_rejected"; batchId: string; message: string } {
    return exactObject(value, KNOWN_REJECTION_KEYS) && value.ok === false && value.error === "project_deletion_rejected" && typeof value.batchId === "string" && expectedBatchIds.includes(value.batchId) && safeText(value.message, 500);
}

async function readResponseJson(response: Response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function exactObject(value: unknown, expectedKeys: readonly string[]): value is Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validBatchId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= PROJECT_DELETION_MAX_BATCH_ID_LENGTH && value === value.trim() && value !== "." && value !== ".." && !/[\/\\\u0000-\u001f\u007f]/u.test(value);
}

function safeText(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function uniqueSorted(values: readonly string[]) {
    return [...new Set(values)].sort();
}

function sameStrings(first: readonly string[], second: readonly string[]) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}
