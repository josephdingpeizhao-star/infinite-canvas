import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { agentStreamId, upsertAgentMessage } from "../src/lib/canvas/canvas-agent-client";
import type { AgentChatItem } from "../src/stores/use-agent-store";

function assistant(streamId: string, text: string): Omit<AgentChatItem, "id"> {
    return { role: "assistant", title: "Codex", text, streamId };
}

function apply(messages: AgentChatItem[], item: Omit<AgentChatItem, "id">, id: string) {
    return upsertAgentMessage(messages, item, id);
}

describe("AG-01 assistant snapshot identity", () => {
    test("keeps two interleaved agent messages in one turn independent through their final snapshots", () => {
        const firstStreamId = agentStreamId("turn-1", "item-1");
        const secondStreamId = agentStreamId("turn-1", "item-2");
        let messages: AgentChatItem[] = [];

        messages = apply(messages, assistant(firstStreamId, "第一条"), "message-1");
        messages = apply(messages, assistant(secondStreamId, "第二条"), "message-2");
        messages = apply(messages, assistant(firstStreamId, "第一条最终全文"), "message-3");
        messages = apply(messages, assistant(secondStreamId, "第二条最终全文"), "message-4");

        expect(messages.map(({ streamId, text }) => ({ streamId, text }))).toEqual([
            { streamId: firstStreamId, text: "第一条最终全文" },
            { streamId: secondStreamId, text: "第二条最终全文" },
        ]);
    });
});

describe("AG-01 message upsert matrix", () => {
    test("replaces a matching stream snapshot while preserving the original message id", () => {
        const streamId = agentStreamId("turn-1", "item-1");
        let messages = apply([], assistant(streamId, "短"), "stable-id");
        messages = apply(messages, assistant(streamId, "完整快照"), "discarded-id");

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ id: "stable-id", streamId, text: "完整快照" });
    });

    test("appends a previously unseen stream identity", () => {
        const firstStreamId = agentStreamId("turn-1", "item-1");
        const secondStreamId = agentStreamId("turn-1", "item-2");
        let messages = apply([], assistant(firstStreamId, "一"), "message-1");
        messages = apply(messages, assistant(secondStreamId, "二"), "message-2");

        expect(messages.map(({ id, streamId, text }) => ({ id, streamId, text }))).toEqual([
            { id: "message-1", streamId: firstStreamId, text: "一" },
            { id: "message-2", streamId: secondStreamId, text: "二" },
        ]);
    });

    test("keeps the same item id in different turns as different streams", () => {
        const firstStreamId = agentStreamId("turn-1", "reused-item");
        const secondStreamId = agentStreamId("turn-2", "reused-item");
        let messages = apply([], assistant(firstStreamId, "上一轮"), "message-1");
        messages = apply(messages, assistant(secondStreamId, "下一轮"), "message-2");

        expect(firstStreamId).not.toBe(secondStreamId);
        expect(messages.map((item) => item.text)).toEqual(["上一轮", "下一轮"]);
        expect(agentStreamId("turn-1", firstStreamId)).toBe(firstStreamId);
    });

    test("keeps unkeyed user, tool, and error messages as separate entries", () => {
        let messages: AgentChatItem[] = [];
        messages = apply(messages, { role: "user", text: "用户" }, "user-id");
        messages = apply(messages, { role: "tool", title: "工具", text: "结果" }, "tool-id");
        messages = apply(messages, { role: "error", title: "错误", text: "失败" }, "error-id");

        expect(messages.map(({ id, role, text }) => ({ id, role, text }))).toEqual([
            { id: "user-id", role: "user", text: "用户" },
            { id: "tool-id", role: "tool", text: "结果" },
            { id: "error-id", role: "error", text: "失败" },
        ]);
    });

    test("preserves the existing unkeyed assistant coalescing behavior", () => {
        let messages = apply([], { role: "assistant", title: "提示", text: "前" }, "message-1");
        messages = apply(messages, { role: "assistant", title: "提示", text: "后" }, "message-2");

        expect(messages).toEqual([{ id: "message-1", role: "assistant", title: "提示", text: "前后" }]);
    });

    test("keeps the existing slice(-120) append bound and ordered tail", () => {
        const messages = Array.from({ length: 125 }, (_, index): AgentChatItem => ({ id: `old-${index}`, role: "tool", text: `${index}` }));
        const next = apply(messages, { role: "tool", text: "next" }, "next-id");

        expect(next).toHaveLength(121);
        expect(next[0]?.id).toBe("old-5");
        expect(next.at(-1)?.id).toBe("next-id");
    });

    test("trims text and ignores empty messages unless they carry attachments", () => {
        const unchanged: AgentChatItem[] = [{ id: "existing", role: "tool", text: "existing" }];
        expect(apply(unchanged, { role: "error", text: "   " }, "empty-id")).toBe(unchanged);

        const trimmed = apply([], { role: "user", text: "  hello  " }, "trimmed-id");
        expect(trimmed[0]?.text).toBe("hello");

        const withAttachment = apply([], {
            role: "user",
            text: "   ",
            attachments: [{ id: "attachment-1", name: "photo.png", type: "image/png", size: 1, url: "blob:test", dataUrl: "data:image/png;base64,AA==" }],
        }, "attachment-id");
        expect(withAttachment).toHaveLength(1);
        expect(withAttachment[0]?.text).toBe("");
    });
});

describe("AG-01 component wiring", () => {
    const hostSource = readFileSync(new URL("../src/components/canvas/canvas-agent-connection-host.tsx", import.meta.url), "utf8");
    const panelSource = readFileSync(new URL("../src/components/canvas/canvas-local-agent-panel.tsx", import.meta.url), "utf8");

    test("routes both component wrappers through the shared pure upsert", () => {
        for (const source of [hostSource, panelSource]) {
            expect(source).toContain("upsertAgentMessage(currentMessages, item,");
            expect(source).not.toContain("mergeAgentText");
        }
    });

    test("derives streamed assistant identity from the actual turn field when available", () => {
        expect(hostSource).toContain('streamId: agentStreamId(event.turnId || event.turn_id || "", item.id || "")');
    });
});
