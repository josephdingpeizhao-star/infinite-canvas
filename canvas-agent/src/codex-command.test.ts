import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { codexBin, resolveCodexCommand } from "./codex-command.js";
import { startLogin } from "./codex-auth.js";

describe("Codex command resolution", () => {
    test("win32 x64 resolves the native codex.exe with wrapper-equivalent env", () => {
        process.env.CANVAS_AGENT_CODEX_COMMAND_SENTINEL = "inherited";
        try {
            const resolved = resolveCodexCommand("win32", "x64");
            assert.equal(resolved.fallback, undefined);
            assert.equal(path.isAbsolute(resolved.command), true);
            assert.equal(resolved.command.endsWith(path.join("@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe")), true);
            assert.deepEqual(resolved.baseArgs, []);
            assert.ok(resolved.env);
            assert.equal(resolved.env.CODEX_MANAGED_BY_NPM, "1");
            assert.equal(typeof resolved.env.CODEX_MANAGED_PACKAGE_ROOT, "string");
            assert.equal(resolved.env.CODEX_MANAGED_PACKAGE_ROOT?.endsWith(path.join("@openai", "codex")), true);
            assert.equal(resolved.env.CANVAS_AGENT_CODEX_COMMAND_SENTINEL, "inherited");
        } finally {
            delete process.env.CANVAS_AGENT_CODEX_COMMAND_SENTINEL;
        }
    });

    test("non-Windows keeps the wrapper form byte-for-byte", () => {
        const resolved = resolveCodexCommand("darwin", "arm64");
        assert.deepEqual(resolved, { command: process.execPath, baseArgs: [codexBin()] });
        assert.equal(resolved.baseArgs[0]?.endsWith(path.join("@openai", "codex", "bin", "codex.js")), true);
        assert.equal(resolved.env, undefined);
        assert.equal(resolved.fallback, undefined);
    });

    test("win32 falls back to the wrapper with a marker when the platform package cannot be resolved", () => {
        const resolved = resolveCodexCommand("win32", "x64", { resolvePackageJson: () => { throw new Error("not installed"); } });
        assert.equal(resolved.command, process.execPath);
        assert.deepEqual(resolved.baseArgs, [codexBin()]);
        assert.equal(resolved.env, undefined);
        assert.ok(resolved.fallback);
        assert.equal(resolved.fallback.reason.includes("@openai/codex-win32-x64"), true);
    });

    test("win32 falls back with a marker when the resolved native binary is missing on disk", () => {
        const missingRoot = path.join(os.tmpdir(), "canvas-agent-missing-codex-package");
        const resolved = resolveCodexCommand("win32", "x64", { resolvePackageJson: () => path.join(missingRoot, "package.json") });
        assert.equal(resolved.command, process.execPath);
        assert.deepEqual(resolved.baseArgs, [codexBin()]);
        assert.ok(resolved.fallback);
        assert.equal(resolved.fallback.reason.includes(missingRoot), true);
    });

    test("win32 on an arch without a native platform package falls back with a marker", () => {
        const resolved = resolveCodexCommand("win32", "ia32");
        assert.equal(resolved.command, process.execPath);
        assert.deepEqual(resolved.baseArgs, [codexBin()]);
        assert.ok(resolved.fallback);
        assert.equal(resolved.fallback.reason.includes("ia32"), true);
    });

    test("startLogin spawns through the resolved command shape with windowsHide and env", () => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: () => true }) as unknown as ChildProcess;
        let captured: { command: string; args: string[]; options: { stdio: unknown; windowsHide: boolean; env?: NodeJS.ProcessEnv } } | undefined;
        const spawnLogin = (command: string, args: string[], options: { stdio: ["ignore", "pipe", "pipe"]; windowsHide: true; env?: NodeJS.ProcessEnv }) => {
            captured = { command, args, options };
            return child;
        };

        assert.deepEqual(startLogin(() => undefined, spawnLogin), { started: true });
        child.emit("close", 0);

        const expected = resolveCodexCommand();
        assert.ok(captured);
        assert.equal(captured.command, expected.command);
        assert.deepEqual(captured.args, [...expected.baseArgs, "login"]);
        assert.deepEqual(captured.options.stdio, ["ignore", "pipe", "pipe"]);
        assert.equal(captured.options.windowsHide, true);
        if (expected.env) {
            assert.equal(captured.options.env?.CODEX_MANAGED_BY_NPM, "1");
            assert.equal(captured.options.env?.CODEX_MANAGED_PACKAGE_ROOT, expected.env.CODEX_MANAGED_PACKAGE_ROOT);
        } else {
            assert.equal(captured.options.env, undefined);
        }
    });

    test("all three Codex spawn call sites keep the unified resolved shape with windowsHide", async () => {
        const sourceDir = path.dirname(fileURLToPath(import.meta.url));
        const sources = await Promise.all([
            readFile(path.join(sourceDir, "agents.ts"), "utf8"),
            readFile(path.join(sourceDir, "codex-auth.ts"), "utf8"),
        ]);
        const lines = sources.flatMap((source) => source.split(/\r?\n/));
        assert.equal(lines.filter((line) => line.includes("resolveCodexCommand()")).length, 3);
        const spawnLines = lines.filter((line) => line.includes("codex.command"));
        assert.equal(spawnLines.length, 3);
        for (const line of spawnLines) {
            assert.equal(line.includes("...codex.baseArgs"), true);
            assert.equal(line.includes("windowsHide: true"), true);
            assert.equal(line.includes("...(codex.env ? { env: codex.env } : {})"), true);
        }
    });
});
