import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    COLLAPSED_PREVIEW_CHARS,
    DETAIL_JSON_LIMIT,
    LONG_TEXT_THRESHOLD,
    clampDetailJson,
    clampText,
    windowMessages,
} from "../src/lib/agent/agent-chat-view";

const chatSource = readFileSync(new URL("../src/components/canvas/canvas-agent-chat-ui.tsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/components/canvas/canvas-local-agent-panel.tsx", import.meta.url), "utf8");

describe("agent chat text clamping", () => {
    test("keeps text exactly at the threshold unchanged", () => {
        const text = "a".repeat(LONG_TEXT_THRESHOLD);
        expect(clampText(text, false)).toEqual({ text, truncated: false, totalChars: LONG_TEXT_THRESHOLD });
    });

    test("clamps threshold plus one to the configured preview length", () => {
        const text = "b".repeat(LONG_TEXT_THRESHOLD + 1);
        const result = clampText(text, false);
        expect(result.text).toBe(text.slice(0, COLLAPSED_PREVIEW_CHARS));
        expect(result.text).toHaveLength(COLLAPSED_PREVIEW_CHARS);
        expect(result.truncated).toBe(true);
        expect(result.totalChars).toBe(LONG_TEXT_THRESHOLD + 1);
    });

    test("never clamps expanded text", () => {
        const text = "c".repeat(LONG_TEXT_THRESHOLD + 1);
        expect(clampText(text, true)).toEqual({ text, truncated: false, totalChars: LONG_TEXT_THRESHOLD + 1 });
    });

    test("keeps empty and short text unchanged", () => {
        expect(clampText("", false)).toEqual({ text: "", truncated: false, totalChars: 0 });
        expect(clampText("short", false)).toEqual({ text: "short", truncated: false, totalChars: 5 });
    });
});

describe("agent chat message window", () => {
    test("keeps lists within the default window intact", () => {
        const items = Array.from({ length: 30 }, (_, index) => index);
        expect(windowMessages(items, false)).toEqual({ visible: items, hiddenCount: 0 });
    });

    test("keeps the ordered tail and reports the hidden count", () => {
        const items = Array.from({ length: 33 }, (_, index) => index);
        const result = windowMessages(items, false);
        expect(result.visible).toEqual(items.slice(3));
        expect(result.hiddenCount).toBe(3);
    });

    test("returns the full list when showAll is enabled", () => {
        const items = Array.from({ length: 33 }, (_, index) => index);
        expect(windowMessages(items, true)).toEqual({ visible: items, hiddenCount: 0 });
    });

    test("honors a custom window size", () => {
        expect(windowMessages(["a", "b", "c", "d"], false, 2)).toEqual({ visible: ["c", "d"], hiddenCount: 2 });
    });
});

describe("agent detail JSON clamping", () => {
    test("keeps JSON within the render limit unchanged", () => {
        const json = "d".repeat(DETAIL_JSON_LIMIT);
        expect(clampDetailJson(json, false)).toEqual({ text: json, truncated: false, totalChars: DETAIL_JSON_LIMIT });
    });

    test("clamps JSON beyond the render limit and marks it", () => {
        const json = "e".repeat(DETAIL_JSON_LIMIT + 1);
        expect(clampDetailJson(json, false)).toEqual({ text: json.slice(0, DETAIL_JSON_LIMIT), truncated: true, totalChars: DETAIL_JSON_LIMIT + 1 });
    });
});

describe("agent chat component source contracts", () => {
    test("exports AgentChatMessage through memo", () => {
        expect(chatSource).toContain("export const AgentChatMessage = memo(function AgentChatMessage(");
    });

    test("stringifies detail only after the expanded guard and renders no collapsed pre", () => {
        const detailBlockSource = chatSource.slice(chatSource.indexOf("function AgentDetailBlock"), chatSource.indexOf("function AgentAvatar"));
        const lazyGuard = "if (!expanded || cachedDetailRef.current?.detail === detail) return;";
        expect(detailBlockSource).toContain(lazyGuard);
        expect(detailBlockSource.indexOf(lazyGuard)).toBeLessThan(detailBlockSource.indexOf("JSON.stringify(detail, null, 2)"));
        expect(detailBlockSource).toContain("if (!expanded || !cached) return null;");
    });

    test("uses the message tail window and renders the earlier-message control", () => {
        expect(panelSource).toContain("windowMessages(messages, showAllMessages)");
        expect(panelSource).toContain("messageWindow.visible.map(");
        expect(panelSource).not.toContain("messages.map(");
        expect(panelSource).toContain("显示更早 {messageWindow.hiddenCount} 条消息");
    });

    test("renders the collapsed assistant preview as plain text outside Streamdown", () => {
        expect(chatSource).toMatch(/messageText\.truncated \? \(\r?\n\s+<div className="whitespace-pre-wrap break-words text-left">\{messageText\.text\}<\/div>\r?\n\s+\) : \(\r?\n\s+<Streamdown/);
    });

    test("passes attachment-free items through and caches converted attachment items", () => {
        expect(panelSource).toContain("const agentChatMessageCache = new WeakMap<AgentChatItem, CanvasAgentChatMessage>();");
        expect(panelSource).toContain("if (!item.attachments?.length) return item;");
        expect(panelSource).toContain("agentChatMessageCache.set(item, converted);");
    });
});
