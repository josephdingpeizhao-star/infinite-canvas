import { describe, expect, test } from "bun:test";

import {
    buildProductionCommand,
    buildProductionQuoteUrl,
    expireProductionState,
    fetchProductionQuote,
    readProductionState,
    reserveProductionSubmission,
    resolveProductionSelection,
} from "../src/lib/canvas/canvas-workflow-production";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function workflow(patch: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id: "machine",
        type: CanvasNodeType.Workflow,
        title: "生图工作流",
        position: { x: 0, y: 0 },
        width: 420,
        height: 300,
        metadata: patch,
    };
}

function card(status = "completed"): CanvasNodeData {
    return {
        id: "card",
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: -500, y: 0 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status,
                productType: "杯子",
                allowClearWater: true,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                receipt: { batchId: "杯子_20260719", imageCount: 2, facts: {} },
            },
        },
    } as CanvasNodeData;
}

function image(): CanvasNodeData {
    return {
        id: "original",
        type: CanvasNodeType.Image,
        title: "原图",
        position: { x: -300, y: 600 },
        width: 180,
        height: 180,
        metadata: { content: "blob:original", storageKey: "image:original" },
    };
}

const connection = (id: string, fromNodeId: string, toNodeId: string): CanvasConnection => ({ id, fromNodeId, toNodeId });

describe("canvas workflow production", () => {
    test("uses demo mode only when no information card is connected", () => {
        const machine = workflow();
        const original = image();
        expect(resolveProductionSelection(machine.id, [machine, original], [connection("image", original.id, machine.id)])).toEqual({ mode: "demo" });

        const unfinished = card("queued");
        expect(resolveProductionSelection(machine.id, [machine, unfinished, original], [connection("card", unfinished.id, machine.id), connection("image", original.id, machine.id)])).toEqual({
            mode: "error",
            message: "信息卡尚未登记完成，不能进入真实制作。",
        });
    });

    test("selects exactly one completed card and connected material for real mode", () => {
        const machine = workflow();
        const info = card();
        const original = image();
        expect(resolveProductionSelection(machine.id, [machine, info, original], [connection("card", info.id, machine.id), connection("image", original.id, machine.id)])).toEqual({
            mode: "production",
            cardId: "card",
            batchId: "杯子_20260719",
            materialCount: 1,
        });
        expect(resolveProductionSelection(machine.id, [machine, info], [connection("card", info.id, machine.id)])).toEqual({
            mode: "error",
            message: "请保留已登记信息卡，并把至少 1 张批次素材连到工作流机器。",
        });
    });

    test("rejects ambiguous cards instead of falling back to demo", () => {
        const machine = workflow();
        const first = card();
        const second = { ...card(), id: "card-2" };
        const original = image();
        const result = resolveProductionSelection(machine.id, [machine, first, second, original], [connection("a", first.id, machine.id), connection("b", second.id, machine.id), connection("c", original.id, machine.id)]);
        expect(result).toEqual({ mode: "error", message: "一台真实工作流机器只能连接一张批次信息卡。" });
    });

    test("fetches a read-only 17373 quote with the existing canvas token", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const quote = await fetchProductionQuote("杯子_20260719", "canvas-token", async (input, init) => {
            calls.push({ url: String(input), init });
            return new Response(JSON.stringify({ ok: true, batchId: "杯子_20260719", totalCount: 14, readyCount: 0, remainingCount: 14, estimatedUnitUsd: 0.06, estimatedTotalUsd: 0.84, estimatedMinutes: 55 }), { status: 200 });
        });
        expect(quote).toMatchObject({ remainingCount: 14, estimatedTotalUsd: 0.84 });
        expect(calls[0]?.url).toBe("http://127.0.0.1:17373/workflow-production/%E6%9D%AF%E5%AD%90_20260719/quote");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(calls[0]?.init?.method).toBe("GET");
        expect(buildProductionQuoteUrl("https://example.com", "cup")).toBeNull();
    });

    test("writes only existing run-controller syntax after fee confirmation", () => {
        const first = buildProductionCommand(readProductionState(undefined), "cup", "request-001", 1_000);
        expect(first.content).toContain("run: next");
        expect(first.content).not.toContain("run: renders");
        expect(first.state).toMatchObject({ status: "queued", batchId: "cup", requestId: "request-001", producedCount: 0 });
        const partial = readProductionState({ workflowProduction: { status: "paused", producedCount: 1, batchId: "cup" } });
        expect(buildProductionCommand(partial, "cup", "request-002", 2_000).content).toContain("retry: renders");
    });

    test("allows exactly one submission per machine and batch until the page is reopened", () => {
        const submissions = new Set<string>();
        expect(reserveProductionSubmission(submissions, "machine", "cup")).toBe(true);
        expect(reserveProductionSubmission(submissions, "machine", "cup")).toBe(false);
        expect(submissions.size).toBe(1);

        const reopenedPage = new Set<string>();
        expect(reserveProductionSubmission(reopenedPage, "machine", "cup")).toBe(true);
    });

    test("expires only an unacknowledged command and preserves finished images", () => {
        const queued = buildProductionCommand(readProductionState(undefined), "cup", "request-001", 1_000).state;
        expect(expireProductionState(queued, 8_999)).toEqual(queued);
        expect(expireProductionState(queued, 9_000)).toMatchObject({ status: "failed", producedCount: 0 });
        const running = readProductionState({ workflowProduction: { status: "running", producedCount: 5, batchId: "cup", updatedAt: 1_000 } });
        expect(expireProductionState(running, 720_999)).toEqual(running);
        expect(expireProductionState(running, 721_000)).toMatchObject({ status: "failed", producedCount: 5 });
    });
});
