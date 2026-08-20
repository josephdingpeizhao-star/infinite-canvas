import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { access, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
    createIsolatedCodexRunner,
    ISOLATED_SESSION_TIMEOUT_MS,
    isolatedCodexContinueRoute,
    isolatedCodexTurnRoute,
    MAX_ISOLATED_SESSIONS,
    type IsolatedCodexDependencies,
} from "./codex-isolated.js";

type Json = Record<string, unknown>;
type FakeMode = "success" | "multi-success" | "wrong-turn-first" | "foreign-thread-first" | "turn-pollution" | "server-id-collision" | "resume-mismatch" | "terminal-no-newline" | "terminal-no-newline-exit-first" | "terminal-no-newline-manual-close" | "sync-write-error" | "async-child-error" | "failed" | "pending" | "initialize-error";
type FakeExitMode = "any" | "force" | "never";
type Emitted = { type: string; payload: Json };

class FakeCodexProcess extends EventEmitter {
    readonly stdin = new PassThrough();
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly requests: Json[] = [];
    readonly killSignals: string[] = [];
    killCalls = 0;
    closed = false;
    private input = "";
    private exited = false;

    constructor(threadId: string, readonly mode: FakeMode, private exitMode: FakeExitMode = "any") {
        super();
        this.threadId = threadId;
        this.stdin.on("data", (chunk) => this.readInput(chunk.toString()));
        if (mode === "sync-write-error") {
            const originalWrite = this.stdin.write.bind(this.stdin) as (...args: unknown[]) => boolean;
            Object.defineProperty(this.stdin, "write", {
                value: (chunk: unknown, ...args: unknown[]) => {
                    if (String(chunk).includes('"method":"turn/start"')) throw new Error("synchronous stdin write failed");
                    return originalWrite(chunk, ...args);
                },
            });
        }
    }

    threadId: string;

    kill(signal?: NodeJS.Signals | number) {
        this.killCalls += 1;
        const signalName = signal === undefined ? "default" : String(signal);
        this.killSignals.push(signalName);
        if (this.exitMode === "any" || (this.exitMode === "force" && signalName === "SIGKILL")) this.finishProcess();
        return true;
    }

    finishExit() {
        if (this.exited) return;
        this.exited = true;
        this.emit("exit", null, "SIGTERM");
    }

    hasExited() {
        return this.exited;
    }

    finishClose(code: number | null = 0) {
        if (this.closed) return;
        this.closed = true;
        this.emit("close", code, null);
    }

    finishProcess() {
        this.finishExit();
        if (this.stdout.readableEnded) {
            this.finishClose();
            return;
        }
        this.stdout.once("end", () => this.finishClose());
        if (!this.stdout.writableEnded) this.stdout.end();
    }

    asChildProcess() {
        return this as unknown as ChildProcess;
    }

    private readInput(chunk: string) {
        this.input += chunk;
        const lines = this.input.split(/\r?\n/);
        this.input = lines.pop() || "";
        for (const line of lines.filter(Boolean)) {
            const message = JSON.parse(line) as Json;
            this.requests.push(message);
            queueMicrotask(() => this.handleRequest(message));
        }
    }

    private handleRequest(message: Json) {
        const method = String(message.method || "");
        if (method === "initialize") {
            if (this.mode === "initialize-error") {
                this.stdout.write(`${JSON.stringify({ id: message.id, error: { message: "initialize failed" } })}\n`);
                return;
            }
            this.respond(message.id, { userAgent: "fake-codex" });
            return;
        }
        if (method === "thread/start") {
            if (this.mode === "foreign-thread-first") {
                this.notify("thread/started", { thread: { id: "foreign-thread" } });
                this.notify("item/completed", {
                    threadId: "foreign-thread",
                    turnId: "foreign-turn",
                    item: { id: "foreign-assistant", type: "agentMessage", text: "foreign text" },
                });
                this.notify("turn/completed", {
                    threadId: "foreign-thread",
                    turn: { id: "foreign-turn", status: "completed", error: null },
                });
            }
            this.respond(message.id, { thread: { id: this.threadId } });
            return;
        }
        if (method === "thread/resume") {
            this.threadId = String(field(message.params, "threadId") || this.threadId);
            const resumedThreadId = this.mode === "resume-mismatch" ? `${this.threadId}-mismatch` : this.threadId;
            this.respond(message.id, { thread: { id: resumedThreadId } });
            return;
        }
        if (method !== "turn/start") return;

        const turnId = `${this.threadId}-turn`;
        if (this.mode === "server-id-collision") {
            this.stdout.write(`${JSON.stringify({ id: message.id, method: "approval/request", params: { reason: "collision" } })}\n`);
        }
        this.respond(message.id, { turn: { id: turnId } });
        if (this.mode === "async-child-error") {
            queueMicrotask(() => this.emit("error", new Error("asynchronous child process failure")));
            return;
        }
        if (this.mode === "pending") return;
        if (this.mode === "failed") {
            this.notify("turn/completed", { threadId: this.threadId, turn: { id: turnId, status: "failed", error: null } });
            return;
        }
        if (this.mode === "wrong-turn-first") {
            this.notify("turn/completed", { threadId: this.threadId, turn: { id: "historical-turn", status: "completed", error: null } });
        }
        if (this.mode === "turn-pollution") {
            this.notify("thread/tokenUsage/updated", {
                threadId: this.threadId,
                turnId: "historical-turn",
                tokenUsage: { total: { inputTokens: 999, cachedInputTokens: 999, outputTokens: 999, reasoningOutputTokens: 999 } },
            });
            this.notify("item/agentMessage/delta", { threadId: this.threadId, turnId: "historical-turn", itemId: "historical-assistant", delta: "foreign delta" });
            this.notify("item/completed", {
                threadId: this.threadId,
                turnId: "historical-turn",
                item: { id: "historical-assistant", type: "agentMessage", text: "foreign completed text" },
            });
            this.notify("error", { threadId: this.threadId, turnId: "historical-turn", message: "foreign failure" });
            this.notify("turn/completed", { threadId: this.threadId, turn: { id: "historical-turn", status: "failed", error: null } });
        }
        this.notify("thread/tokenUsage/updated", {
            threadId: this.threadId,
            turnId,
            tokenUsage: { total: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0 } },
        });
        this.notify("item/agentMessage/delta", { threadId: this.threadId, turnId, itemId: "assistant-1", delta: "o" });
        this.notify("item/agentMessage/delta", { threadId: this.threadId, turnId, itemId: "assistant-1", delta: "k" });
        this.notify("item/completed", { threadId: this.threadId, turnId, item: { id: "assistant-1", type: "agentMessage", text: "ok" } });
        if (this.mode === "multi-success") {
            this.notify("item/agentMessage/delta", { threadId: this.threadId, turnId, itemId: "assistant-2", delta: "stale delta" });
            this.notify("item/completed", { threadId: this.threadId, turnId, item: { id: "assistant-2", type: "agentMessage", text: "second" } });
        }
        const completed = { threadId: this.threadId, turn: { id: turnId, status: "completed", error: null } };
        if (this.mode === "terminal-no-newline-exit-first") {
            this.stdout.once("end", () => this.finishClose());
            this.stdout.write(JSON.stringify({ method: "turn/completed", params: completed }));
            this.finishExit();
            this.stdout.end();
        } else if (this.mode === "terminal-no-newline-manual-close") {
            this.stdout.write(JSON.stringify({ method: "turn/completed", params: completed }));
            this.finishExit();
        } else if (this.mode === "terminal-no-newline") this.stdout.end(JSON.stringify({ method: "turn/completed", params: completed }));
        else this.notify("turn/completed", completed);
        if (this.mode === "multi-success") {
            this.notify("turn/completed", { threadId: this.threadId, turn: { id: turnId, status: "completed", error: null } });
        }
    }

    private respond(id: unknown, result: unknown) {
        this.writeOutput(`${JSON.stringify({ id, result })}\n`);
    }

    private notify(method: string, params: unknown) {
        this.writeOutput(`${JSON.stringify({ method, params })}\n`);
    }

    private writeOutput(value: string) {
        if (this.stdout.writableEnded || this.stdout.destroyed) return;
        this.stdout.write(value);
    }
}

function harness(modes: FakeMode[], exitMode: FakeExitMode = "any", processExitWaitMs = 10, overrides: IsolatedCodexDependencies = {}) {
    const children: FakeCodexProcess[] = [];
    const closedBeforeSpawn: boolean[][] = [];
    const timers: Array<{ callback: () => void; milliseconds: number; cleared: boolean }> = [];
    let spawnCall: { command: string; args: string[]; options: Json } | undefined;
    const dependencies: IsolatedCodexDependencies = {
        resolveCommand: () => ({
            command: "C:/fake/codex.exe",
            baseArgs: ["wrapper-prefix"],
            env: { CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: "C:/fake/package" },
        }),
        spawnProcess: (command, args, options) => {
            spawnCall = { command, args, options };
            closedBeforeSpawn.push(children.map((child) => child.closed));
            const child = new FakeCodexProcess(`thread-${children.length + 1}`, modes[children.length] || "pending", exitMode);
            children.push(child);
            return child.asChildProcess();
        },
        setTimer: (callback, milliseconds) => {
            const timer = { callback, milliseconds, cleared: false };
            timers.push(timer);
            return timer as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: (handle) => {
            const timer = handle as unknown as { cleared: boolean };
            timer.cleared = true;
        },
        processExitGraceMs: processExitWaitMs,
        processForceExitMs: processExitWaitMs,
        ...overrides,
    };
    return { runner: createIsolatedCodexRunner(dependencies), children, closedBeforeSpawn, timers, getSpawnCall: () => spawnCall };
}

function emittedCollector() {
    const events: Emitted[] = [];
    return {
        events,
        emit: (type: string, payload: unknown) => events.push({ type, payload: payload as Json }),
    };
}

describe("isolated Codex sessions", () => {
    test("normal completion emits an owned assistant result and kills the dedicated process", async () => {
        const fixture = harness(["success"]);
        const output = emittedCollector();

        const response = await fixture.runner.startTurn({ prompt: "reply ok", model: "gpt-5.5", effort: "high" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(response, { threadId: "thread-1" });
        assert.deepEqual(fixture.children[0]?.requests.map((request) => request.method), ["initialize", "initialized", "thread/start", "turn/start"]);
        assert.equal(fixture.children[0]?.killCalls, 1);
        assert.equal(fixture.timers[0]?.cleared, true);
        const done = output.events.find((event) => event.type === "agent_done")?.payload;
        assert.deepEqual(done, {
            agent: "codex",
            threadId: "thread-1",
            assistantText: "ok",
            usage: {
                input_tokens: 3,
                cached_input_tokens: 1,
                output_tokens: 2,
                reasoning_output_tokens: 0,
            },
            status: "completed",
        });
        for (const event of output.events.filter((item) => ["agent_event", "agent_done", "agent_error"].includes(item.type))) {
            assert.equal(event.payload.threadId, "thread-1");
        }

        const spawnCall = fixture.getSpawnCall();
        assert.ok(spawnCall);
        assert.equal(spawnCall.command, "C:/fake/codex.exe");
        assert.deepEqual(spawnCall.args, ["wrapper-prefix", "app-server", "--stdio"]);
        assert.deepEqual(spawnCall.options.stdio, ["pipe", "pipe", "pipe"]);
        assert.equal(spawnCall.options.windowsHide, true);
        assert.deepEqual(spawnCall.options.env, {
            CODEX_MANAGED_BY_NPM: "1",
            CODEX_MANAGED_PACKAGE_ROOT: "C:/fake/package",
        });
    });

    test("completed agent messages replace their deltas, preserve item order, and emit one terminal result", async () => {
        const fixture = harness(["multi-success"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "two messages" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const doneEvents = output.events.filter((event) => event.type === "agent_done");
        assert.equal(doneEvents.length, 1);
        assert.equal(doneEvents[0]?.payload.assistantText, "ok\nsecond");
        assert.doesNotMatch(String(doneEvents[0]?.payload.assistantText), /stale delta/);
        assert.equal(fixture.children[0]?.killCalls, 1);
    });

    test("stdout EOF flushes a final turn completion JSON object without a newline", async () => {
        const fixture = harness(["terminal-no-newline"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "flush final JSON" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const doneEvents = output.events.filter((event) => event.type === "agent_done");
        assert.equal(doneEvents.length, 1);
        assert.equal(doneEvents[0]?.payload.assistantText, "ok");
        assert.equal(doneEvents[0]?.payload.status, "completed");
    });

    test("process exit before stdout EOF still drains a final completion without a newline", async () => {
        const fixture = harness(["terminal-no-newline-exit-first"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "drain before exit failure" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_done"],
        );
        assert.equal(output.events.find((event) => event.type === "agent_done")?.payload.assistantText, "ok");
        assert.equal(output.events.find((event) => event.type === "agent_done")?.payload.status, "completed");
    });

    test("process exit cannot emit done until stdout EOF is drained and close is confirmed", async () => {
        const fixture = harness(["terminal-no-newline-manual-close"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "wait for EOF and close" }, output.emit);
        await waitFor(() => fixture.children[0]?.hasExited() === true);

        assert.equal(fixture.children[0]?.closed, false);
        assert.equal(fixture.runner.activeSessions(), 1);
        assert.equal(output.events.some((event) => event.type === "agent_done"), false);

        fixture.children[0]?.finishProcess();
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.equal(fixture.children[0]?.closed, true);
        assert.equal(fixture.children[0]?.stdout.readableEnded, true);
        assert.equal(output.events.filter((event) => event.type === "agent_done").length, 1);
        assert.equal(output.events.find((event) => event.type === "agent_done")?.payload.assistantText, "ok");
    });

    test("done callback observes closed process, drained stdout, removed attachment, and released capacity", async () => {
        const fixture = harness(["success"]);
        const output = emittedCollector();
        let doneState: Json | undefined;

        const emit = (type: string, payload: unknown) => {
            output.emit(type, payload);
            if (type !== "agent_done") return;
            const turn = fixture.children[0]?.requests.find((request) => request.method === "turn/start")?.params;
            const input = field(turn, "input") as Json[];
            const imagePath = String(input.find((item) => item.type === "localImage")?.path || "");
            doneState = {
                activeSessions: fixture.runner.activeSessions(),
                processClosed: fixture.children[0]?.closed,
                stdoutDrained: fixture.children[0]?.stdout.readableEnded,
                killCalls: fixture.children[0]?.killCalls,
                imagePath,
                attachmentExists: existsSync(imagePath),
            };
        };

        await fixture.runner.startTurn({
            prompt: "verify terminal cleanup order",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, emit);
        await waitFor(() => doneState !== undefined);

        assert.deepEqual(doneState, {
            activeSessions: 0,
            processClosed: true,
            stdoutDrained: true,
            killCalls: 1,
            imagePath: doneState?.imagePath,
            attachmentExists: false,
        });
        assert.ok(doneState?.imagePath);
    });

    test("a completed session keeps its capacity slot until the killed process exits", async () => {
        const fixture = harness(["success"], "never", 1_000);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "wait for process exit" }, output.emit);
        await waitFor(() => fixture.children[0]?.killCalls === 1);

        assert.equal(fixture.runner.activeSessions(), 1);
        fixture.children[0]?.finishProcess();
        await waitFor(() => fixture.runner.activeSessions() === 0);
        assert.equal(output.events.filter((event) => event.type === "agent_done").length, 1);
    });

    test("a process that accepts soft kill without exiting is force-killed and fully cleaned up", async () => {
        const fixture = harness(["success"], "force", 5);
        const output = emittedCollector();

        await fixture.runner.startTurn({
            prompt: "force cleanup",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(fixture.children[0]?.killSignals, ["default", "SIGKILL"]);
        const turn = fixture.children[0]?.requests.find((request) => request.method === "turn/start")?.params;
        const input = field(turn, "input") as Json[];
        const imagePath = String(input.find((item) => item.type === "localImage")?.path || "");
        assert.ok(imagePath);
        await assert.rejects(() => access(imagePath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    });

    test("cleanup that cannot confirm process close fails closed without retaining a capacity slot", async () => {
        const fixture = harness(["success"], "never", 5);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "fail closed on cleanup" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(fixture.children[0]?.killSignals, ["default", "SIGKILL"]);
        assert.equal(fixture.children[0]?.closed, false);
        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
        const done = output.events.find((event) => event.type === "agent_done")?.payload;
        assert.equal(done?.status, "failed");
        assert.equal(done?.failureCode, "codex_turn_failed");
    });

    test("an early completion from another turn cannot finish the owned turn", async () => {
        const fixture = harness(["wrong-turn-first"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "ignore historical completion" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const doneEvents = output.events.filter((event) => event.type === "agent_done");
        assert.equal(doneEvents.length, 1);
        assert.equal(doneEvents[0]?.payload.threadId, "thread-1");
        assert.equal(doneEvents[0]?.payload.assistantText, "ok");
        assert.equal(doneEvents[0]?.payload.status, "completed");
    });

    test("foreign thread notifications before thread start response cannot replace isolated ownership", async () => {
        const fixture = harness(["foreign-thread-first"]);
        const output = emittedCollector();

        const response = await fixture.runner.startTurn({ prompt: "keep the owned thread" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(response, { threadId: "thread-1" });
        const doneEvents = output.events.filter((event) => event.type === "agent_done");
        assert.equal(doneEvents.length, 1);
        assert.equal(doneEvents[0]?.payload.threadId, "thread-1");
        assert.equal(doneEvents[0]?.payload.assistantText, "ok");
        assert.equal(output.events.some((event) => event.payload.threadId === "foreign-thread"), false);
        assert.doesNotMatch(JSON.stringify(output.events), /foreign text/);
    });

    test("same-thread historical deltas, completed items, usage, and errors cannot pollute the owned turn", async () => {
        const fixture = harness(["turn-pollution"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "owned output only" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const done = output.events.find((event) => event.type === "agent_done")?.payload;
        assert.equal(done?.assistantText, "ok");
        assert.deepEqual(done?.usage, {
            input_tokens: 3,
            cached_input_tokens: 1,
            output_tokens: 2,
            reasoning_output_tokens: 0,
        });
        assert.equal(done?.status, "completed");
        assert.equal(output.events.some((event) => event.type === "agent_error"), false);
        assert.doesNotMatch(JSON.stringify(output.events), /foreign delta|foreign completed text|foreign failure|999/);
    });

    test("a server request sharing an id with a pending client request is answered without resolving that request", async () => {
        const fixture = harness(["server-id-collision"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({ prompt: "survive id collision" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const requests = fixture.children[0]?.requests || [];
        const turnRequest = requests.find((request) => request.method === "turn/start");
        const serverResponse = requests.find((request) => !request.method && request.id === turnRequest?.id && request.result);
        assert.deepEqual(serverResponse?.result, { decision: "decline" });
        assert.equal(output.events.find((event) => event.type === "agent_done")?.payload.assistantText, "ok");
        assert.equal(output.events.filter((event) => event.type === "agent_done").length, 1);
        assert.equal(output.events.some((event) => event.type === "agent_event" && event.payload.type === "server.request"), true);
    });

    test("initialization failure kills the process, emits one failed terminal event, and releases capacity", async () => {
        const fixture = harness(["initialize-error"]);
        const output = emittedCollector();

        await assert.rejects(() => fixture.runner.startTurn({ prompt: "never starts" }, output.emit), /initialize failed/);

        assert.equal(fixture.runner.activeSessions(), 0);
        assert.equal(fixture.children[0]?.killCalls, 1);
        const doneEvents = output.events.filter((event) => event.type === "agent_done");
        assert.equal(doneEvents.length, 1);
        assert.deepEqual(doneEvents[0]?.payload, {
            agent: "codex",
            threadId: "",
            assistantText: "",
            status: "failed",
            failureCode: "codex_turn_failed",
        });
    });

    test("a synchronous stdin write failure rejects the registered request and cleans up once", async () => {
        const fixture = harness(["sync-write-error"]);
        const output = emittedCollector();

        const response = await fixture.runner.startTurn({ prompt: "write must fail" }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(response, { threadId: "thread-1" });
        assert.equal(fixture.children[0]?.requests.some((request) => request.method === "turn/start"), false);
        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
        assert.equal(fixture.children[0]?.killCalls, 1);

        const source = await readFile(fileURLToPath(new URL("./codex-isolated.ts", import.meta.url)), "utf8");
        const requestMethod = source.slice(source.indexOf("private request("), source.indexOf("private notify("));
        assert.ok(requestMethod.indexOf("this.pending.set") < requestMethod.indexOf("this.write"));
        assert.match(requestMethod, /this\.pending\.delete\(id\)/);
    });

    test("an asynchronous child process error emits one error then one done and releases the slot", async () => {
        const fixture = harness(["async-child-error"]);
        const output = emittedCollector();
        let doneState: Json | undefined;
        const emit = (type: string, payload: unknown) => {
            output.emit(type, payload);
            if (type !== "agent_done") return;
            const imagePath = localImagePath(fixture.children[0]);
            doneState = {
                activeSessions: fixture.runner.activeSessions(),
                processClosed: fixture.children[0]?.closed,
                stdoutDrained: fixture.children[0]?.stdout.readableEnded,
                imagePath,
                attachmentExists: existsSync(imagePath),
            };
        };

        await fixture.runner.startTurn({
            prompt: "child errors asynchronously",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
        assert.equal(output.events.filter((event) => event.type === "agent_error").length, 1);
        assert.equal(output.events.filter((event) => event.type === "agent_done").length, 1);
        assert.equal(fixture.children[0]?.killCalls, 1);
        assert.equal(fixture.runner.activeSessions(), 0);
        assert.ok(doneState?.imagePath);
        assert.equal(doneState?.activeSessions, 0);
        assert.equal(doneState?.processClosed, true);
        assert.equal(doneState?.stdoutDrained, true);
        assert.equal(doneState?.attachmentExists, false);
    });

    test("failed completion emits owned failure fields and kills the dedicated process", async () => {
        const fixture = harness(["failed"]);
        const output = emittedCollector();
        let doneState: Json | undefined;
        const emit = (type: string, payload: unknown) => {
            output.emit(type, payload);
            if (type === "agent_done") {
                const imagePath = localImagePath(fixture.children[0]);
                doneState = {
                    activeSessions: fixture.runner.activeSessions(),
                    processClosed: fixture.children[0]?.closed,
                    stdoutDrained: fixture.children[0]?.stdout.readableEnded,
                    imagePath,
                    attachmentExists: existsSync(imagePath),
                };
            }
        };

        await fixture.runner.startTurn({
            prompt: "fail",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.equal(fixture.children[0]?.killCalls, 1);
        assert.equal(fixture.timers[0]?.cleared, true);
        const done = output.events.find((event) => event.type === "agent_done")?.payload;
        const error = output.events.find((event) => event.type === "agent_error")?.payload;
        assert.deepEqual(done, {
            agent: "codex",
            threadId: "thread-1",
            assistantText: "",
            usage: null,
            status: "failed",
            failureCode: "codex_turn_failed",
        });
        assert.deepEqual(error, {
            agent: "codex",
            message: "Codex turn failed",
            failureCode: "codex_turn_failed",
            threadId: "thread-1",
        });
        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
        assert.ok(doneState?.imagePath);
        assert.equal(doneState?.activeSessions, 0);
        assert.equal(doneState?.processClosed, true);
        assert.equal(doneState?.stdoutDrained, true);
        assert.equal(doneState?.attachmentExists, false);
    });

    test("hard timeout kills the dedicated process and emits an owned interrupted result", async () => {
        const fixture = harness(["pending"]);
        const output = emittedCollector();
        let doneState: Json | undefined;
        const emit = (type: string, payload: unknown) => {
            output.emit(type, payload);
            if (type === "agent_done") {
                const imagePath = localImagePath(fixture.children[0]);
                doneState = {
                    activeSessions: fixture.runner.activeSessions(),
                    processClosed: fixture.children[0]?.closed,
                    stdoutDrained: fixture.children[0]?.stdout.readableEnded,
                    imagePath,
                    attachmentExists: existsSync(imagePath),
                };
            }
        };

        await fixture.runner.startTurn({
            prompt: "remain pending",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, emit);
        assert.equal(ISOLATED_SESSION_TIMEOUT_MS, 1_260_000);
        assert.equal(fixture.timers[0]?.milliseconds, ISOLATED_SESSION_TIMEOUT_MS);
        await waitFor(() => fixture.children[0]?.requests.some((request) => request.method === "turn/start") === true);
        fixture.timers[0]?.callback();
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.equal(fixture.children[0]?.killCalls, 1);
        assert.deepEqual(fixture.children[0]?.killSignals, ["SIGKILL"]);
        assert.equal(fixture.timers[0]?.cleared, true);
        assert.deepEqual(output.events.find((event) => event.type === "agent_done")?.payload, {
            agent: "codex",
            threadId: "thread-1",
            assistantText: "",
            status: "failed",
            failureCode: "codex_turn_interrupted",
        });
        assert.equal(output.events.find((event) => event.type === "agent_error")?.payload.threadId, "thread-1");
        assert.ok(doneState?.imagePath);
        assert.equal(doneState?.activeSessions, 0);
        assert.equal(doneState?.processClosed, true);
        assert.equal(doneState?.stdoutDrained, true);
        assert.equal(doneState?.attachmentExists, false);
    });

    test("the isolated session limit remains fixed at four", () => {
        // 上限调整须另行立项，本断言防误改。
        assert.equal(MAX_ISOLATED_SESSIONS, 4);
    });

    test("the fifth concurrent HTTP request is rejected with 503 without disturbing the first four", async () => {
        const fixture = harness(Array.from({ length: MAX_ISOLATED_SESSIONS }, () => "pending"));
        const output = emittedCollector();
        const accepted = [];
        for (let index = 0; index < MAX_ISOLATED_SESSIONS; index += 1) {
            accepted.push(await isolatedCodexTurnRoute({ prompt: `request-${index}` }, "C:/workspace", output.emit, fixture.runner));
        }

        const rejected = await isolatedCodexTurnRoute({ prompt: "request-5" }, "C:/workspace", output.emit, fixture.runner);

        assert.equal(fixture.children.length, MAX_ISOLATED_SESSIONS);
        assert.equal(fixture.runner.activeSessions(), MAX_ISOLATED_SESSIONS);
        assert.equal(accepted.every((result) => result.status === 200 && result.body.ok), true);
        assert.deepEqual(rejected, {
            status: 503,
            body: { ok: false, error: "isolated Codex session limit reached", code: "isolated_session_limit" },
        });
        assert.equal(fixture.children.every((child) => child.killCalls === 0), true);

        for (const timer of fixture.timers) timer.callback();
        await waitFor(() => fixture.runner.activeSessions() === 0);
        assert.equal(fixture.children.every((child) => child.killCalls === 1), true);
    });

    test("done callback can immediately continue after cleanup while three other slots remain occupied", async () => {
        const fixture = harness(["pending", "pending", "pending", "success", "success"]);
        const output = emittedCollector();
        let continued = false;
        let continueResult: Promise<Awaited<ReturnType<typeof isolatedCodexContinueRoute>>> | undefined;
        let doneState: Json | undefined;
        const emit = (type: string, payload: unknown) => {
            output.emit(type, payload);
            const value = payload as Json;
            if (type !== "agent_done" || value.threadId !== "thread-4" || continued) return;
            continued = true;
            doneState = {
                activeSessions: fixture.runner.activeSessions(),
                processClosed: fixture.children[3]?.closed,
                stdoutDrained: fixture.children[3]?.stdout.readableEnded,
            };
            continueResult = isolatedCodexContinueRoute({ threadId: "thread-4", prompt: "continue immediately" }, "C:/workspace", emit, fixture.runner);
        };

        for (let index = 0; index < 3; index += 1) {
            const response = await isolatedCodexTurnRoute({ prompt: `occupy-${index}` }, "C:/workspace", emit, fixture.runner);
            assert.equal(response.status, 200);
        }
        const targetResponse = await isolatedCodexTurnRoute({ prompt: "finish and continue" }, "C:/workspace", emit, fixture.runner);
        assert.deepEqual(targetResponse, { status: 200, body: { ok: true, threadId: "thread-4" } });
        await waitFor(() => continueResult !== undefined);

        assert.deepEqual(doneState, { activeSessions: 3, processClosed: true, stdoutDrained: true });
        assert.deepEqual(await continueResult, { status: 200, body: { ok: true, threadId: "thread-4" } });
        assert.equal(fixture.children.length, 5);
        assert.deepEqual(fixture.closedBeforeSpawn[4], [false, false, false, true]);

        await waitFor(() => fixture.runner.activeSessions() === 3);
        for (const timer of fixture.timers.filter((timer) => !timer.cleared)) timer.callback();
        await waitFor(() => fixture.runner.activeSessions() === 0);
    });

    test("continuation resumes only the requested thread and keeps model selection on turn start", async () => {
        const fixture = harness(["success"]);
        const output = emittedCollector();

        const response = await isolatedCodexContinueRoute({
            threadId: "continued-thread",
            prompt: "continue",
            model: "gpt-5.5",
            effort: "xhigh",
            attachments: [],
        }, "C:/workspace", output.emit, fixture.runner);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.deepEqual(response, { status: 200, body: { ok: true, threadId: "continued-thread" } });
        const requests = fixture.children[0]?.requests || [];
        assert.deepEqual(requests.map((request) => request.method), ["initialize", "initialized", "thread/resume", "turn/start"]);
        const resume = requests.find((request) => request.method === "thread/resume")?.params;
        assert.equal(field(resume, "threadId"), "continued-thread");
        assert.equal(Object.hasOwn(objectValue(resume), "threadSource"), false);
        assert.equal(Object.hasOwn(objectValue(resume), "model"), false);
        assert.equal(Object.hasOwn(objectValue(resume), "effort"), false);
        const turn = requests.find((request) => request.method === "turn/start")?.params;
        assert.equal(field(turn, "threadId"), "continued-thread");
        assert.equal(field(turn, "model"), "gpt-5.5");
        assert.equal(field(turn, "effort"), "xhigh");
        assert.match(JSON.stringify(field(turn, "input")), /用户请求：continue/);
    });

    test("continuation fails closed when thread resume returns a different thread id", async () => {
        const fixture = harness(["resume-mismatch"]);
        const output = emittedCollector();

        await assert.rejects(() => isolatedCodexContinueRoute({
            threadId: "continued-thread",
            prompt: "must not cross threads",
            model: "gpt-5.5",
            effort: "high",
        }, "C:/workspace", output.emit, fixture.runner), /unexpected resumed thread id/);

        assert.equal(fixture.runner.activeSessions(), 0);
        assert.deepEqual(fixture.children[0]?.requests.map((request) => request.method), ["initialize", "initialized", "thread/resume"]);
        assert.equal(fixture.children[0]?.requests.some((request) => request.method === "turn/start"), false);
        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
        assert.equal(output.events.find((event) => event.type === "agent_done")?.payload.threadId, "continued-thread");
    });

    test("image attachments are passed as local files and removed after the isolated process exits", async () => {
        const fixture = harness(["success"]);
        const output = emittedCollector();

        await fixture.runner.startTurn({
            prompt: "inspect image",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        const turn = fixture.children[0]?.requests.find((request) => request.method === "turn/start")?.params;
        const input = field(turn, "input") as Json[];
        const imagePath = String(input.find((item) => item.type === "localImage")?.path || "");
        assert.ok(imagePath);
        assert.match(path.basename(imagePath), /^infinite-canvas-isolated-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i);
        await assert.rejects(() => access(imagePath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
        const source = await readFile(fileURLToPath(new URL("./codex-isolated.ts", import.meta.url)), "utf8");
        assert.match(source, /randomUUID\(\)/);
        assert.match(source, /fs\.open\(file, "wx", 0o600\)/);
    });

    test("a partial attachment write failure closes and removes the newly created file", async () => {
        let partialPath = "";
        const fixture = harness(["success"], "any", 10, {
            openAttachmentFile: async (file) => {
                partialPath = file;
                const handle = await open(file, "wx", 0o600);
                return {
                    writeFile: async (data) => {
                        await handle.writeFile(data);
                        throw new Error("partial attachment write failed");
                    },
                    close: () => handle.close(),
                };
            },
            unlinkAttachmentFile: (file) => unlink(file),
        });
        const output = emittedCollector();

        await fixture.runner.startTurn({
            prompt: "partial attachment",
            attachments: [{ name: "pixel.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
        }, output.emit);
        await waitFor(() => fixture.runner.activeSessions() === 0);

        assert.ok(partialPath);
        await assert.rejects(() => access(partialPath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
        assert.equal(fixture.children[0]?.requests.some((request) => request.method === "turn/start"), false);
        assert.deepEqual(
            output.events.filter((event) => event.type === "agent_error" || event.type === "agent_done").map((event) => event.type),
            ["agent_error", "agent_done"],
        );
    });

    test("HTTP server registers both protected isolated routes without changing the legacy turn route", async () => {
        const source = await readFile(fileURLToPath(new URL("./http-server.ts", import.meta.url)), "utf8");

        assert.equal(count(source, 'app.post("/agent/codex/isolated/turn"'), 1);
        assert.equal(count(source, 'app.post("/agent/codex/isolated/continue"'), 1);
        assert.equal(count(source, 'app.post("/agent/codex/turn"'), 1);
        assert.equal(count(source, 'void runCodexTurn(withAgentPrompt(String(req.body?.prompt || "")), emit, attachments, { threadId, cwd: workspace.workspacePath, model: requestedModel || undefined, effort: requestedEffort });'), 1);
        const tokenMiddleware = source.indexOf('res.status(401).json({ ok: false, error: "invalid token" })');
        const isolatedTurn = source.indexOf('app.post("/agent/codex/isolated/turn"');
        const notFound = source.indexOf('app.use((_req, res) => res.status(404)');
        assert.ok(tokenMiddleware >= 0 && tokenMiddleware < isolatedTurn && isolatedTurn < notFound);
    });
});

async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("condition was not reached");
}

function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Json)[key] : undefined;
}

function objectValue(value: unknown): Json {
    return value && typeof value === "object" ? value as Json : {};
}

function localImagePath(child?: FakeCodexProcess) {
    const turn = child?.requests.find((request) => request.method === "turn/start")?.params;
    const input = field(turn, "input");
    if (!Array.isArray(input)) return "";
    return String(input.find((item) => field(item, "type") === "localImage")?.path || "");
}

function count(value: string, needle: string) {
    return value.split(needle).length - 1;
}
