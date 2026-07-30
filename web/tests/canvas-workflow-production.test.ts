import { describe, expect, test } from "bun:test";

import {
    COMPLETED_PRODUCTION_ACTION_LABEL,
    applyProductionQuote,
    buildProductionCommand,
    buildProductionQuoteUrl,
    completedProductionStatusText,
    expireProductionState,
    fetchProductionQuote,
    isProductionStartBlocked,
    readExpectedImageSet,
    readProductionState,
    reserveProductionSubmission,
    resolveProductionSelection,
    WORKFLOW_COUNT_DATA_MISSING_MESSAGE,
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
                receipt: {
                    batchId: "杯子_20260719",
                    imageCount: 2,
                    facts: {
                        product_type: "杯子",
                        length_cm: null,
                        width_cm: null,
                        height_cm: 25,
                        main_image_count: 6,
                        detail_image_count: 8,
                        handheld_main: 2,
                        handheld_detail: 1,
                        allow_clear_water: true,
                        forbid_pouring_and_heating: true,
                        missing_d_no_retake: true,
                    },
                },
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
const configIds = (mainCount: number, detailCount: number) => [
    ...Array.from({ length: mainCount }, (_, index) => `main_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: detailCount }, (_, index) => `detail_${String(index + 1).padStart(2, "0")}`),
];
const productionMetadata = (status: "queued" | "running" | "paused" | "completed" | "failed", producedCount: number, mainCount = 6, detailCount = 8) => ({
    status,
    producedCount,
    totalCount: mainCount + detailCount,
    expectedConfigIds: configIds(mainCount, detailCount),
    batchId: "cup",
});

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
            return new Response(JSON.stringify({ ok: true, batchId: "杯子_20260719", totalCount: 14, expectedConfigIds: configIds(6, 8), readyCount: 0, remainingCount: 14, estimatedUnitUsd: 0.06, estimatedTotalUsd: 0.84, estimatedMinutes: 55 }), { status: 200 });
        });
        expect(quote).toMatchObject({ remainingCount: 14, estimatedTotalUsd: 0.84 });
        expect(calls[0]?.url).toBe("http://127.0.0.1:17373/workflow-production/%E6%9D%AF%E5%AD%90_20260719/quote");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(calls[0]?.init?.method).toBe("GET");
        expect(buildProductionQuoteUrl("https://example.com", "cup")).toBeNull();
    });

    test("writes only existing run-controller syntax after fee confirmation", () => {
        const first = buildProductionCommand(readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) }), "cup", "request-001", 1_000);
        expect(first.content).toContain("run: next");
        expect(first.content).not.toContain("run: renders");
        expect(first.state).toMatchObject({ status: "queued", batchId: "cup", requestId: "request-001", producedCount: 0 });
        const partial = readProductionState({ workflowProduction: productionMetadata("paused", 1, 3, 2) });
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

    test("completed continuation is eligible and emits exactly run next while retries stay unchanged", () => {
        const completed = readProductionState({ workflowProduction: productionMetadata("completed", 14) });
        expect(isProductionStartBlocked(completed)).toBe(false);
        const completedCommand = buildProductionCommand(completed, "cup", "request-completed", 3_000);
        expect(completedCommand.content.split("\n").at(-1)).toBe("run: next");
        expect(completedCommand.content).not.toContain("retry: renders");

        const paused = readProductionState({ workflowProduction: productionMetadata("paused", 14) });
        expect(buildProductionCommand(paused, "cup", "request-paused", 4_000).content.split("\n").at(-1)).toBe("retry: renders");
        const failed = readProductionState({ workflowProduction: productionMetadata("failed", 5) });
        expect(buildProductionCommand(failed, "cup", "request-failed", 5_000).content.split("\n").at(-1)).toBe("retry: renders");
    });

    test("completed copy prefers the backend message and otherwise stays route neutral", () => {
        expect(completedProductionStatusText("质检完成，QC 报告已生成。", 5)).toBe("质检完成，QC 报告已生成。");
        expect(completedProductionStatusText(undefined, 5)).toBe("5 张真实图片已上桌。点击继续后，机器会按当前批次状态处理下一步。");
        expect(completedProductionStatusText(undefined, 5)).not.toContain("停在质检前");
        expect(COMPLETED_PRODUCTION_ACTION_LABEL).toBe("继续");
    });

    test("completed continuation keeps one submission per machine and batch", () => {
        const completed = readProductionState({ workflowProduction: productionMetadata("completed", 14) });
        if (isProductionStartBlocked(completed)) throw new Error("completed must remain eligible for the guarded submission path");
        const submissions = new Set<string>();
        expect(reserveProductionSubmission(submissions, "machine", "cup")).toBe(true);
        expect(reserveProductionSubmission(submissions, "machine", "cup")).toBe(false);
        expect(submissions.size).toBe(1);
    });

    test("expires only an unacknowledged command and preserves finished images", () => {
        const queued = buildProductionCommand(readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) }), "cup", "request-001", 1_000).state;
        expect(expireProductionState(queued, 8_999)).toEqual(queued);
        expect(expireProductionState(queued, 9_000)).toMatchObject({ status: "failed", producedCount: 0 });
        const running = readProductionState({ workflowProduction: { ...productionMetadata("running", 5, 3, 2), updatedAt: 1_000 } });
        expect(expireProductionState(running, 720_999)).toEqual(running);
        expect(expireProductionState(running, 721_000)).toMatchObject({ status: "failed", producedCount: 5 });
    });

    test("fails closed when a real production response omits the batch count facts", async () => {
        const missing = readProductionState({ workflowProduction: { status: "running", producedCount: 1, batchId: "cup" } });
        expect(missing).toMatchObject({ status: "failed", errorMessage: WORKFLOW_COUNT_DATA_MISSING_MESSAGE });
        expect(isProductionStartBlocked(missing)).toBe(false);
        await expect(
            fetchProductionQuote("cup", "token", async () =>
                new Response(JSON.stringify({ ok: true, batchId: "cup", totalCount: 5, readyCount: 0, remainingCount: 5, estimatedUnitUsd: 0.06, estimatedTotalUsd: 0.3, estimatedMinutes: 39 }), { status: 200 }),
            ),
        ).rejects.toThrow(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
    });

    test("keeps the real failure reason ahead of a missing-count warning", () => {
        const state = readProductionState({
            workflowProduction: {
                status: "failed",
                producedCount: 1,
                batchId: "cup",
                errorMessage: "主图变量配置未通过：手持规则调用异常。",
            },
        });

        expect(state).toMatchObject({
            status: "failed",
            errorMessage: "主图变量配置未通过：手持规则调用异常。",
        });
        expect(isProductionStartBlocked(state)).toBe(false);
    });

    test("repairs stale count facts from the authoritative quote before restarting", () => {
        const stale = readProductionState({
            workflowProduction: {
                status: "failed",
                producedCount: 1,
                batchId: "cup",
                errorMessage: WORKFLOW_COUNT_DATA_MISSING_MESSAGE,
            },
        });
        const quote = {
            totalCount: 5,
            expectedConfigIds: configIds(3, 2),
        };

        const repaired = applyProductionQuote(stale, quote);
        const command = buildProductionCommand(repaired, "cup", "request-self-heal", 6_000);

        expect(command.state).toMatchObject({
            status: "queued",
            totalCount: 5,
            expectedConfigIds: configIds(3, 2),
            errorMessage: undefined,
        });
    });

    test("accepts only ordered batch-defined identifiers from 1+1 through 30+30", () => {
        expect(readExpectedImageSet(2, configIds(1, 1))).toMatchObject({ mainCount: 1, detailCount: 1, totalCount: 2 });
        expect(readExpectedImageSet(60, configIds(30, 30))).toMatchObject({ mainCount: 30, detailCount: 30, totalCount: 60 });
        expect(readExpectedImageSet(5, ["main_01", "main_03", "main_02", "detail_01", "detail_02"])).toBeUndefined();
        expect(readExpectedImageSet(5, ["main_01", "main_02", "main_03", "detail_01", "detail_01"])).toBeUndefined();
        expect(readExpectedImageSet(1, ["main_01"])).toBeUndefined();
    });
});
