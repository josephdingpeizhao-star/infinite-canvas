import { describe, expect, test } from "bun:test";

import {
    BATCH_RECYCLE_UNAVAILABLE_MESSAGE,
    BATCH_RECYCLE_UNTRUSTED_MESSAGE,
    advanceBatchRecycleButton,
    batchRecycleButtonDisabled,
    batchRecycleButtonLabel,
    buildBatchRecycleUrl,
    submitBatchRecycle,
} from "../src/lib/canvas/canvas-batch-recycle";

const BATCH_ID = "杯子_20260726";
const SUCCESS = { ok: true, batchId: BATCH_ID, status: "recycled", message: "批次已移入回收站。" };

describe("canvas batch recycle", () => {
    test("posts exact empty JSON to the fixed encoded loopback route with the existing token", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const result = await submitBatchRecycle(BATCH_ID, " canvas-token ", async (input, init) => {
            calls.push({ url: String(input), init });
            return new Response(JSON.stringify(SUCCESS), { status: 200 });
        });

        expect(result).toEqual(SUCCESS);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("http://127.0.0.1:17373/batch-recycle/%E6%9D%AF%E5%AD%90_20260726");
        expect(calls[0]?.init?.method).toBe("POST");
        expect(calls[0]?.init?.body).toBe("{}");
        expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
    });

    test("rejects missing credentials or unsafe batch ids before any request", async () => {
        let calls = 0;
        const fetcher: typeof fetch = async () => {
            calls += 1;
            return new Response();
        };

        await expect(submitBatchRecycle(BATCH_ID, "", fetcher)).rejects.toThrow(BATCH_RECYCLE_UNAVAILABLE_MESSAGE);
        await expect(submitBatchRecycle("../cup", "canvas-token", fetcher)).rejects.toThrow(BATCH_RECYCLE_UNAVAILABLE_MESSAGE);
        expect(buildBatchRecycleUrl("https://example.com", BATCH_ID)).toBeNull();
        expect(calls).toBe(0);
    });

    test("accepts only an exact success receipt for the requested batch and recycled status", async () => {
        for (const payload of [
            { ...SUCCESS, batchId: "other" },
            { ...SUCCESS, status: "restored" },
            { ...SUCCESS, workspaceTarget: "D:\\private" },
            { ok: true, batchId: BATCH_ID, status: "recycled" },
        ]) {
            await expect(
                submitBatchRecycle(BATCH_ID, "canvas-token", async () => new Response(JSON.stringify(payload), { status: 200 })),
            ).rejects.toThrow(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
        }
    });

    test("uses two-step confirmation and keeps submitting and successful states disabled", () => {
        expect(batchRecycleButtonLabel("idle")).toBe("移入回收站");
        expect(advanceBatchRecycleButton("idle")).toEqual({ phase: "confirming", shouldSubmit: false });
        expect(batchRecycleButtonLabel("confirming")).toBe("确认移入回收站");
        expect(advanceBatchRecycleButton("confirming")).toEqual({ phase: "submitting", shouldSubmit: true });
        expect(advanceBatchRecycleButton("submitting")).toEqual({ phase: "submitting", shouldSubmit: false });
        expect(batchRecycleButtonDisabled("submitting")).toBe(true);
        expect(batchRecycleButtonDisabled("succeeded")).toBe(true);
        expect(advanceBatchRecycleButton("failed")).toEqual({ phase: "confirming", shouldSubmit: false });
    });

    test("surfaces only the exact known safe failure for the same batch", async () => {
        const message = "批次已冻结，画布节点与目录尚未处理，请启动画布后重跑同一条回收命令。";
        await expect(
            submitBatchRecycle(
                BATCH_ID,
                "canvas-token",
                async () =>
                    new Response(
                        JSON.stringify({ ok: false, error: "batch_recycle_rejected", batchId: BATCH_ID, message }),
                        { status: 503 },
                    ),
            ),
        ).rejects.toThrow(message);

        await expect(
            submitBatchRecycle(
                BATCH_ID,
                "canvas-token",
                async () =>
                    new Response(
                        JSON.stringify({
                            ok: false,
                            error: "batch_recycle_rejected",
                            batchId: BATCH_ID,
                            message,
                            traceback: "private",
                        }),
                        { status: 503 },
                    ),
            ),
        ).rejects.toThrow(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
    });

    test("fails closed for network, non-JSON, and untrusted replies without retrying", async () => {
        let calls = 0;
        await expect(
            submitBatchRecycle(BATCH_ID, "canvas-token", async () => {
                calls += 1;
                throw new Error("offline");
            }),
        ).rejects.toThrow(BATCH_RECYCLE_UNAVAILABLE_MESSAGE);
        await expect(
            submitBatchRecycle(BATCH_ID, "canvas-token", async () => {
                calls += 1;
                return new Response("not-json", { status: 200 });
            }),
        ).rejects.toThrow(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
        await expect(
            submitBatchRecycle(BATCH_ID, "canvas-token", async () => {
                calls += 1;
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }),
        ).rejects.toThrow(BATCH_RECYCLE_UNTRUSTED_MESSAGE);
        expect(calls).toBe(3);
    });
});
