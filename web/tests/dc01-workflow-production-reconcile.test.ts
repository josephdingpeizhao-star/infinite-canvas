import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    applyProductionStatusSummary,
    buildProductionStatusUrl,
    expireProductionState,
    failProductionStatusReconciliation,
    fetchProductionStatus,
    markProductionStatusReconciliationStarted,
    parseProductionStatusSummary,
    productionStatusReconcileThrottleKey,
    shouldReconcileProductionStatus,
    WORKFLOW_PRODUCTION_ORIGIN,
    WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE,
    WORKFLOW_PRODUCTION_RECONCILE_THROTTLE_MS,
    type WorkflowProductionStatusSummary,
} from "../src/lib/canvas/canvas-workflow-production";
import type { CanvasWorkflowProductionMetadata } from "../src/types/canvas";

const batchId = "杯子_20260821_112812";
const expectedConfigIds = ["main_01", "main_02", "detail_01"];

function summary(
    status: WorkflowProductionStatusSummary["status"] = "running",
    completedCount = 2,
    plannedCount: number | null = 3,
): WorkflowProductionStatusSummary {
    return {
        ok: true,
        batchId,
        status,
        currentStage: "renders",
        stageStartedAt: "2026-08-21T11:29:00",
        stageEndedAt: status === "running" ? null : "2026-08-21T11:30:00",
        renders: { completedCount, plannedCount },
        ...(status === "failed" ? { failureCode: "render_http_error", message: "图片服务返回 HTTP 524。" } : {}),
    };
}

function productionState(status: CanvasWorkflowProductionMetadata["status"] = "running"): CanvasWorkflowProductionMetadata {
    return {
        status,
        producedCount: 1,
        totalCount: 3,
        expectedConfigIds: [...expectedConfigIds],
        requestId: "request-1",
        batchId,
        requestedAt: 100,
        updatedAt: 200,
        step: "identity",
        message: "旧进度",
        errorMessage: "旧错误",
        failureSource: "image_service",
        recovery: { kind: "missing_reference", files: ["A.png"], recomputeEligible: true },
    };
}

describe("DC-01 workflow-production status contract", () => {
    test("builds the fixed encoded status endpoint and sends the agent token", async () => {
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            calls.push({ input: String(input), init });
            return new Response(JSON.stringify(summary()), { status: 200, headers: { "Content-Type": "application/json" } });
        }) as typeof fetch;

        expect(buildProductionStatusUrl(WORKFLOW_PRODUCTION_ORIGIN, batchId)).toBe(
            `${WORKFLOW_PRODUCTION_ORIGIN}/workflow-production/${encodeURIComponent(batchId)}/status`,
        );
        expect(await fetchProductionStatus(batchId, "  local-token  ", fetcher)).toEqual(summary());
        expect(calls).toEqual([
            {
                input: `${WORKFLOW_PRODUCTION_ORIGIN}/workflow-production/${encodeURIComponent(batchId)}/status`,
                init: { method: "GET", headers: { "X-Canvas-Agent-Token": "local-token" } },
            },
        ]);
    });

    test("validates all five backend statuses and rejects untrusted summaries", () => {
        for (const status of ["queued", "running", "paused", "completed", "failed"] as const) {
            const value = summary(status, status === "completed" ? 3 : 2);
            expect(parseProductionStatusSummary(value, batchId)).toEqual(value);
        }

        expect(parseProductionStatusSummary({ ...summary(), batchId: "other" }, batchId)).toBeUndefined();
        expect(parseProductionStatusSummary({ ...summary(), status: "idle" }, batchId)).toBeUndefined();
        expect(parseProductionStatusSummary({ ...summary(), currentStage: "../renders" }, batchId)).toBeUndefined();
        expect(parseProductionStatusSummary({ ...summary(), stageStartedAt: "not-a-timestamp" }, batchId)).toBeUndefined();
        expect(parseProductionStatusSummary({ ...summary(), renders: { completedCount: 4, plannedCount: 3 } }, batchId)).toBeUndefined();
        expect(parseProductionStatusSummary({ ...summary("failed"), message: "" }, batchId)).toBeUndefined();
    });

    test("fails closed on HTTP, JSON, token, and response-contract failures", async () => {
        const invalidJson = (async () => new Response("not json", { status: 200 })) as typeof fetch;
        const serverError = (async () => new Response(JSON.stringify({ message: "not trusted" }), { status: 404 })) as typeof fetch;
        const wrongBatch = (async () => new Response(JSON.stringify({ ...summary(), batchId: "other" }), { status: 200 })) as typeof fetch;

        await expect(fetchProductionStatus(batchId, "", invalidJson)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
        await expect(fetchProductionStatus(batchId, "token", invalidJson)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
        await expect(fetchProductionStatus(batchId, "token", serverError)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
        await expect(fetchProductionStatus(batchId, "token", wrongBatch)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
    });
});

describe("DC-01 workflow-production metadata reconciliation", () => {
    test("maps every status while preserving the trusted card contract", () => {
        for (const status of ["queued", "running", "paused", "completed", "failed"] as const) {
            const completedCount = status === "completed" ? 3 : 2;
            const result = applyProductionStatusSummary(productionState(), summary(status, completedCount, null), 500);

            expect(result).toEqual({
                ...productionState(),
                status,
                producedCount: completedCount,
                totalCount: 3,
                expectedConfigIds,
                requestedAt: undefined,
                updatedAt: 500,
                step: "renders",
                message: undefined,
                errorMessage: status === "failed" ? "图片服务返回 HTTP 524。" : undefined,
                failureSource: status === "failed" ? "image_service" : undefined,
                recovery: undefined,
            });
            expect(result?.requestId).toBe("request-1");
        }
    });

    test("preserves total count when plannedCount is null and rejects conflicting progress", () => {
        expect(applyProductionStatusSummary(productionState(), summary("running", 2, null), 600)?.totalCount).toBe(3);
        expect(applyProductionStatusSummary(productionState(), summary("running", 2, 4), 600)).toBeUndefined();
        expect(applyProductionStatusSummary(productionState(), summary("running", 4, null), 600)).toBeUndefined();
        expect(applyProductionStatusSummary(productionState(), summary("completed", 2, 3), 600)).toBeUndefined();
        expect(applyProductionStatusSummary({ ...productionState(), batchId: "other" }, summary(), 600)).toBeUndefined();
    });

    test("keeps a truthful failure message without misclassifying an unknown failure code", () => {
        const unknownFailure = { ...summary("failed"), failureCode: "workflow_contract_error", message: "工作流契约校验失败。" };
        const result = applyProductionStatusSummary(productionState(), unknownFailure, 700);

        expect(result?.errorMessage).toBe("工作流契约校验失败。");
        expect(result?.failureSource).toBeUndefined();
    });

    test("anchors the per-card throttle at 30 seconds with the exact boundary", () => {
        expect(WORKFLOW_PRODUCTION_RECONCILE_THROTTLE_MS).toBe(30_000);
        expect(shouldReconcileProductionStatus(1_000, 30_999)).toBe(false);
        expect(shouldReconcileProductionStatus(1_000, 31_000)).toBe(true);
        expect(shouldReconcileProductionStatus(undefined, 1_000)).toBe(true);
        expect(productionStatusReconcileThrottleKey("project", "machine-a", "card", batchId)).not.toBe(
            productionStatusReconcileThrottleKey("project", "machine-b", "card", batchId),
        );
    });

    test("refresh keeps running and only an active reconciliation failure unlocks the card", () => {
        const state = productionState("running");

        expect(markProductionStatusReconciliationStarted(state, 800)).toEqual({ ...state, updatedAt: 800 });
        const markedQueued = markProductionStatusReconciliationStarted({ ...state, status: "queued" }, 800);
        expect(markedQueued).toEqual({ ...state, status: "queued", requestedAt: undefined, updatedAt: 800 });
        expect(expireProductionState(markedQueued, 8_800, true)).toBe(markedQueued);

        const failed = failProductionStatusReconciliation(state, 900);
        expect(failed.status).toBe("failed");
        expect(failed.errorMessage).toBe("页面重新打开后暂时无法确认制作状态，请稍后刷新重试；后台制作（若在进行）不受影响。");
        expect(failed.errorMessage).toBe(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
        const paused = { ...state, status: "paused" as const };
        expect(failProductionStatusReconciliation(paused, 900)).toBe(paused);
    });
});

describe("DC-01 project reconciliation wiring", () => {
    test("uses only page load and disconnected-to-connected as reconciliation triggers", () => {
        const source = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

        expect(source.match(/reconcileWorkflowProductions\(\);/g)).toHaveLength(2);
        expect(source).toContain("if (!projectLoaded || restoredProjectIdRef.current !== projectId) return;\n        reconcileWorkflowProductions();");
        expect(source).toContain("const wasConnected = previousLocalAgentConnectedRef.current;");
        expect(source).toContain("previousLocalAgentConnectedRef.current = localAgentConnected;");
        expect(source).toContain("wasConnected || !localAgentConnected");
        expect(source).toContain(
            "resetInterruptedBatchIntakes(\n                        resetInterruptedWorkflowDemos(resetInterruptedGeneration(project.nodes)),\n                    )",
        );
    });

    test("filters real queued/running targets, records throttle before GET, and guards stale responses", () => {
        const source = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const throttleWrite = source.indexOf("productionStatusRequestedAtRef.current.set(throttleKey, requestedAt);");
        const fetchStart = source.indexOf("fetchProductionStatus(candidate.selection.batchId, token)");

        expect(source).toContain("node.type !== CanvasNodeType.Workflow");
        expect(source).toContain("!isProductionStartBlocked(state) || !state.batchId");
        expect(source).toContain('selection.mode !== "production" || selection.batchId !== state.batchId');
        expect(source).toContain("productionStatusReconcileThrottleKey(projectId, node.id, selection.cardId, selection.batchId)");
        expect(throttleWrite).toBeGreaterThan(-1);
        expect(fetchStart).toBeGreaterThan(throttleWrite);
        expect(source).toContain("node.metadata?.workflowProduction !== reconciliationState");
        expect(source).toContain("nextState ?? failProductionStatusReconciliation(state, completedAt)");
        expect(source).toContain(".catch(() => finishReconciliation())");
    });
});
