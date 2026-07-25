import { describe, expect, test } from "bun:test";

import {
    READONLY_ASSISTANT_ENDPOINT,
    READONLY_ASSISTANT_MAX_HISTORY_BYTES,
    READONLY_ASSISTANT_MAX_HISTORY_ITEMS,
    READONLY_ASSISTANT_TIMEOUT_MESSAGE,
    mergeReadonlyAssistantSnapshot,
    pollReadonlyAssistant,
    readonlyAssistantHistory,
    submitReadonlyAssistantQuestion,
    type ReadonlyAssistantSnapshot,
} from "../src/lib/canvas/canvas-readonly-assistant";

function workingSnapshot(patch: Partial<ReadonlyAssistantSnapshot> = {}): ReadonlyAssistantSnapshot {
    return {
        ok: true,
        requestId: "question-1",
        status: "working",
        message: "助手正在代你查看机器内部…",
        startedAt: 1_000,
        updatedAt: 1_000,
        deadlineAt: 301_000,
        ...patch,
    };
}

describe("canvas readonly assistant", () => {
    test("submits to the fixed local endpoint with the existing canvas token", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const snapshot = await submitReadonlyAssistantQuestion("第三批现在什么状态？", [{ role: "assistant", content: "上一条答复" }], "canvas-token", async (input, init) => {
            calls.push({ url: String(input), init });
            return Response.json(workingSnapshot(), { status: 202 });
        });
        expect(snapshot.status).toBe("working");
        expect(calls[0]?.url).toBe(`${READONLY_ASSISTANT_ENDPOINT}/readonly-assistant/questions`);
        expect(calls[0]?.init?.method).toBe("POST");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
            question: "第三批现在什么状态？",
            history: [{ role: "assistant", content: "上一条答复" }],
        });
    });

    test("polling reaches a terminal answer and stops", async () => {
        let polls = 0;
        let now = 1_000;
        const result = await pollReadonlyAssistant(workingSnapshot(), "canvas-token", {
            now: () => now,
            pollMs: 2_000,
            sleep: async (milliseconds) => {
                now += milliseconds;
            },
            fetcher: async () => {
                polls += 1;
                return Response.json(
                    workingSnapshot({
                        status: "completed",
                        message: "助手已查看完成。",
                        answer: "第三批已关账并完成交付。",
                        updatedAt: now,
                    }),
                );
            },
        });
        expect(result.status).toBe("completed");
        expect(result.answer).toBe("第三批已关账并完成交付。");
        expect(polls).toBe(1);
    });

    test("polling cannot wait longer than 300 seconds or hang forever", async () => {
        let polls = 0;
        let now = 1_000;
        const result = await pollReadonlyAssistant(workingSnapshot({ deadlineAt: 999_999 }), "canvas-token", {
            now: () => now,
            pollMs: 100_000,
            maxWaitMs: 300_000,
            sleep: async (milliseconds) => {
                now += milliseconds;
            },
            fetcher: async () => {
                polls += 1;
                return Response.json(workingSnapshot({ deadlineAt: 999_999, updatedAt: now }));
            },
        });
        expect(result.status).toBe("failed");
        expect(result.message).toBe(READONLY_ASSISTANT_TIMEOUT_MESSAGE);
        expect(polls).toBe(2);
        expect(now).toBe(301_000);
        await expect(pollReadonlyAssistant(workingSnapshot(), "canvas-token", { maxWaitMs: 300_001 })).rejects.toThrow("300 秒");
    });

    test("one stalled status request is aborted at the same hard deadline", async () => {
        let now = 1_000;
        const result = await pollReadonlyAssistant(workingSnapshot({ deadlineAt: 999_999 }), "canvas-token", {
            now: () => now,
            pollMs: 1,
            maxWaitMs: 15,
            sleep: async (milliseconds) => {
                now += milliseconds;
            },
            fetcher: async (_input, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        now = 1_015;
                        reject(new DOMException("aborted", "AbortError"));
                    });
                }),
        });
        expect(result.status).toBe("failed");
        expect(result.message).toBe(READONLY_ASSISTANT_TIMEOUT_MESSAGE);
        expect(now).toBe(1_015);
    });

    test("unchanged polling snapshots preserve object identity", () => {
        const original = workingSnapshot();
        expect(mergeReadonlyAssistantSnapshot(original, { ...original })).toBe(original);
        const changed = { ...original, updatedAt: 2_000 };
        expect(mergeReadonlyAssistantSnapshot(original, changed)).toBe(changed);
    });

    test("history is limited to eight messages and eight KiB", () => {
        const messages = Array.from({ length: 12 }, (_, index) => ({
            role: index % 2 ? "assistant" : "user",
            text: `消息 ${index}`,
        }));
        const recent = readonlyAssistantHistory(messages);
        expect(recent).toHaveLength(READONLY_ASSISTANT_MAX_HISTORY_ITEMS);
        expect(recent[0]?.content).toBe("消息 4");

        const oversized = readonlyAssistantHistory([{ role: "assistant", text: "答".repeat(10_000) }]);
        expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeLessThanOrEqual(READONLY_ASSISTANT_MAX_HISTORY_BYTES);
    });

    test("server rejections remain human-readable and are never queued locally", async () => {
        await expect(
            submitReadonlyAssistantQuestion("QC 发现了什么问题？", [], "canvas-token", async () =>
                Response.json(
                    {
                        ok: false,
                        error: "assistant_busy",
                        message: "上一条问答仍在进行或安全收尾，请稍后再问；本次没有排队。",
                    },
                    { status: 409 },
                ),
            ),
        ).rejects.toThrow("本次没有排队");
    });
});
