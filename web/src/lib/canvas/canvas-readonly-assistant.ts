export const READONLY_ASSISTANT_ENDPOINT = "http://127.0.0.1:17373";
export const READONLY_ASSISTANT_MAX_WAIT_MS = 300_000;
export const READONLY_ASSISTANT_POLL_MS = 2_000;
export const READONLY_ASSISTANT_MAX_HISTORY_ITEMS = 8;
export const READONLY_ASSISTANT_MAX_HISTORY_BYTES = 8 * 1024;
export const READONLY_ASSISTANT_TIMEOUT_MESSAGE = "助手查看超时，已停止等待，未自动重试。";

export type ReadonlyAssistantHistoryItem = {
    role: "user" | "assistant";
    content: string;
};

export type ReadonlyAssistantSnapshot = {
    ok: true;
    requestId: string;
    status: "working" | "completed" | "failed";
    message: string;
    startedAt: number;
    updatedAt: number;
    deadlineAt: number;
    answer?: string;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type HistoryMessage = { role: string; text: string };

export async function submitReadonlyAssistantQuestion(question: string, history: ReadonlyAssistantHistoryItem[], token: string, fetcher: Fetcher = fetch): Promise<ReadonlyAssistantSnapshot> {
    const normalizedToken = token.trim();
    if (!normalizedToken) throw new Error("没有发现本机连接令牌，请先连接本地 Agent。");
    const response = await fetcher(`${READONLY_ASSISTANT_ENDPOINT}/readonly-assistant/questions`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-canvas-agent-token": normalizedToken,
        },
        body: JSON.stringify({ question, history }),
    });
    return readAssistantResponse(response);
}

export async function fetchReadonlyAssistantStatus(requestId: string, token: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<ReadonlyAssistantSnapshot> {
    const response = await fetcher(`${READONLY_ASSISTANT_ENDPOINT}/readonly-assistant/questions/${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: { "x-canvas-agent-token": token.trim() },
        signal,
    });
    return readAssistantResponse(response);
}

export async function pollReadonlyAssistant(
    initial: ReadonlyAssistantSnapshot,
    token: string,
    options: {
        fetcher?: Fetcher;
        sleep?: (milliseconds: number) => Promise<void>;
        now?: () => number;
        pollMs?: number;
        maxWaitMs?: number;
        onSnapshot?: (snapshot: ReadonlyAssistantSnapshot) => void;
    } = {},
): Promise<ReadonlyAssistantSnapshot> {
    const fetcher = options.fetcher || fetch;
    const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
    const now = options.now || Date.now;
    const pollMs = options.pollMs ?? READONLY_ASSISTANT_POLL_MS;
    const maxWaitMs = options.maxWaitMs ?? READONLY_ASSISTANT_MAX_WAIT_MS;
    if (!(pollMs > 0) || !(maxWaitMs > 0 && maxWaitMs <= READONLY_ASSISTANT_MAX_WAIT_MS)) {
        throw new Error("只读助手等待时间必须在 300 秒以内。");
    }

    let snapshot = initial;
    const localDeadline = now() + maxWaitMs;
    while (snapshot.status === "working") {
        const deadline = Math.min(localDeadline, snapshot.deadlineAt || localDeadline);
        const remaining = deadline - now();
        if (remaining <= 0) {
            snapshot = mergeReadonlyAssistantSnapshot(snapshot, {
                ...snapshot,
                status: "failed",
                message: READONLY_ASSISTANT_TIMEOUT_MESSAGE,
                updatedAt: now(),
            });
            options.onSnapshot?.(snapshot);
            return snapshot;
        }
        await sleep(Math.min(pollMs, remaining));
        const requestRemaining = Math.min(localDeadline, snapshot.deadlineAt || localDeadline) - now();
        if (requestRemaining <= 0) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestRemaining);
        let next: ReadonlyAssistantSnapshot;
        try {
            next = await fetchReadonlyAssistantStatus(snapshot.requestId, token, fetcher, controller.signal);
        } catch (error) {
            if (!controller.signal.aborted) throw error;
            snapshot = timeoutSnapshot(snapshot, now());
            options.onSnapshot?.(snapshot);
            return snapshot;
        } finally {
            clearTimeout(timer);
        }
        snapshot = mergeReadonlyAssistantSnapshot(snapshot, next);
        options.onSnapshot?.(snapshot);
    }
    return snapshot;
}

export function mergeReadonlyAssistantSnapshot(previous: ReadonlyAssistantSnapshot, next: ReadonlyAssistantSnapshot): ReadonlyAssistantSnapshot {
    if (
        previous.requestId === next.requestId &&
        previous.status === next.status &&
        previous.message === next.message &&
        previous.startedAt === next.startedAt &&
        previous.updatedAt === next.updatedAt &&
        previous.deadlineAt === next.deadlineAt &&
        previous.answer === next.answer
    ) {
        return previous;
    }
    return next;
}

export function readonlyAssistantHistory(messages: HistoryMessage[]): ReadonlyAssistantHistoryItem[] {
    const candidates = messages
        .filter((item): item is HistoryMessage & { role: "user" | "assistant" } => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role, content: item.text.trim() }))
        .filter((item) => Boolean(item.content))
        .slice(-READONLY_ASSISTANT_MAX_HISTORY_ITEMS);
    while (candidates.length && utf8Size(JSON.stringify(candidates)) > READONLY_ASSISTANT_MAX_HISTORY_BYTES) {
        if (candidates.length > 1) {
            candidates.shift();
        } else {
            candidates[0] = {
                ...candidates[0],
                content: truncateUtf8(candidates[0].content, READONLY_ASSISTANT_MAX_HISTORY_BYTES - 64),
            };
            break;
        }
    }
    return candidates;
}

async function readAssistantResponse(response: Response): Promise<ReadonlyAssistantSnapshot> {
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error("只读助手返回了无法识别的结果。");
    }
    if (!response.ok) {
        const message = objectText(payload, "message");
        throw new Error(message || "只读助手拒绝了本次问题。");
    }
    if (!isAssistantSnapshot(payload)) throw new Error("只读助手返回了无法识别的结果。");
    return payload;
}

function isAssistantSnapshot(value: unknown): value is ReadonlyAssistantSnapshot {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Record<string, unknown>;
    return (
        snapshot.ok === true &&
        typeof snapshot.requestId === "string" &&
        ["working", "completed", "failed"].includes(String(snapshot.status)) &&
        typeof snapshot.message === "string" &&
        typeof snapshot.startedAt === "number" &&
        typeof snapshot.updatedAt === "number" &&
        typeof snapshot.deadlineAt === "number" &&
        (snapshot.answer === undefined || typeof snapshot.answer === "string")
    );
}

function timeoutSnapshot(snapshot: ReadonlyAssistantSnapshot, updatedAt: number) {
    return mergeReadonlyAssistantSnapshot(snapshot, {
        ...snapshot,
        status: "failed",
        message: READONLY_ASSISTANT_TIMEOUT_MESSAGE,
        updatedAt,
    });
}

function objectText(value: unknown, key: string) {
    return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string" ? String((value as Record<string, unknown>)[key]) : "";
}

function truncateUtf8(value: string, maxBytes: number) {
    let result = "";
    for (const character of value) {
        if (utf8Size(result + character) > maxBytes) break;
        result += character;
    }
    return result;
}

function utf8Size(value: string) {
    return new TextEncoder().encode(value).byteLength;
}
