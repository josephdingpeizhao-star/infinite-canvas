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
    resolveProductionSelection,
    WORKFLOW_COUNT_DATA_MISSING_MESSAGE,
    WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS,
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
        expect(isProductionStartBlocked(first.state)).toBe(true);
        const partial = readProductionState({ workflowProduction: productionMetadata("paused", 1, 3, 2) });
        expect(buildProductionCommand(partial, "cup", "request-002", 2_000).content).toContain("retry: renders");
    });

    test("reads trusted production observations for the card and drops malformed values", () => {
        const trusted = readProductionState({
            workflowProduction: {
                ...productionMetadata("running", 0, 3, 2),
                angleInventorySummary: {
                    uploaded_count: 2,
                    qualified: [{ source_asset_id: "img_001", file_name: "front.jpg", angle_slot: "D" }],
                    rejected: [{ source_asset_id: "img_002", file_name: "bottom.jpg" }],
                    missing_angle_slots: ["A", "B", "C"],
                    single_source_production: true,
                },
                bindingDistribution: { bound_reference_counts: { "front.jpg": 5 } },
            },
        });
        expect(trusted.angleInventorySummary?.qualified[0]?.angle_slot).toBe("D");
        expect(trusted.bindingDistribution?.bound_reference_counts).toEqual({ "front.jpg": 5 });

        const malformed = readProductionState({
            workflowProduction: {
                ...productionMetadata("running", 0, 3, 2),
                angleInventorySummary: { uploaded_count: -1 },
                bindingDistribution: { bound_reference_counts: { "front.jpg": 0 } },
            },
        });
        expect(malformed.angleInventorySummary).toBeUndefined();
        expect(malformed.bindingDistribution).toBeUndefined();
    });

    test("continues a paused render gate that has not produced an image", () => {
        const paused = readProductionState({ workflowProduction: productionMetadata("paused", 0, 3, 2) });
        expect(buildProductionCommand(paused, "cup", "request-paused-empty", 2_100).content.split("\n").at(-1)).toBe("run: next");
    });

    test("continues a failed run that has not produced an image", () => {
        const failed = readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) });
        expect(buildProductionCommand(failed, "cup", "request-failed-empty", 2_200).content.split("\n").at(-1)).toBe("run: next");
    });

    test("keeps render retry semantics after a paused run has produced an image", () => {
        const paused = readProductionState({ workflowProduction: productionMetadata("paused", 1, 3, 2) });
        expect(buildProductionCommand(paused, "cup", "request-paused-produced", 2_300).content.split("\n").at(-1)).toBe("retry: renders");
    });

    test("keeps zero-remaining quote priority for an empty paused run", () => {
        const paused = readProductionState({ workflowProduction: productionMetadata("paused", 0, 3, 2) });
        expect(buildProductionCommand(paused, "cup", "request-paused-complete", 2_400, undefined, { remainingCount: 0 }).content.split("\n").at(-1)).toBe("run: next");
    });

    test("allows independent repeated commands from the same terminal machine state and batch", () => {
        const failed = readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) });
        const first = buildProductionCommand(failed, "cup", "request-first", 1_000);
        const second = buildProductionCommand(failed, "cup", "request-second", 2_000);

        expect(first.state).toMatchObject({ status: "queued", batchId: "cup", requestId: "request-first" });
        expect(second.state).toMatchObject({ status: "queued", batchId: "cup", requestId: "request-second" });
        expect(first.content).not.toBe(second.content);
        expect(failed).toMatchObject({ status: "failed", batchId: "cup" });
        expect(isProductionStartBlocked(failed)).toBe(false);
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

    test("blocks starts only while production is queued or running", () => {
        expect(isProductionStartBlocked(readProductionState())).toBe(false);
        for (const status of ["failed", "completed", "paused"] as const) {
            expect(isProductionStartBlocked(readProductionState({ workflowProduction: productionMetadata(status, 0) }))).toBe(false);
        }
        for (const status of ["queued", "running"] as const) {
            expect(isProductionStartBlocked(readProductionState({ workflowProduction: productionMetadata(status, 0) }))).toBe(true);
        }
    });

    test("expires only an unacknowledged command and preserves finished images", () => {
        const queued = buildProductionCommand(readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) }), "cup", "request-001", 1_000).state;
        expect(expireProductionState(queued, 8_999)).toEqual(queued);
        expect(expireProductionState(queued, 9_000)).toMatchObject({ status: "failed", producedCount: 0 });
        const running = readProductionState({ workflowProduction: { ...productionMetadata("running", 5, 3, 2), updatedAt: 1_000 } });
        expect(WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS).toBe(22 * 60_000);
        expect(expireProductionState(running, 1_000 + 21 * 60_000)).toEqual(running);
        expect(expireProductionState(running, 1_000 + 22 * 60_000)).toMatchObject({ status: "failed", producedCount: 5 });
    });

    test("allows resubmission after an unacknowledged queued command times out", () => {
        const queued = buildProductionCommand(readProductionState({ workflowProduction: productionMetadata("failed", 0, 3, 2) }), "cup", "request-timeout", 1_000).state;
        const failed = expireProductionState(queued, 9_000);
        expect(failed).toMatchObject({ status: "failed", requestId: "request-timeout" });
        expect(isProductionStartBlocked(failed)).toBe(false);

        const resubmitted = buildProductionCommand(failed, "cup", "request-resubmitted", 9_001);
        expect(resubmitted.state).toMatchObject({ status: "queued", requestId: "request-resubmitted" });
        expect(isProductionStartBlocked(resubmitted.state)).toBe(true);
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

    test("uses verified remaining renders without overriding existing command priorities", () => {
        const failed = readProductionState({ workflowProduction: productionMetadata("failed", 5, 3, 2) });
        const zeroRemaining = buildProductionCommand(failed, "cup", "request-zero-remaining", 7_000, undefined, { remainingCount: 0 });
        expect(zeroRemaining.content.split("\n").at(-1)).toBe("run: next");
        expect(zeroRemaining.content).not.toContain("retry: renders");

        const partialFailure = readProductionState({ workflowProduction: productionMetadata("failed", 4, 3, 2) });
        expect(buildProductionCommand(partialFailure, "cup", "request-renders-remain", 8_000, undefined, { remainingCount: 1 }).content.split("\n").at(-1)).toBe("retry: renders");

        const paused = readProductionState({ workflowProduction: productionMetadata("paused", 5, 3, 2) });
        expect(buildProductionCommand(paused, "cup", "request-paused-zero", 9_000, undefined, { remainingCount: 0 }).content.split("\n").at(-1)).toBe("run: next");

        expect(buildProductionCommand(failed, "cup", "request-without-quote", 10_000).content.split("\n").at(-1)).toBe("retry: renders");
        expect(buildProductionCommand(failed, "cup", "request-explicit", 11_000, "retry: qc", { remainingCount: 0 }).content.split("\n").at(-1)).toBe("retry: qc");
    });
});

import {
    REBIND_RECOMPUTE_ACTION_LABEL,
    buildProductionRebindUrl,
    fetchProductionRebind,
    isRebindRecomputeVisible,
    productionActionLabel,
    rebindBeforeQuoteIfEligible,
} from "../src/lib/canvas/canvas-workflow-production";

describe("RB-01 white-background recovery", () => {
    const eligibleRecovery = {
        kind: "missing_reference" as const,
        files: ["正面图_01.jpg"],
        recomputeEligible: true,
    };

    test("reads recovery metadata only when the complete nested shape is trustworthy", () => {
        const valid = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), recovery: eligibleRecovery } });
        expect(valid.recovery).toEqual(eligibleRecovery);

        for (const recovery of [
            { ...eligibleRecovery, kind: "other" },
            { ...eligibleRecovery, recomputeEligible: "yes" },
            { ...eligibleRecovery, files: ["../正面图.jpg"] },
            { ...eligibleRecovery, files: ["token-secret.jpg"] },
            { ...eligibleRecovery, files: ["a".repeat(81)] },
            { ...eligibleRecovery, files: ["正面图.jpg", "正面图.jpg"] },
            { ...eligibleRecovery, extra: true },
            { kind: "inputs_unavailable", files: [], recomputeEligible: true },
            { kind: "inputs_unavailable", files: ["正面图.jpg"], recomputeEligible: false },
        ]) {
            const state = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), recovery } });
            expect(state.recovery).toBeUndefined();
        }
        expect(readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), recovery: { kind: "inputs_unavailable", files: [], recomputeEligible: false } } }).recovery).toEqual({
            kind: "inputs_unavailable",
            files: [],
            recomputeEligible: false,
        });
    });

    test("shows the rebind action only for an eligible failed machine", () => {
        const eligible = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), recovery: eligibleRecovery } });
        expect(isRebindRecomputeVisible(eligible)).toBe(true);
        expect(productionActionLabel(eligible)).toBe(REBIND_RECOMPUTE_ACTION_LABEL);
        expect(REBIND_RECOMPUTE_ACTION_LABEL).toBe("剔除缺失图并重新分配");

        for (const state of [
            readProductionState({ workflowProduction: { ...productionMetadata("running", 0), recovery: eligibleRecovery } }),
            readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), recovery: { ...eligibleRecovery, recomputeEligible: false } } }),
            readProductionState({ workflowProduction: productionMetadata("failed", 0) }),
        ]) {
            expect(isRebindRecomputeVisible(state)).toBe(false);
            expect(productionActionLabel(state)).not.toBe(REBIND_RECOMPUTE_ACTION_LABEL);
        }
    });

    test("keeps an ordinary failed primary click byte-for-byte on the old quote path and sends no POST", async () => {
        const state = readProductionState({ workflowProduction: { ...productionMetadata("failed", 2), recovery: { ...eligibleRecovery, recomputeEligible: false } } });
        const methods: string[] = [];
        const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
            methods.push(init?.method || "GET");
            return new Response(
                JSON.stringify({
                    ok: true,
                    batchId: "cup",
                    totalCount: 5,
                    expectedConfigIds: configIds(3, 2),
                    readyCount: 2,
                    remainingCount: 3,
                    estimatedUnitUsd: 0.06,
                    estimatedTotalUsd: 0.18,
                    estimatedMinutes: 24,
                }),
                { status: 200 },
            );
        };

        expect(productionActionLabel(state)).toBe("重新开始");
        expect(await rebindBeforeQuoteIfEligible(state, "cup", "token", fetcher)).toBeUndefined();
        const quote = await fetchProductionQuote("cup", "token", fetcher);
        expect(methods).toEqual(["GET"]);
        expect(quote.remainingCount).toBe(3);
        expect(buildProductionCommand(state, "cup", "request-old-path", 12_000, undefined, quote).content.split("\n").at(-1)).toBe("retry: renders");
    });

    test("posts the eligible action to the fixed loopback endpoint before quoting", async () => {
        const state = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), batchId: "杯子 01", recovery: eligibleRecovery } });
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(input), init });
            return new Response(
                JSON.stringify({
                    ok: true,
                    batchId: "杯子 01",
                    missing: ["正面图_01.jpg"],
                    remainingCount: 2,
                    superseded: ["angle_inventory", "final_prompts"],
                    supersededDir: "artifacts/_superseded/20260802T120000Z_1234abcd",
                    message: "已剔除缺失白底图，请确认新报价。",
                }),
                { status: 200 },
            );
        };

        expect(buildProductionRebindUrl("http://127.0.0.1:17373", "杯子 01")).toBe("http://127.0.0.1:17373/workflow-production/%E6%9D%AF%E5%AD%90%2001/rebind-recompute");
        const result = await rebindBeforeQuoteIfEligible(state, "杯子 01", " token ", fetcher);
        expect(result).toMatchObject({ batchId: "杯子 01", remainingCount: 2, superseded: ["angle_inventory", "final_prompts"] });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("http://127.0.0.1:17373/workflow-production/%E6%9D%AF%E5%AD%90%2001/rebind-recompute");
        expect(calls[0]?.init).toMatchObject({ method: "POST", body: "{}", headers: { "Content-Type": "application/json", "X-Canvas-Agent-Token": "token" } });
    });

    test("passes through safe refusal copy and rejects an untrusted success response", async () => {
        await expect(
            fetchProductionRebind(
                "cup",
                "token",
                async () => new Response(JSON.stringify({ ok: false, error: "render_outputs_exist", message: "本批已有 2 张成图，不能整体重排。请恢复缺失文件后重新开始。" }), { status: 409 }),
            ),
        ).rejects.toThrow("本批已有 2 张成图，不能整体重排。请恢复缺失文件后重新开始。");

        await expect(
            fetchProductionRebind(
                "cup",
                "token",
                async () => new Response(JSON.stringify({ ok: true, batchId: "cup", missing: ["../secret.jpg"], remainingCount: 1, superseded: [], supersededDir: "artifacts/_superseded/20260802T120000Z_1234abcd" }), { status: 200 }),
            ),
        ).rejects.toThrow("本机真实制作服务没有返回可信的重新分配结果，本次没有开始。");
    });
});

import { isSameProductionTarget, shouldRebindBeforeQuote } from "../src/lib/canvas/canvas-workflow-production";

describe("RB-01 recovery target and async guardrails", () => {
    const recovery = {
        kind: "missing_reference" as const,
        files: ["正面图.jpg"],
        recomputeEligible: true,
    };

    test("does not show or post a stale recovery from a different batch", async () => {
        const state = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), batchId: "old-batch", recovery } });
        let requests = 0;
        const fetcher = async () => {
            requests += 1;
            return new Response("{}", { status: 500 });
        };

        expect(productionActionLabel(state, "current-batch")).toBe("重新开始");
        expect(isRebindRecomputeVisible(state, "current-batch")).toBe(false);
        expect(shouldRebindBeforeQuote(state, "current-batch")).toBe(false);
        expect(await rebindBeforeQuoteIfEligible(state, "current-batch", "token", fetcher)).toBeUndefined();
        expect(requests).toBe(0);
    });

    test("never posts rebind for an explicit closed command", async () => {
        const state = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), batchId: "cup", recovery } });
        let requests = 0;
        const fetcher = async () => {
            requests += 1;
            return new Response("{}", { status: 500 });
        };

        expect(shouldRebindBeforeQuote(state, "cup", "retry: qc")).toBe(false);
        expect(await rebindBeforeQuoteIfEligible(state, "cup", "token", fetcher, "retry: qc")).toBeUndefined();
        expect(requests).toBe(0);
        expect(buildProductionCommand(state, "cup", "request-explicit-guard", 13_000, "retry: qc", { remainingCount: 0 }).content.split("\n").at(-1)).toBe("retry: qc");
    });

    test("accepts an async result only while card and batch still identify the same target", () => {
        const expected = { mode: "production" as const, cardId: "card-a", batchId: "cup", materialCount: 2 };
        expect(isSameProductionTarget(expected, { ...expected, materialCount: 3 })).toBe(true);
        expect(isSameProductionTarget(expected, { ...expected, cardId: "card-b" })).toBe(false);
        expect(isSameProductionTarget(expected, { ...expected, batchId: "plate" })).toBe(false);
        expect(isSameProductionTarget(expected, { mode: "error", message: "连线已变化" })).toBe(false);
    });

    test("rejects path-bearing refusal messages but keeps the approved inputs guidance", async () => {
        const generic = "白底图重新分配请求未被本机工作台接受，本次没有开始。";
        for (const message of [
            "失败位置 C:\\Users\\John\\config.txt",
            "失败位置 \\\\server\\share\\config.txt",
            "失败位置 /home/john/config.txt",
            "失败位置：/home/john/config.txt",
            "失败位置 ../config.txt",
            "失败位置：../config.txt",
            "失败位置 .\\config.txt",
        ]) {
            await expect(
                fetchProductionRebind("cup", "token", async () => new Response(JSON.stringify({ ok: false, error: "inputs_unavailable", message }), { status: 409 })),
            ).rejects.toThrow(generic);
        }

        const approved = "白底图目录整体无法访问，本次已停止。请恢复 inputs/white_bg 后再重新开始。";
        await expect(
            fetchProductionRebind("cup", "token", async () => new Response(JSON.stringify({ ok: false, error: "inputs_unavailable", message: approved }), { status: 409 })),
        ).rejects.toThrow(approved);
    });
});

describe("RB-01 sensitive token parity", () => {
    test("fails closed for every newly aligned sensitive filename token", () => {
        for (const file of ["password.txt", "authorization.txt", "sk-.jpg"]) {
            const state = readProductionState({
                workflowProduction: {
                    ...productionMetadata("failed", 0),
                    recovery: { kind: "missing_reference", files: [file], recomputeEligible: true },
                },
            });
            expect(state.recovery).toBeUndefined();
        }
    });

    test("degrades refusal copy containing aligned sensitive tokens to the generic message", async () => {
        const generic = "白底图重新分配请求未被本机工作台接受，本次没有开始。";
        for (const message of ["缺失 password.txt", "缺失 authorization.txt", "缺失 sk-.jpg"]) {
            await expect(
                fetchProductionRebind("cup", "token", async () => new Response(JSON.stringify({ ok: false, error: "inputs_unavailable", message }), { status: 409 })),
            ).rejects.toThrow(generic);
        }
    });
});

import {
    IMAGE_SERVICE_FAILURE_ACTION_LABEL,
    productionFailureStatusText,
} from "../src/lib/canvas/canvas-workflow-production";

describe("ER-02f image-service failure attribution", () => {
    const fallbackText = "这一步没做好，机器已停下。已经完成的成果都保留了。";
    const sourceText = "本次异常来自图片服务，不是工作流的问题。";
    const retryText = "待服务恢复后点下方按钮再试一次，费用会重新报价并需你亲手确认。";

    test("accepts only the exact image_service failure source", () => {
        const withoutSource = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), errorMessage: "图片生成失败。" } });
        expect(withoutSource.failureSource).toBeUndefined();
        expect(productionActionLabel(withoutSource)).toBe("重新开始");
        expect(productionFailureStatusText(withoutSource.errorMessage, withoutSource.failureSource)).toBe("图片生成失败。");

        for (const failureSource of [null, 0, false, "other", "IMAGE_SERVICE", "image_service ", {}]) {
            const state = readProductionState({
                workflowProduction: { ...productionMetadata("failed", 0), errorMessage: "图片生成失败。", failureSource } as never,
            });
            expect(state.failureSource).toBeUndefined();
            expect(productionActionLabel(state)).toBe("重新开始");
            expect(productionFailureStatusText(state.errorMessage, state.failureSource)).toBe("图片生成失败。");
        }

        const attributed = readProductionState({ workflowProduction: { ...productionMetadata("failed", 0), errorMessage: "图片生成失败。", failureSource: "image_service" } });
        expect(attributed.failureSource).toBe("image_service");
        expect(productionActionLabel(attributed)).toBe(IMAGE_SERVICE_FAILURE_ACTION_LABEL);
        expect(IMAGE_SERVICE_FAILURE_ACTION_LABEL).toBe("再次尝试");
        expect(productionFailureStatusText(attributed.errorMessage, attributed.failureSource)).toBe(`图片生成失败。 ${sourceText} ${retryText}`);
    });

    test("does not change non-failed labels or completed status copy", () => {
        const cases = [
            ["queued", "等待接单"],
            ["running", "真实制作中"],
            ["paused", "继续制作"],
            ["completed", COMPLETED_PRODUCTION_ACTION_LABEL],
        ] as const;
        for (const [status, label] of cases) {
            const state = readProductionState({ workflowProduction: { ...productionMetadata(status, status === "completed" ? 5 : 0, 3, 2), failureSource: "image_service" } });
            expect(state.failureSource).toBe("image_service");
            expect(productionActionLabel(state)).toBe(label);
        }
        expect(completedProductionStatusText("后端完成文案。", 5)).toBe("后端完成文案。");
        expect(completedProductionStatusText(undefined, 5)).toBe("5 张真实图片已上桌。点击继续后，机器会按当前批次状态处理下一步。");
    });

    test("keeps RB-01 action priority over image-service attribution", () => {
        const state = readProductionState({
            workflowProduction: {
                ...productionMetadata("failed", 0),
                recovery: { kind: "missing_reference", files: ["正面图.jpg"], recomputeEligible: true },
            },
        });
        expect(state.failureSource).toBeUndefined();
        expect(productionActionLabel(state)).toBe(REBIND_RECOMPUTE_ACTION_LABEL);
    });

    test("keeps production command content byte-for-byte identical", () => {
        const plain = readProductionState({ workflowProduction: productionMetadata("failed", 2, 3, 2) });
        const attributed = readProductionState({ workflowProduction: { ...productionMetadata("failed", 2, 3, 2), failureSource: "image_service" } });
        expect(buildProductionCommand(attributed, "cup", "request-same", 14_000).content).toBe(buildProductionCommand(plain, "cup", "request-same", 14_000).content);
    });

    test("appends attribution after the existing error or fallback only when confirmed", () => {
        expect(productionFailureStatusText(undefined, "image_service")).toBe(`${fallbackText} ${sourceText} ${retryText}`);
        expect(productionFailureStatusText(undefined, undefined)).toBe(fallbackText);
        expect(productionFailureStatusText("服务返回失败。", undefined)).toBe("服务返回失败。");
    });
});
