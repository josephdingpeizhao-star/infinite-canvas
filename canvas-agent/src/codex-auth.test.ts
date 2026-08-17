import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { parseLoginStatus, runLoginStatus, startLogin } from "./codex-auth.js";

describe("Codex login status", () => {
    test("parses login output conservatively and keeps the first non-empty line", () => {
        assert.deepEqual(parseLoginStatus("Logged in using ChatGPT\n", 0), { loggedIn: true, summary: "Logged in using ChatGPT" });
        assert.deepEqual(parseLoginStatus("Ready\n", 0), { loggedIn: false, summary: "Ready" });
        assert.deepEqual(parseLoginStatus("Logged in using ChatGPT\n", 1), { loggedIn: false, summary: "Logged in using ChatGPT" });
        assert.deepEqual(parseLoginStatus("", 0), { loggedIn: false, summary: "" });
        assert.deepEqual(parseLoginStatus("\nfirst line\nLogged in later\n", 0), { loggedIn: true, summary: "first line" });
        assert.doesNotThrow(() => parseLoginStatus("\u0000random output", null));
    });

    test("uses an existing empty CODEX_HOME to observe a real logged-out status", async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "canvas-agent-codex-status-"));
        const codexHome = path.join(tempRoot, "codex-home");
        await mkdir(codexHome);
        const previous = process.env.CODEX_HOME;
        process.env.CODEX_HOME = codexHome;
        try {
            assert.equal((await runLoginStatus()).loggedIn, false);
        } finally {
            if (previous === undefined) delete process.env.CODEX_HOME;
            else process.env.CODEX_HOME = previous;
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    test("does not spawn a second official login flow while one is running", () => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: () => true }) as unknown as ChildProcess;
        const events: Array<{ type: string; payload: unknown }> = [];
        let spawnCalls = 0;
        const spawnLogin = () => {
            spawnCalls += 1;
            return child;
        };
        const emit = (type: string, payload: unknown) => events.push({ type, payload });

        assert.deepEqual(startLogin(emit, spawnLogin), { started: true });
        assert.deepEqual(startLogin(emit, spawnLogin), { started: false, reason: "already-running" });
        assert.equal(spawnCalls, 1);
        stdout.write("Open the official login page\n");
        stderr.write("Waiting for authorization\n");
        child.emit("close", 0);
        assert.deepEqual(events, [
            { type: "agent_log", payload: { text: "Open the official login page" } },
            { type: "agent_log", payload: { text: "Waiting for authorization" } },
            { type: "agent_event", payload: { agent: "codex", type: "codex.login.exit", code: 0 } },
        ]);
    });

    test("serves the token-protected auth response shape with an isolated CODEX_HOME", async () => {
        const packageRoot = fileURLToPath(new URL("..", import.meta.url));
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "canvas-agent-auth-route-"));
        const codexHome = path.join(tempRoot, "codex-home");
        await mkdir(codexHome);
        const port = await unusedPort();
        const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
            cwd: packageRoot,
            env: { ...process.env, CODEX_HOME: codexHome, HOME: tempRoot, USERPROFILE: tempRoot, PORT: String(port) },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        try {
            await waitForOutput(child, `Local URL: http://127.0.0.1:${port}`);
            const config = JSON.parse(await readFile(path.join(tempRoot, ".infinite-canvas", "canvas-agent.json"), "utf8")) as { token: string };
            const response = await fetch(`http://127.0.0.1:${port}/agent/codex/auth?token=${encodeURIComponent(config.token)}`);
            const body = await response.json() as Record<string, unknown>;
            assert.equal(response.status, 200);
            assert.equal(body.ok, true);
            assert.equal(body.loggedIn, false);
            assert.equal(typeof body.summary, "string");
            assert.deepEqual(Object.keys(body).sort(), ["loggedIn", "ok", "summary"]);
        } finally {
            if (child.exitCode === null) {
                const closed = once(child, "close");
                child.kill();
                await closed;
            }
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});

async function unusedPort() {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const port = address.port;
    server.close();
    await once(server, "close");
    return port;
}

function waitForOutput(child: ChildProcess, expected: string) {
    return new Promise<void>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for canvas-agent startup: ${output}`)), 10_000);
        child.stdout?.on("data", (chunk) => {
            output += chunk.toString();
            if (!output.includes(expected)) return;
            clearTimeout(timeout);
            resolve();
        });
        child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
        child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once("exit", (code) => {
            if (output.includes(expected)) return;
            clearTimeout(timeout);
            reject(new Error(`canvas-agent exited before startup (${code}): ${output}`));
        });
    });
}
