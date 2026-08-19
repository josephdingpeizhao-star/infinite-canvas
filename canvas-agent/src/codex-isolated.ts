import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    codexFailureEvent,
    codexReasoningEffort,
    codexThreadStartParams,
    codexTurnFailure,
    codexTurnStartParams,
    createUtf8StreamDecoder,
    withAgentPrompt,
} from "./agents.js";
import { resolveCodexCommand, type CodexCommand } from "./codex-command.js";
import { VERSION } from "./config.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

type Json = Record<string, unknown>;
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type TurnCompletion = { failure: (Error & { code?: string }) | null };
type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
type TimerHandle = ReturnType<typeof setTimeout>;
type SpawnCodexProcess = (
    command: string,
    args: string[],
    options: { stdio: ["pipe", "pipe", "pipe"]; windowsHide: true; env?: NodeJS.ProcessEnv },
) => ChildProcess;
type AttachmentFileHandle = {
    writeFile: (data: Buffer) => Promise<unknown>;
    close: () => Promise<unknown>;
};

export const MAX_ISOLATED_SESSIONS = 4;
export const ISOLATED_SESSION_TIMEOUT_MS = 660_000;
export const ISOLATED_PROCESS_EXIT_GRACE_MS = 1_000;
export const ISOLATED_PROCESS_FORCE_EXIT_MS = 1_000;

export type IsolatedCodexTurnInput = {
    prompt: string;
    attachments?: AgentAttachment[];
    cwd?: string;
    model?: string;
    effort?: CodexReasoningEffort;
};

export type IsolatedCodexContinueInput = IsolatedCodexTurnInput & { threadId: string };

export type IsolatedCodexDependencies = {
    resolveCommand?: () => CodexCommand;
    spawnProcess?: SpawnCodexProcess;
    setTimer?: (callback: () => void, milliseconds: number) => TimerHandle;
    clearTimer?: (handle: TimerHandle) => void;
    processExitGraceMs?: number;
    processForceExitMs?: number;
    openAttachmentFile?: (file: string) => Promise<AttachmentFileHandle>;
    unlinkAttachmentFile?: (file: string) => Promise<unknown>;
};

export type IsolatedCodexRunner = {
    startTurn: (input: IsolatedCodexTurnInput, emit: AgentEmit) => Promise<{ threadId: string }>;
    continueTurn: (input: IsolatedCodexContinueInput, emit: AgentEmit) => Promise<{ threadId: string }>;
    activeSessions: () => number;
};

export type IsolatedRouteResult = {
    status: number;
    body: { ok: true; threadId: string } | { ok: false; error: string; code?: string };
};

export class IsolatedSessionLimitError extends Error {
    readonly code = "isolated_session_limit";
    readonly statusCode = 503;

    constructor() {
        super("isolated Codex session limit reached");
        this.name = "IsolatedSessionLimitError";
    }
}

const defaultDependencies: Required<IsolatedCodexDependencies> = {
    resolveCommand: resolveCodexCommand,
    spawnProcess: spawn,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    processExitGraceMs: ISOLATED_PROCESS_EXIT_GRACE_MS,
    processForceExitMs: ISOLATED_PROCESS_FORCE_EXIT_MS,
    openAttachmentFile: async (file) => {
        const handle = await fs.open(file, "wx", 0o600);
        return {
            writeFile: (data) => handle.writeFile(data),
            close: () => handle.close(),
        };
    },
    unlinkAttachmentFile: (file) => fs.unlink(file),
};

export function createIsolatedCodexRunner(overrides: IsolatedCodexDependencies = {}): IsolatedCodexRunner {
    const dependencies = { ...defaultDependencies, ...overrides };
    let activeSessions = 0;

    const launch = async (input: IsolatedCodexTurnInput, emit: AgentEmit, resumeThreadId?: string) => {
        if (activeSessions >= MAX_ISOLATED_SESSIONS) throw new IsolatedSessionLimitError();
        activeSessions += 1;

        let client: IsolatedCodexClient | undefined;
        let backgroundStarted = false;
        try {
            const codex = dependencies.resolveCommand();
            if (codex.fallback) emit("agent_log", { text: codex.fallback.reason });
            const child = dependencies.spawnProcess(codex.command, [...codex.baseArgs, "app-server", "--stdio"], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                ...(codex.env ? { env: codex.env } : {}),
            });
            client = new IsolatedCodexClient(child, emit, dependencies, resumeThreadId || "");
            await client.initialize();
            const threadId = resumeThreadId
                ? await client.resumeThread(resumeThreadId, input.cwd)
                : await client.startThread(input.cwd, input.model, input.effort);

            backgroundStarted = true;
            void executeTurn(client, threadId, input, dependencies)
                .catch((error) => client?.emitFailure(error))
                .finally(() => {
                    activeSessions -= 1;
                    client?.emitDone();
                });
            return { threadId };
        } catch (error) {
            if (client) {
                client.emitFailure(error);
                if (!await client.dispose()) client.emitCleanupFailure();
            }
            throw error;
        } finally {
            if (!backgroundStarted) {
                activeSessions -= 1;
                client?.emitDone();
            }
        }
    };

    return {
        startTurn: (input, emit) => launch(input, emit),
        continueTurn: (input, emit) => launch(input, emit, input.threadId),
        activeSessions: () => activeSessions,
    };
}

const defaultRunner = createIsolatedCodexRunner();

export async function isolatedCodexTurnRoute(
    body: unknown,
    cwd: string,
    emit: AgentEmit,
    runner: IsolatedCodexRunner = defaultRunner,
): Promise<IsolatedRouteResult> {
    const parsed = parseRouteInput(body, cwd);
    if ("error" in parsed) return parsed.error;
    try {
        const result = await runner.startTurn(parsed.input, emit);
        return { status: 200, body: { ok: true, threadId: result.threadId } };
    } catch (error) {
        if (error instanceof IsolatedSessionLimitError) return sessionLimitResponse();
        throw error;
    }
}

export async function isolatedCodexContinueRoute(
    body: unknown,
    cwd: string,
    emit: AgentEmit,
    runner: IsolatedCodexRunner = defaultRunner,
): Promise<IsolatedRouteResult> {
    const value = objectValue(body);
    const threadId = String(value.threadId || "").trim();
    if (!threadId) return { status: 400, body: { ok: false, error: "threadId is required" } };
    const parsed = parseRouteInput(body, cwd);
    if ("error" in parsed) return parsed.error;
    try {
        const result = await runner.continueTurn({ ...parsed.input, threadId }, emit);
        return { status: 200, body: { ok: true, threadId: result.threadId } };
    } catch (error) {
        if (error instanceof IsolatedSessionLimitError) return sessionLimitResponse();
        throw error;
    }
}

async function executeTurn(client: IsolatedCodexClient, threadId: string, input: IsolatedCodexTurnInput, dependencies: Required<IsolatedCodexDependencies>) {
    let files: string[] = [];
    try {
        files = await writeAttachmentFiles(input.attachments || [], dependencies);
        await client.startTurn(threadId, input.prompt, files, input.model, input.effort);
    } catch (error) {
        client.emitFailure(error);
    } finally {
        if (!await client.dispose()) client.emitCleanupFailure();
        const cleanup = await Promise.allSettled(files.map((file) => dependencies.unlinkAttachmentFile(file)));
        if (cleanup.some((result) => result.status === "rejected")) client.emitCleanupFailure();
    }
}

class IsolatedCodexClient {
    private nextId = 1;
    private buffer = "";
    private pending = new Map<number, PendingRequest>();
    private activeTurns = new Map<string, PendingRequest>();
    private completedTurns = new Map<string, TurnCompletion>();
    private bufferedNotifications: Array<{ method: string; params: Json }> = [];
    private bufferedTurnNotifications = new Map<string, Array<{ method: string; params: Json }>>();
    private assistantTextByItem = new Map<string, string>();
    private assistantItemOrder: string[] = [];
    private anonymousAssistantText = "";
    private deltaCount = 0;
    private lastUsage: unknown = null;
    private currentTurnId = "";
    private hasErrorNotification = false;
    private terminalDone: Json | null = null;
    private doneEmitted = false;
    private errorEmitted = false;
    private terminalError: Error | null = null;
    private disposed = false;
    private softKillSent = false;
    private forceKillSent = false;
    private signalInProgress = false;
    private timeout: TimerHandle;
    private threadId: string;
    private processClosed: Promise<void>;
    private resolveProcessClosed: () => void = () => undefined;
    private stdoutDrained: Promise<void>;
    private resolveStdoutDrained: () => void = () => undefined;
    private processExitObserved = false;
    private processCloseConfirmed = false;
    private stdoutDrainConfirmed = false;
    private disposePromise: Promise<boolean> | null = null;
    private observedExitCode: number | null = null;

    constructor(
        private child: ChildProcess,
        private emit: AgentEmit,
        private dependencies: Required<IsolatedCodexDependencies>,
        initialThreadId: string,
    ) {
        this.threadId = initialThreadId;
        this.processClosed = new Promise((resolve) => { this.resolveProcessClosed = resolve; });
        this.stdoutDrained = new Promise((resolve) => { this.resolveStdoutDrained = resolve; });
        const stdoutDecoder = createUtf8StreamDecoder((text) => this.read(text));
        child.stdout?.on("data", stdoutDecoder.write);
        child.stdout?.on("end", () => {
            stdoutDecoder.end();
            this.flushReadBuffer();
            this.markStdoutDrained();
        });
        if (!child.stdout) this.markStdoutDrained();
        child.stderr?.on("data", (chunk) => emit("agent_log", { text: chunk.toString() }));
        child.stdin?.on("error", (error) => this.abort(error));
        child.once("error", (error) => {
            this.abort(error);
        });
        child.once("exit", (code) => {
            this.observedExitCode = code;
            this.processExitObserved = true;
            emit("agent_log", { text: `Codex isolated app-server exited: ${code ?? 0}` });
        });
        child.once("close", (code) => {
            this.processExitObserved = true;
            this.markProcessClosed();
            if (!this.disposed && !this.terminalDone && !this.terminalError) {
                this.abort(new Error(`Codex app-server exited: ${code ?? this.observedExitCode ?? 0}`));
            }
        });
        this.timeout = dependencies.setTimer(() => {
            const error = Object.assign(new Error("Codex isolated turn timed out"), { code: "codex_turn_interrupted" });
            this.abort(error, true);
        }, ISOLATED_SESSION_TIMEOUT_MS);
    }

    async initialize() {
        await this.request("initialize", {
            clientInfo: { name: "canvas-agent", title: "Infinite Canvas Agent", version: VERSION },
            capabilities: { experimentalApi: true, requestAttestation: false },
        });
        this.notify("initialized");
    }

    async startThread(cwd?: string, model?: string, effort?: CodexReasoningEffort) {
        const result = await this.request("thread/start", codexThreadStartParams(cwd, model, effort));
        const thread = field(result, "thread");
        const threadId = String(field(thread, "id") || "");
        if (!threadId) throw new Error("Codex app-server 没有返回 thread id");
        this.threadId = threadId;
        this.flushBufferedNotifications();
        return threadId;
    }

    async resumeThread(threadId: string, cwd?: string) {
        const startParams = codexThreadStartParams(cwd);
        const result = await this.request("thread/resume", {
            threadId,
            approvalPolicy: startParams.approvalPolicy,
            sandbox: startParams.sandbox,
            config: startParams.config,
            ...(cwd ? { cwd } : {}),
        });
        const resumedThreadId = String(field(field(result, "thread"), "id") || "");
        if (!resumedThreadId) throw new Error("Codex app-server 没有返回 thread id");
        if (resumedThreadId !== threadId) throw new Error("Codex app-server returned an unexpected resumed thread id");
        this.threadId = resumedThreadId;
        this.flushBufferedNotifications();
        return resumedThreadId;
    }

    async startTurn(threadId: string, prompt: string, images: string[], model?: string, effort?: CodexReasoningEffort) {
        const result = await this.request("turn/start", codexTurnStartParams(threadId, prompt, images, model, effort));
        if (this.terminalError) throw this.terminalError;
        const turnId = String(field(field(result, "turn"), "id") || "");
        if (!turnId) throw new Error("Codex app-server 没有返回 turn id");
        this.currentTurnId = turnId;
        try {
            this.flushBufferedTurnNotifications(turnId);
            const completed = this.completedTurns.get(turnId);
            if (this.completedTurns.has(turnId)) {
                this.completedTurns.delete(turnId);
                if (completed?.failure) throw completed.failure;
                return;
            }
            await new Promise((resolve, reject) => {
                if (this.terminalError) {
                    reject(this.terminalError);
                    return;
                }
                this.activeTurns.set(turnId, { resolve, reject });
            });
        } finally {
            if (this.currentTurnId === turnId) this.currentTurnId = "";
        }
    }

    emitFailure(error: unknown) {
        const failure = codexFailureEvent(error);
        this.emitAgentError(failure);
        if (String(this.terminalDone?.status || "") === "failed") return;
        this.terminalDone = {
            ...(this.terminalDone || {
                agent: "codex",
                threadId: this.threadId,
                assistantText: this.assistantText(),
            }),
            status: "failed",
            failureCode: failure.failureCode,
        };
    }

    emitCleanupFailure() {
        this.emitFailure(Object.assign(new Error("Codex isolated cleanup failed"), { code: "codex_turn_failed" }));
    }

    emitDone() {
        if (this.doneEmitted) return;
        if (!this.terminalDone) this.emitCleanupFailure();
        this.doneEmitted = true;
        this.emit("agent_done", this.terminalDone);
    }

    abort(error: Error, forceKill = false) {
        if (!this.terminalError) this.terminalError = error;
        this.failAll(this.terminalError);
        this.signalProcess(forceKill);
    }

    dispose() {
        this.disposePromise ||= this.disposeNow();
        return this.disposePromise;
    }

    private async disposeNow() {
        this.disposed = true;
        this.dependencies.clearTimer(this.timeout);
        if (this.cleanupConfirmed()) return true;
        if (this.forceKillSent) {
            return await this.waitForCleanup(this.dependencies.processForceExitMs);
        }
        const softKillAccepted = this.signalProcess(false);
        if (softKillAccepted && await this.waitForCleanup(this.dependencies.processExitGraceMs)) return true;
        this.signalProcess(true);
        return await this.waitForCleanup(this.dependencies.processForceExitMs);
    }

    private request(method: string, params: unknown) {
        if (this.terminalError) return Promise.reject(this.terminalError);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                this.write({ id, method, params });
            } catch (error) {
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private notify(method: string, params?: unknown) {
        this.write(params === undefined ? { method } : { method, params });
    }

    private write(value: unknown) {
        if (this.terminalError) throw this.terminalError;
        this.child.stdin?.write(`${JSON.stringify(value)}\n`);
    }

    private read(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || "";
        for (const line of lines.filter(Boolean)) this.readLine(line);
    }

    private flushReadBuffer() {
        const line = this.buffer;
        this.buffer = "";
        if (line) this.readLine(line);
    }

    private readLine(line: string) {
        try {
            this.handle(JSON.parse(line) as Json);
        } catch {
            this.emit("agent_log", { text: line });
        }
    }

    private handle(message: Json) {
        if (this.terminalError) return;
        const id = Number(message.id);
        if (typeof message.method === "string" && "id" in message) {
            this.answerServerRequest(message);
            return;
        }
        if (message.error && this.pending.has(id)) {
            this.reject(id, new Error(String(field(message.error, "message") || "Codex request failed")));
            return;
        }
        if (this.pending.has(id)) {
            this.resolve(id, message.result);
            return;
        }
        if (typeof message.method === "string") this.handleNotification(message.method, objectValue(message.params));
    }

    private handleNotification(method: string, params: Json) {
        if (!this.threadId) {
            this.bufferedNotifications.push({ method, params });
            return;
        }
        if (method === "turn/completed" && this.terminalDone) return;
        const eventThreadId = String(field(params, "threadId") || field(field(params, "thread"), "id") || this.threadId);
        if (this.threadId && eventThreadId && eventThreadId !== this.threadId) return;
        const explicitTurnId = String(field(params, "turnId") || field(field(params, "turn"), "id") || "");
        if (turnScopedNotification(method)) {
            if (!this.currentTurnId) {
                if (explicitTurnId) this.bufferTurnNotification(explicitTurnId, method, params);
                return;
            }
            if (explicitTurnId && explicitTurnId !== this.currentTurnId) return;
        }
        const turnId = explicitTurnId || this.currentTurnId;

        if (method === "item/agentMessage/delta") {
            this.captureDelta(String(field(params, "itemId") || ""), String(field(params, "delta") || ""));
            this.emit("agent_event", {
                agent: "codex",
                threadId: eventThreadId,
                type: "item.updated",
                item: {
                    id: String(field(params, "itemId") || ""),
                    type: "agent_message",
                    text: this.itemText(String(field(params, "itemId") || "")),
                },
            });
            return;
        }

        if (method === "item/completed") this.captureCompletedAssistant(params);
        if (method === "error") this.hasErrorNotification = true;
        if (method === "thread/tokenUsage/updated") this.lastUsage = normalizeUsage(params);

        const event = normalizeNotification(method, params);
        if (event) {
            if (event.type === "turn.completed") event.usage = this.lastUsage;
            this.emit("agent_event", { agent: "codex", threadId: eventThreadId, ...event });
        }

        if (method === "turn/completed") {
            if (!turnId) return;
            this.completeTurn(turnId, params);
        }
    }

    private flushBufferedNotifications() {
        const buffered = this.bufferedNotifications;
        this.bufferedNotifications = [];
        for (const notification of buffered) this.handleNotification(notification.method, notification.params);
    }

    private bufferTurnNotification(turnId: string, method: string, params: Json) {
        const buffered = this.bufferedTurnNotifications.get(turnId) || [];
        buffered.push({ method, params });
        this.bufferedTurnNotifications.set(turnId, buffered);
    }

    private flushBufferedTurnNotifications(turnId: string) {
        const buffered = this.bufferedTurnNotifications.get(turnId) || [];
        this.bufferedTurnNotifications.clear();
        for (const notification of buffered) this.handleNotification(notification.method, notification.params);
    }

    private completeTurn(turnId: string, params: Json) {
        const turn = field(params, "turn");
        const assistantText = this.assistantText();
        const failure = codexTurnFailure(turn, Boolean(assistantText.trim()), this.hasErrorNotification);
        const status = String(field(turn, "status") || "");
        const pending = this.activeTurns.get(turnId);
        this.emit("agent_event", { agent: "codex", threadId: this.threadId, type: "stream.summary", delta_count: this.deltaCount });
        if (failure) this.emitAgentError(codexFailureEvent(failure));
        this.terminalDone = {
            agent: "codex",
            threadId: this.threadId,
            assistantText,
            usage: this.lastUsage,
            status: failure ? "failed" : status,
            ...(failure ? { failureCode: failure.code } : {}),
        };
        if (pending) {
            this.activeTurns.delete(turnId);
            failure ? pending.reject(failure) : pending.resolve(undefined);
        } else if (turnId) {
            this.completedTurns.set(turnId, { failure });
        }
    }

    private captureDelta(itemId: string, delta: string) {
        this.deltaCount += 1;
        if (!itemId) {
            this.anonymousAssistantText += delta;
            return;
        }
        if (!this.assistantTextByItem.has(itemId)) this.assistantItemOrder.push(itemId);
        this.assistantTextByItem.set(itemId, `${this.assistantTextByItem.get(itemId) || ""}${delta}`);
    }

    private captureCompletedAssistant(params: Json) {
        const item = field(params, "item");
        if (String(field(item, "type") || "") !== "agentMessage") return;
        const itemId = String(field(item, "id") || "");
        const text = String(field(item, "text") || "");
        if (!itemId) {
            if (text) this.anonymousAssistantText = text;
            return;
        }
        if (!this.assistantTextByItem.has(itemId)) this.assistantItemOrder.push(itemId);
        this.assistantTextByItem.set(itemId, text);
    }

    private itemText(itemId: string) {
        return itemId ? this.assistantTextByItem.get(itemId) || "" : this.anonymousAssistantText;
    }

    private assistantText() {
        return [...this.assistantItemOrder.map((itemId) => this.assistantTextByItem.get(itemId) || ""), this.anonymousAssistantText]
            .filter((text) => text.trim())
            .join("\n")
            .trim();
    }

    private answerServerRequest(message: Json) {
        const method = String(message.method);
        const result = method === "mcpServer/elicitation/request" ? { action: "accept", content: {}, _meta: null } : { decision: "decline" };
        this.write({ id: message.id, result });
        this.emit("agent_event", { agent: "codex", threadId: this.threadId, type: "server.request", method, params: message.params, result });
    }

    private emitAgentError(failure: ReturnType<typeof codexFailureEvent>) {
        if (this.errorEmitted) return;
        this.errorEmitted = true;
        this.emit("agent_error", { ...failure, threadId: this.threadId });
    }

    private resolve(id: number, result: unknown) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.resolve(result);
    }

    private reject(id: number, error: Error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(error);
    }

    private failAll(error: Error) {
        for (const item of [...this.pending.values(), ...this.activeTurns.values()]) item.reject(error);
        this.pending.clear();
        this.activeTurns.clear();
    }

    private signalProcess(force: boolean) {
        if (this.processCloseConfirmed) return true;
        if (this.processExitObserved || processHasExited(this.child)) return true;
        if (force ? this.forceKillSent : this.softKillSent) return true;
        if (this.signalInProgress) return false;
        if (force) this.forceKillSent = true;
        else this.softKillSent = true;
        this.signalInProgress = true;
        let signalled = false;
        try {
            signalled = force ? this.child.kill("SIGKILL") : this.child.kill();
        } catch {
            // A failed spawn has no live process; disposal handles the bounded fallback.
        }
        this.signalInProgress = false;
        return signalled || this.processExitObserved || processHasExited(this.child);
    }

    private markProcessClosed() {
        if (this.processCloseConfirmed) return;
        this.processCloseConfirmed = true;
        this.resolveProcessClosed();
    }

    private markStdoutDrained() {
        if (this.stdoutDrainConfirmed) return;
        this.stdoutDrainConfirmed = true;
        this.resolveStdoutDrained();
    }

    private cleanupConfirmed() {
        return this.processCloseConfirmed && this.stdoutDrainConfirmed;
    }

    private async waitForCleanup(milliseconds: number) {
        if (this.cleanupConfirmed()) {
            return true;
        }
        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (exited: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(exited);
            };
            const timeout = setTimeout(() => finish(false), Math.max(0, milliseconds));
            void Promise.all([this.processClosed, this.stdoutDrained]).then(() => finish(true));
        });
    }
}

function parseRouteInput(
    body: unknown,
    cwd: string,
): { input: IsolatedCodexTurnInput } | { error: IsolatedRouteResult } {
    const value = objectValue(body);
    let effort: CodexReasoningEffort | undefined;
    try {
        effort = codexReasoningEffort(value.effort);
    } catch {
        return { error: { status: 400, body: { ok: false, error: "invalid Codex reasoning effort" } } };
    }
    const model = typeof value.model === "string" ? value.model.trim() : "";
    return {
        input: {
            prompt: withAgentPrompt(String(value.prompt || "")),
            attachments: Array.isArray(value.attachments) ? value.attachments as AgentAttachment[] : [],
            cwd,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
        },
    };
}

function sessionLimitResponse(): IsolatedRouteResult {
    return {
        status: 503,
        body: { ok: false, error: "isolated Codex session limit reached", code: "isolated_session_limit" },
    };
}

function turnScopedNotification(method: string) {
    return method === "turn/started"
        || method === "turn/completed"
        || method === "item/started"
        || method === "item/completed"
        || method === "item/agentMessage/delta"
        || method === "error"
        || method === "thread/tokenUsage/updated";
}

function normalizeNotification(method: string, params: Json): (Json & { type: string; usage?: unknown }) | null {
    if (method === "thread/started") return { type: "thread.started", thread_id: field(field(params, "thread"), "id") };
    if (method === "turn/started") return { type: "turn.started" };
    if (method === "turn/completed") return { type: "turn.completed", usage: null };
    if (method === "item/started") return { type: "item.started", item: normalizeItem(field(params, "item")) };
    if (method === "item/completed") return { type: "item.completed", item: normalizeItem(field(params, "item")) };
    if (method === "error") return { type: "error", message: "Codex turn failed" };
    return null;
}

function normalizeItem(item: unknown) {
    const value = item && typeof item === "object" ? { ...(item as Json) } : {};
    if (value.type === "agentMessage") value.type = "agent_message";
    if (value.type === "mcpToolCall") value.type = "mcp_tool_call";
    if (value.type === "agent_message" && typeof value.id === "string") value.text = String(value.text || "");
    if ("arguments" in value) value.arguments = parseMaybeJson(value.arguments);
    return value;
}

function normalizeUsage(params: Json) {
    const total = field(field(params, "tokenUsage"), "total");
    return {
        input_tokens: field(total, "inputTokens"),
        cached_input_tokens: field(total, "cachedInputTokens"),
        output_tokens: field(total, "outputTokens"),
        reasoning_output_tokens: field(total, "reasoningOutputTokens"),
    };
}

function parseMaybeJson(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Json)[key] : undefined;
}

function objectValue(value: unknown): Json {
    return value && typeof value === "object" ? value as Json : {};
}

function processHasExited(child: ChildProcess) {
    return typeof child.exitCode === "number" || (child.signalCode !== null && child.signalCode !== undefined);
}

async function writeAttachmentFiles(attachments: AgentAttachment[], dependencies: Required<IsolatedCodexDependencies>) {
    const files: string[] = [];
    try {
        for (const attachment of attachments.filter((item) => item.dataUrl?.startsWith("data:image/"))) {
            files.push(await writeAttachmentFile(attachment, dependencies));
        }
        return files;
    } catch (error) {
        await Promise.all(files.map((file) => dependencies.unlinkAttachmentFile(file).catch(() => undefined)));
        throw error;
    }
}

async function writeAttachmentFile(item: AgentAttachment, dependencies: Required<IsolatedCodexDependencies>) {
    const [, meta = "", data = ""] = item.dataUrl?.match(/^data:([^;]+);base64,(.+)$/) || [];
    if (!data) throw new Error(`图片附件无效：${item.name || "未命名图片"}`);
    const file = path.join(os.tmpdir(), `infinite-canvas-isolated-${randomUUID()}.${imageExt(meta || item.type)}`);
    let handle: AttachmentFileHandle | undefined;
    try {
        handle = await dependencies.openAttachmentFile(file);
        await handle.writeFile(Buffer.from(data, "base64"));
        await handle.close();
        return file;
    } catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
            await dependencies.unlinkAttachmentFile(file).catch(() => undefined);
        }
        throw error;
    }
}

function imageExt(type = "") {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
}
