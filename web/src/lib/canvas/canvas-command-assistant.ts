import {
    pollReadonlyAssistant,
    submitReadonlyAssistantQuestion,
    type ReadonlyAssistantHistoryItem,
    type ReadonlyAssistantSnapshot,
} from "@/lib/canvas/canvas-readonly-assistant";


export const COMMAND_ASSISTANT_ENDPOINT = "http://127.0.0.1:17373";
export const COMMAND_ASSISTANT_MAX_WAIT_MS = 300_000;
export const COMMAND_ASSISTANT_POLL_MS = 2_000;
export const COMMAND_ASSISTANT_TIMEOUT_MESSAGE = "指令辨认超时，已停止；没有发出命令、没有产生费用。";

export const COMMAND_ASSISTANT_STEPS = [
    "identity",
    "style_master",
    "angle_inventory",
    "main_vc",
    "detail_vc",
    "final_prompts",
    "integrity",
    "renders",
    "qc",
] as const;

export type CommandAssistantStep = (typeof COMMAND_ASSISTANT_STEPS)[number];
export type ClosedWorkflowCommand = "run: next" | `run: ${CommandAssistantStep}` | `retry: ${CommandAssistantStep}`;
export type CommandAssistantDraft = {
    command: ClosedWorkflowCommand;
    verb: "run" | "retry";
    target: "next" | CommandAssistantStep;
    title: string;
    description: string;
};

export const CLOSED_WORKFLOW_COMMANDS: ReadonlySet<string> = new Set<string>([
    "run: next",
    ...COMMAND_ASSISTANT_STEPS.map((step) => `run: ${step}`),
    ...COMMAND_ASSISTANT_STEPS.map((step) => `retry: ${step}`),
]);

export type CommandAssistantSnapshot = {
    ok: true;
    requestId: string;
    status: "working" | "completed" | "failed";
    message: string;
    startedAt: number;
    updatedAt: number;
    deadlineAt: number;
    intent?: "command" | "question" | "unsupported";
    route?: "readonly";
    draft?: CommandAssistantDraft;
};

export type BatchAssistantTurnResult =
    | { kind: "draft"; draft: CommandAssistantDraft }
    | { kind: "answer"; text: string }
    | { kind: "message"; text: string }
    | { kind: "error"; text: string };

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function isClosedWorkflowCommand(value: unknown): value is ClosedWorkflowCommand {
    return typeof value === "string" && CLOSED_WORKFLOW_COMMANDS.has(value);
}

export function requireClosedWorkflowCommand(value: unknown): ClosedWorkflowCommand {
    if (!isClosedWorkflowCommand(value)) throw new Error("命令没有命中允许的封闭命令词汇。");
    return value;
}

export async function submitCommandAssistantIntent(
    utterance: string,
    token: string,
    fetcher: Fetcher = fetch,
): Promise<CommandAssistantSnapshot> {
    const normalizedToken = token.trim();
    if (!normalizedToken) throw new Error("没有发现本机连接令牌，请先连接本地 Agent。");
    const response = await fetcher(`${COMMAND_ASSISTANT_ENDPOINT}/command-assistant/drafts`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-canvas-agent-token": normalizedToken,
        },
        body: JSON.stringify({ utterance }),
    });
    return readCommandAssistantResponse(response);
}

export async function fetchCommandAssistantStatus(
    requestId: string,
    token: string,
    fetcher: Fetcher = fetch,
    signal?: AbortSignal,
): Promise<CommandAssistantSnapshot> {
    const response = await fetcher(
        `${COMMAND_ASSISTANT_ENDPOINT}/command-assistant/drafts/${encodeURIComponent(requestId)}`,
        {
            method: "GET",
            headers: { "x-canvas-agent-token": token.trim() },
            signal,
        },
    );
    return readCommandAssistantResponse(response);
}

export async function pollCommandAssistant(
    initial: CommandAssistantSnapshot,
    token: string,
    options: {
        fetcher?: Fetcher;
        sleep?: (milliseconds: number) => Promise<void>;
        now?: () => number;
        pollMs?: number;
        maxWaitMs?: number;
        onSnapshot?: (snapshot: CommandAssistantSnapshot) => void;
    } = {},
): Promise<CommandAssistantSnapshot> {
    const fetcher = options.fetcher || fetch;
    const sleep =
        options.sleep ||
        ((milliseconds: number) =>
            new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)));
    const now = options.now || Date.now;
    const pollMs = options.pollMs ?? COMMAND_ASSISTANT_POLL_MS;
    const maxWaitMs = options.maxWaitMs ?? COMMAND_ASSISTANT_MAX_WAIT_MS;
    if (!(pollMs > 0) || !(maxWaitMs > 0 && maxWaitMs <= COMMAND_ASSISTANT_MAX_WAIT_MS)) {
        throw new Error("指令助手等待时间必须在 300 秒以内。");
    }

    let snapshot = initial;
    const localDeadline = now() + maxWaitMs;
    while (snapshot.status === "working") {
        const deadline = Math.min(localDeadline, snapshot.deadlineAt || localDeadline);
        const remaining = deadline - now();
        if (remaining <= 0) {
            snapshot = timeoutSnapshot(snapshot, now());
            options.onSnapshot?.(snapshot);
            return snapshot;
        }
        await sleep(Math.min(pollMs, remaining));
        const requestRemaining = Math.min(localDeadline, snapshot.deadlineAt || localDeadline) - now();
        if (requestRemaining <= 0) continue;
        const controller = new AbortController();
        const timer = globalThis.setTimeout(() => controller.abort(), requestRemaining);
        let next: CommandAssistantSnapshot;
        try {
            next = await fetchCommandAssistantStatus(snapshot.requestId, token, fetcher, controller.signal);
        } catch (error) {
            if (!controller.signal.aborted) throw error;
            snapshot = timeoutSnapshot(snapshot, now());
            options.onSnapshot?.(snapshot);
            return snapshot;
        } finally {
            globalThis.clearTimeout(timer);
        }
        snapshot = mergeCommandAssistantSnapshot(snapshot, next);
        options.onSnapshot?.(snapshot);
    }
    return snapshot;
}

export function mergeCommandAssistantSnapshot(
    previous: CommandAssistantSnapshot,
    next: CommandAssistantSnapshot,
): CommandAssistantSnapshot {
    if (
        previous.requestId === next.requestId &&
        previous.status === next.status &&
        previous.message === next.message &&
        previous.startedAt === next.startedAt &&
        previous.updatedAt === next.updatedAt &&
        previous.deadlineAt === next.deadlineAt &&
        previous.intent === next.intent &&
        previous.route === next.route &&
        sameDraft(previous.draft, next.draft)
    ) {
        return previous;
    }
    return next;
}

export async function resolveBatchAssistantTurn(
    utterance: string,
    history: ReadonlyAssistantHistoryItem[],
    token: string,
    options: {
        submitCommand?: typeof submitCommandAssistantIntent;
        pollCommand?: typeof pollCommandAssistant;
        submitReadonly?: typeof submitReadonlyAssistantQuestion;
        pollReadonly?: typeof pollReadonlyAssistant;
        onCommandSnapshot?: (snapshot: CommandAssistantSnapshot) => void;
        onReadonlySnapshot?: (snapshot: ReadonlyAssistantSnapshot) => void;
    } = {},
): Promise<BatchAssistantTurnResult> {
    const submitCommand = options.submitCommand || submitCommandAssistantIntent;
    const pollCommand = options.pollCommand || pollCommandAssistant;
    const submitReadonly = options.submitReadonly || submitReadonlyAssistantQuestion;
    const pollReadonly = options.pollReadonly || pollReadonlyAssistant;

    const commandStarted = await submitCommand(utterance, token);
    options.onCommandSnapshot?.(commandStarted);
    const commandFinished =
        commandStarted.status === "working"
            ? await pollCommand(commandStarted, token, {
                  onSnapshot: options.onCommandSnapshot,
              })
            : commandStarted;

    if (commandFinished.status === "failed") {
        return { kind: "error", text: commandFinished.message };
    }
    if (commandFinished.draft) {
        return { kind: "draft", draft: commandFinished.draft };
    }
    if (commandFinished.route === "readonly" && commandFinished.intent === "question") {
        const readonlyStarted = await submitReadonly(utterance, history, token);
        options.onReadonlySnapshot?.(readonlyStarted);
        const readonlyFinished =
            readonlyStarted.status === "working"
                ? await pollReadonly(readonlyStarted, token, {
                      onSnapshot: options.onReadonlySnapshot,
                  })
                : readonlyStarted;
        if (readonlyFinished.status === "completed") {
            return {
                kind: "answer",
                text: readonlyFinished.answer || readonlyFinished.message,
            };
        }
        return { kind: "error", text: readonlyFinished.message };
    }
    return { kind: "message", text: commandFinished.message };
}

export function commandAssistantTargetMode(targets: ReadonlyArray<{ nodeId: string }>) {
    if (!targets.length) return { mode: "empty" as const, selectedId: "" };
    if (targets.length === 1) return { mode: "single" as const, selectedId: targets[0].nodeId };
    return { mode: "multiple" as const, selectedId: "" };
}

async function readCommandAssistantResponse(response: Response): Promise<CommandAssistantSnapshot> {
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new Error("指令助手返回了无法识别的结果。");
    }
    if (!response.ok) {
        const message = objectText(payload, "message");
        throw new Error(message || "指令助手拒绝了本次请求。");
    }
    if (!isCommandAssistantSnapshot(payload)) {
        throw new Error("指令助手返回了无法识别的结果。");
    }
    return payload;
}

function isCommandAssistantSnapshot(value: unknown): value is CommandAssistantSnapshot {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Record<string, unknown>;
    if (
        snapshot.ok !== true ||
        typeof snapshot.requestId !== "string" ||
        !["working", "completed", "failed"].includes(String(snapshot.status)) ||
        typeof snapshot.message !== "string" ||
        typeof snapshot.startedAt !== "number" ||
        typeof snapshot.updatedAt !== "number" ||
        typeof snapshot.deadlineAt !== "number"
    ) {
        return false;
    }
    if (snapshot.intent !== undefined && !["command", "question", "unsupported"].includes(String(snapshot.intent))) {
        return false;
    }
    if (snapshot.route !== undefined && snapshot.route !== "readonly") return false;
    if (snapshot.draft !== undefined && !isCommandAssistantDraft(snapshot.draft)) return false;
    if (snapshot.draft !== undefined && snapshot.intent !== "command") return false;
    if (snapshot.route === "readonly" && snapshot.intent !== "question") return false;
    return true;
}

function isCommandAssistantDraft(value: unknown): value is CommandAssistantDraft {
    if (!value || typeof value !== "object") return false;
    const draft = value as Record<string, unknown>;
    if (
        !isClosedWorkflowCommand(draft.command) ||
        !["run", "retry"].includes(String(draft.verb)) ||
        !["next", ...COMMAND_ASSISTANT_STEPS].includes(String(draft.target) as "next" | CommandAssistantStep) ||
        typeof draft.title !== "string" ||
        typeof draft.description !== "string"
    ) {
        return false;
    }
    return draft.command === `${draft.verb}: ${draft.target}`;
}

function sameDraft(previous?: CommandAssistantDraft, next?: CommandAssistantDraft) {
    if (previous === next) return true;
    if (!previous || !next) return false;
    return (
        previous.command === next.command &&
        previous.verb === next.verb &&
        previous.target === next.target &&
        previous.title === next.title &&
        previous.description === next.description
    );
}

function timeoutSnapshot(snapshot: CommandAssistantSnapshot, updatedAt: number) {
    return mergeCommandAssistantSnapshot(snapshot, {
        ...snapshot,
        status: "failed",
        message: COMMAND_ASSISTANT_TIMEOUT_MESSAGE,
        updatedAt,
    });
}

function objectText(value: unknown, key: string) {
    return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
        ? String((value as Record<string, unknown>)[key])
        : "";
}
