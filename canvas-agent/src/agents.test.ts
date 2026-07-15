import assert from "node:assert/strict";
import test from "node:test";

import * as agents from "./agents.js";

type AgentTestSurface = {
    codexThreadStartParams?: (cwd?: string, model?: string) => Record<string, unknown>;
    codexTurnFailure?: (turn: unknown) => Error | null;
    createUtf8StreamDecoder?: (consume: (text: string) => void) => {
        write: (chunk: Buffer) => void;
        end: () => void;
    };
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

test("completed turns pass while failed and interrupted turns reject", () => {
    assert.equal(typeof subject.codexTurnFailure, "function");

    assert.equal(subject.codexTurnFailure?.({ status: "completed", error: null }), null);
    assert.match(subject.codexTurnFailure?.({ status: "failed", error: null })?.message || "", /failed/);
    assert.match(subject.codexTurnFailure?.({ status: "interrupted", error: null })?.message || "", /interrupted/);
    assert.equal(subject.codexTurnFailure?.({ status: "failed", error: { message: "private" } })?.message, "private");
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
