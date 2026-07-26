import { WORKFLOW_PRODUCTION_ORIGIN } from "@/lib/canvas/canvas-workflow-production";

export const BATCH_RECYCLE_UNAVAILABLE_MESSAGE = "本机批次回收服务尚未就绪，请重新启动画布服务后再试。";
export const BATCH_RECYCLE_UNTRUSTED_MESSAGE = "本机批次回收服务没有返回可信回执，本次未自动重试。";

export type BatchRecycleSuccess = {
    ok: true;
    batchId: string;
    status: "recycled";
    message: string;
};

export type BatchRecycleButtonPhase = "idle" | "confirming" | "submitting" | "succeeded" | "failed";

const SUCCESS_KEYS = ["batchId", "message", "ok", "status"] as const;
const FAILURE_KEYS = ["batchId", "error", "message", "ok"] as const;
const SAFE_MESSAGE_LIMIT = 400;

export function buildBatchRecycleUrl(baseUrl: string, batchId: string) {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        return null;
    }
    if (
        parsed.origin !== WORKFLOW_PRODUCTION_ORIGIN ||
        !["", "/"].includes(parsed.pathname) ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password ||
        !validBatchId(batchId)
    ) {
        return null;
    }
    return `${WORKFLOW_PRODUCTION_ORIGIN}/batch-recycle/${encodeURIComponent(batchId)}`;
}

export async function submitBatchRecycle(
    batchId: string,
    token: string,
    fetcher: typeof fetch = globalThis.fetch,
): Promise<BatchRecycleSuccess> {
    const url = buildBatchRecycleUrl(WORKFLOW_PRODUCTION_ORIGIN, batchId);
    if (!url || !token.trim()) throw new Error(BATCH_RECYCLE_UNAVAILABLE_MESSAGE);

    let response: Response;
    try {
        response = await fetcher(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Canvas-Agent-Token": token.trim(),
            },
            body: "{}",
        });
    } catch {
        throw new Error(BATCH_RECYCLE_UNAVAILABLE_MESSAGE);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
    }

    if (response.ok && validSuccess(payload, batchId)) return payload;
    if (!response.ok && validKnownFailure(payload, batchId)) throw new Error(payload.message);
    throw new Error(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
}

export function advanceBatchRecycleButton(phase: BatchRecycleButtonPhase): {
    phase: BatchRecycleButtonPhase;
    shouldSubmit: boolean;
} {
    if (phase === "idle" || phase === "failed") return { phase: "confirming", shouldSubmit: false };
    if (phase === "confirming") return { phase: "submitting", shouldSubmit: true };
    return { phase, shouldSubmit: false };
}

export function batchRecycleButtonDisabled(phase: BatchRecycleButtonPhase) {
    return phase === "submitting" || phase === "succeeded";
}

export function batchRecycleButtonLabel(phase: BatchRecycleButtonPhase) {
    if (phase === "confirming") return "确认移入回收站";
    if (phase === "submitting") return "正在移入回收站…";
    if (phase === "succeeded") return "已移入回收站";
    if (phase === "failed") return "重新确认移入回收站";
    return "移入回收站";
}

function validBatchId(batchId: string) {
    return Boolean(
        batchId &&
            batchId === batchId.trim() &&
            batchId !== "." &&
            batchId !== ".." &&
            !/[\/\\\0]/u.test(batchId),
    );
}

function exactObject(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function safeMessage(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= SAFE_MESSAGE_LIMIT &&
        value === value.trim() &&
        !/[\u0000-\u001f\u007f]/u.test(value)
    );
}

function validSuccess(value: unknown, batchId: string): value is BatchRecycleSuccess {
    return (
        exactObject(value, SUCCESS_KEYS) &&
        value.ok === true &&
        value.batchId === batchId &&
        value.status === "recycled" &&
        safeMessage(value.message)
    );
}

function validKnownFailure(
    value: unknown,
    batchId: string,
): value is { ok: false; error: "batch_recycle_rejected"; batchId: string; message: string } {
    return (
        exactObject(value, FAILURE_KEYS) &&
        value.ok === false &&
        value.error === "batch_recycle_rejected" &&
        value.batchId === batchId &&
        safeMessage(value.message)
    );
}
