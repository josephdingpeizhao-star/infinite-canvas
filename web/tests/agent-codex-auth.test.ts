import { describe, expect, test } from "bun:test";

import {
    CODEX_AUTH_POLL_INTERVAL_MS,
    CODEX_AUTH_POLL_LIMIT,
    codexAuthStatusText,
    normalizeCodexAuthResponse,
    shouldContinuePolling,
} from "../src/lib/agent/agent-codex-auth";

describe("Codex auth view policy", () => {
    test("uses a three-second interval and a one-hundred-attempt limit", () => {
        expect(CODEX_AUTH_POLL_INTERVAL_MS).toBe(3_000);
        expect(CODEX_AUTH_POLL_LIMIT).toBe(100);
    });

    test("stops polling immediately after login or at the attempt limit", () => {
        expect(shouldContinuePolling({ attempts: 0, loggedIn: false })).toBe(true);
        expect(shouldContinuePolling({ attempts: 99, loggedIn: false })).toBe(true);
        expect(shouldContinuePolling({ attempts: 100, loggedIn: false })).toBe(false);
        expect(shouldContinuePolling({ attempts: 1, loggedIn: true })).toBe(false);
    });

    test("normalizes backend responses without trusting malformed fields", () => {
        expect(normalizeCodexAuthResponse({ loggedIn: true, summary: " Logged in using ChatGPT " })).toEqual({ loggedIn: true, summary: "Logged in using ChatGPT" });
        expect(normalizeCodexAuthResponse({ loggedIn: "true", summary: 123 })).toEqual({ loggedIn: false, summary: "" });
        expect(normalizeCodexAuthResponse(null)).toEqual({ loggedIn: false, summary: "" });
    });

    test("maps every visible account state to user-facing text", () => {
        const loggedOut = { loggedIn: false, summary: "" };
        expect(codexAuthStatusText({ connected: false, phase: "idle", auth: loggedOut })).toBe("先连接本机 Agent");
        expect(codexAuthStatusText({ connected: true, phase: "checking", auth: loggedOut })).toBe("检测中");
        expect(codexAuthStatusText({ connected: true, phase: "ready", auth: { loggedIn: true, summary: "Logged in using ChatGPT" } })).toBe("已登录（Logged in using ChatGPT）");
        expect(codexAuthStatusText({ connected: true, phase: "ready", auth: loggedOut })).toBe("未登录");
        expect(codexAuthStatusText({ connected: true, phase: "waiting", auth: loggedOut })).toBe("等待浏览器授权…");
        expect(codexAuthStatusText({ connected: true, phase: "timed-out", auth: loggedOut })).toBe("未登录，可再试一次");
    });
});
