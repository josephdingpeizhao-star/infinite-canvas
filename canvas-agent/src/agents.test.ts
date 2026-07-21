import assert from "node:assert/strict";
import test from "node:test";

import * as agents from "./agents.js";

type AgentTestSurface = {
    codexFailureEvent?: (error: unknown) => Record<string, unknown>;
    codexInput?: (prompt: string, images: string[]) => unknown[];
    codexThreadStartParams?: (cwd?: string, model?: string) => Record<string, unknown>;
    codexTurnFailure?: (turn: unknown, hasAssistantOutput: boolean, hasErrorNotification?: boolean) => (Error & { code?: string }) | null;
    createUtf8StreamDecoder?: (consume: (text: string) => void) => {
        write: (chunk: Buffer) => void;
        end: () => void;
    };
    summarizeCodexThread?: (thread: unknown) => Record<string, unknown>;
};

const subject = agents as AgentTestSurface;

test("thread start parameters include only an explicitly selected model", () => {
    assert.equal(typeof subject.codexThreadStartParams, "function");

    const selected = subject.codexThreadStartParams?.("C:/workspace", "gpt-5.5");
    const inherited = subject.codexThreadStartParams?.("C:/workspace");

    assert.equal(selected?.model, "gpt-5.5");
    assert.equal(selected?.cwd, "C:/workspace");
    assert.equal(Object.hasOwn(inherited || {}, "model"), false);
});

test("completed turns require assistant output and reject error notifications without exposing raw detail", () => {
    assert.equal(typeof subject.codexTurnFailure, "function");

    assert.equal(subject.codexTurnFailure?.({ status: "completed", error: null }, true), null);
    assert.equal(subject.codexTurnFailure?.({ status: "completed", error: null }, false)?.code, "empty_assistant_response");
    assert.equal(subject.codexTurnFailure?.({ status: "completed", error: null }, true, true)?.code, "codex_turn_failed");
    assert.equal(subject.codexTurnFailure?.({ status: "failed", error: null }, false)?.code, "codex_turn_failed");
    assert.equal(subject.codexTurnFailure?.({ status: "interrupted", error: null }, false)?.code, "codex_turn_interrupted");
    const privateFailure = subject.codexTurnFailure?.({ status: "failed", error: { message: "PRIVATE_PATH_TOKEN" } }, false);
    assert.equal(privateFailure?.code, "codex_turn_failed");
    assert.doesNotMatch(privateFailure?.message || "", /PRIVATE_PATH_TOKEN/);
});

test("fallback Codex errors preserve only allowlisted failure codes", () => {
    assert.equal(typeof subject.codexFailureEvent, "function");

    const empty = subject.codexFailureEvent?.(Object.assign(new Error("PRIVATE_PATH_TOKEN"), { code: "empty_assistant_response" }));
    const unknown = subject.codexFailureEvent?.(Object.assign(new Error("PRIVATE_PATH_TOKEN"), { code: "private_provider_failure" }));

    assert.deepEqual(empty, {
        agent: "codex",
        message: "Codex turn failed",
        failureCode: "empty_assistant_response",
    });
    assert.deepEqual(unknown, {
        agent: "codex",
        message: "Codex turn failed",
        failureCode: "codex_turn_failed",
    });
    assert.doesNotMatch(JSON.stringify([empty, unknown]), /PRIVATE_PATH_TOKEN|private_provider_failure/);
});

test("Codex turn input keeps the existing 0, 1, and 2 local-image protocol", () => {
    assert.equal(typeof subject.codexInput, "function");

    assert.deepEqual(subject.codexInput?.("prompt", []), [
        { type: "text", text: "prompt", text_elements: [] },
    ]);
    assert.deepEqual(subject.codexInput?.("prompt", ["C:/one.jpg"]), [
        { type: "text", text: "prompt", text_elements: [] },
        { type: "localImage", path: "C:/one.jpg" },
    ]);
    assert.deepEqual(subject.codexInput?.("prompt", ["C:/one.jpg", "C:/two.jpg"]), [
        { type: "text", text: "prompt", text_elements: [] },
        { type: "localImage", path: "C:/one.jpg" },
        { type: "localImage", path: "C:/two.jpg" },
    ]);
});

test("thread summaries render structured statuses as a stable state label", () => {
    assert.equal(typeof subject.summarizeCodexThread, "function");

    assert.equal(subject.summarizeCodexThread?.({ status: { type: "notLoaded" } }).status, "notLoaded");
    assert.equal(subject.summarizeCodexThread?.({ status: "idle" }).status, "idle");
});

test("Codex stdout decoding preserves Chinese JSON split inside a multibyte character", () => {
    assert.equal(typeof subject.createUtf8StreamDecoder, "function");

    const json = JSON.stringify({ notes: "高约 25 厘米，保持中文完整" });
    const bytes = Buffer.from(json, "utf8");
    const characterStart = bytes.indexOf(Buffer.from("高", "utf8"));
    assert.notEqual(characterStart, -1);

    const output: string[] = [];
    const decoder = subject.createUtf8StreamDecoder?.((text) => output.push(text));
    decoder?.write(bytes.subarray(0, characterStart + 1));
    decoder?.write(bytes.subarray(characterStart + 1));
    decoder?.end();

    assert.equal(output.join(""), json);
    assert.equal(output.join("").includes("\uFFFD"), false);
});
