import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { codexBin } from "./agents.js";
import type { AgentEmit } from "./types.js";

export type CodexLoginStatus = { loggedIn: boolean; summary: string };
export type CodexLoginStart = { started: true } | { started: false; reason: "already-running" | "start-failed" };
type SpawnLoginProcess = (command: string, args: string[], options: { stdio: ["ignore", "pipe", "pipe"]; windowsHide: true }) => ChildProcess;

const LOGIN_STATUS_TIMEOUT_MS = 10_000;
let loginProcess: ChildProcess | null = null;

export function parseLoginStatus(output: string, exitCode: number | null): CodexLoginStatus {
    const summary = output.split(/\r?\n/).find((line) => line.trim()) || "";
    return { loggedIn: exitCode === 0 && output.includes("Logged in"), summary };
}

export function runLoginStatus(): Promise<CodexLoginStatus> {
    return new Promise((resolve) => {
        let output = "";
        let errorOutput = "";
        let settled = false;
        let child: ChildProcess;
        const finish = (exitCode: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(parseLoginStatus([output, errorOutput].filter(Boolean).join("\n"), exitCode));
        };

        try {
            child = spawn(process.execPath, [codexBin(), "login", "status"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        } catch (error) {
            resolve(parseLoginStatus(errorMessage(error), null));
            return;
        }

        child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { errorOutput += chunk.toString(); });
        child.once("error", (error) => {
            errorOutput += `${errorOutput ? "\n" : ""}${error.message}`;
            finish(null);
        });
        child.once("close", (code) => finish(code));
        const timeout = setTimeout(() => {
            child.kill();
            finish(null);
        }, LOGIN_STATUS_TIMEOUT_MS);
    });
}

export function startLogin(emit: AgentEmit, spawnLogin: SpawnLoginProcess = spawn): CodexLoginStart {
    if (loginProcess) return { started: false, reason: "already-running" };

    let child: ChildProcess;
    try {
        child = spawnLogin(process.execPath, [codexBin(), "login"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
        emit("agent_error", { message: errorMessage(error) });
        return { started: false, reason: "start-failed" };
    }

    loginProcess = child;
    const flushOutput = emitLines(child.stdout, (text) => emit("agent_log", { text }));
    const flushError = emitLines(child.stderr, (text) => emit("agent_log", { text }));
    child.once("error", (error) => {
        if (loginProcess === child) loginProcess = null;
        emit("agent_error", { message: error.message });
    });
    child.once("close", (code) => {
        flushOutput();
        flushError();
        if (loginProcess === child) loginProcess = null;
        emit("agent_event", { agent: "codex", type: "codex.login.exit", code });
    });
    return { started: true };
}

function emitLines(stream: NodeJS.ReadableStream | null | undefined, emit: (line: string) => void) {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    stream?.on("data", (chunk) => {
        pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        lines.filter((line) => line.trim()).forEach(emit);
    });
    return () => {
        pending += decoder.end();
        if (pending.trim()) emit(pending);
        pending = "";
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
