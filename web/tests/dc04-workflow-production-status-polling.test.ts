import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    applyPolledProductionStatusSummary,
    expireProductionState,
    fetchProductionStatus,
    shouldPollProductionStatus,
    WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS,
    WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE,
    WORKFLOW_PRODUCTION_STATUS_POLL_INTERVAL_MS,
    type WorkflowProductionStatusSummary,
} from "../src/lib/canvas/canvas-workflow-production";
import type { CanvasWorkflowProductionMetadata } from "../src/types/canvas";

const batchId = "杯子_20260821_112812";
const expectedConfigIds = ["main_01", "main_02", "detail_01"];
const canvasLinkLostMessage = "画布连接中断超过 120 秒并停止等待；已完成成果全部保留；重新打开画布页面后点「重新开始」从断点继续；已出图不会重复扣费。";

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

function summary(
    status: WorkflowProductionStatusSummary["status"] = "running",
    completedCount = 2,
): WorkflowProductionStatusSummary {
    return {
        ok: true,
        batchId,
        status,
        currentStage: "renders",
        stageStartedAt: "2026-08-21T11:29:00",
        stageEndedAt: status === "running" ? null : "2026-08-21T11:30:00",
        renders: { completedCount, plannedCount: 3 },
        ...(status === "failed" ? { failureCode: "canvas_link_lost", message: canvasLinkLostMessage } : {}),
    };
}

describe("DC-04 production-status polling eligibility", () => {
    test("polls only a running production with a batch id", () => {
        expect(shouldPollProductionStatus(productionState("running"))).toBe(true);
        expect(shouldPollProductionStatus({ ...productionState("running"), batchId: undefined })).toBe(false);
    });

    test("never polls idle, queued, paused, completed, or failed productions", () => {
        for (const status of ["idle", "queued", "paused", "completed", "failed"] as const) {
            expect(shouldPollProductionStatus(productionState(status))).toBe(false);
        }
    });
});

describe("DC-04 forward-only polled status application", () => {
    test("drops late responses after the local state leaves running", () => {
        for (const status of ["queued", "failed", "completed"] as const) {
            expect(applyPolledProductionStatusSummary(productionState(status), summary(), 500, "request-1")).toBeUndefined();
        }
    });

    test("drops a queued summary instead of moving a running card backward", () => {
        expect(applyPolledProductionStatusSummary(productionState(), summary("queued"), 500, "request-1")).toBeUndefined();
    });

    test("drops a prior request generation and applies the matching generation", () => {
        expect(applyPolledProductionStatusSummary(productionState(), summary(), 500, "request-0")).toBeUndefined();

        const result = applyPolledProductionStatusSummary(productionState(), summary(), 500, "request-1");
        expect(result?.producedCount).toBe(2);
    });

    test("advances authoritative running progress and refreshes the watchdog timestamp", () => {
        const result = applyPolledProductionStatusSummary(productionState(), summary("running", 2), 500, "request-1");

        expect(result?.status).toBe("running");
        expect(result?.producedCount).toBe(2);
        expect(result?.updatedAt).toBe(500);
        expect(result?.step).toBe("renders");
    });

    test("polling carries the latest nonblocking inventory notice into the card", () => {
        const observed: WorkflowProductionStatusSummary = {
            ...summary("running", 2),
            angleInventorySummary: {
                uploaded_count: 2,
                qualified: [{ source_asset_id: "img_001", file_name: "front.jpg", angle_slot: "D" }],
                rejected: [{ source_asset_id: "img_002", file_name: "bottom.jpg" }],
                missing_angle_slots: ["A", "B", "C"],
                single_source_production: true,
            },
        };
        const result = applyPolledProductionStatusSummary(productionState(), observed, 525, "request-1");

        expect(result?.angleInventorySummary?.rejected).toEqual([{ source_asset_id: "img_002", file_name: "bottom.jpg" }]);
        expect(result?.status).toBe("running");
    });

    test("preserves only the local running message while applying authoritative progress", () => {
        const result = applyPolledProductionStatusSummary(productionState(), summary("running", 2), 550, "request-1");

        expect(result?.message).toBe("旧进度");
        expect(result?.producedCount).toBe(2);
        expect(result?.updatedAt).toBe(550);
        expect(result?.step).toBe("renders");
    });

    test("shows canvas_link_lost truth without image-service attribution", () => {
        const result = applyPolledProductionStatusSummary(productionState(), summary("failed", 2), 600, "request-1");

        expect(result?.status).toBe("failed");
        expect(result?.errorMessage).toBe(canvasLinkLostMessage);
        expect(result?.failureSource).toBeUndefined();
    });

    test("does not preserve the stale running message across terminal transitions", () => {
        const state = productionState();
        const completed = applyPolledProductionStatusSummary(state, summary("completed", 3), 650, "request-1");
        const failed = applyPolledProductionStatusSummary(state, summary("failed", 2), 651, "request-1");

        expect(completed?.message).not.toBe(state.message);
        expect(completed?.message).toBeUndefined();
        expect(failed?.message).not.toBe(state.message);
        expect(failed?.errorMessage).toBe(canvasLinkLostMessage);
    });

    test("inherits the authoritative batch-id guard", () => {
        expect(applyPolledProductionStatusSummary({ ...productionState(), batchId: "other" }, summary(), 700, "request-1")).toBeUndefined();
    });
});

describe("DC-04 polling and watchdog interaction", () => {
    test("a successful poll postpones the unchanged fallback by exactly twenty-two minutes", () => {
        const appliedAt = 1_000_000;
        const refreshed = applyPolledProductionStatusSummary(productionState(), summary(), appliedAt, "request-1")!;

        expect(WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS).toBe(22 * 60_000);
        expect(expireProductionState(refreshed, appliedAt + WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS - 1, true)).toBe(refreshed);
        const expired = expireProductionState(refreshed, appliedAt + WORKFLOW_PRODUCTION_PROGRESS_TIMEOUT_MS, true);
        expect(expired.status).toBe("failed");
        expect(expired.errorMessage).toBe("本机真实制作服务已中断，已经完成的成果都保留了。");
    });
});

describe("DC-04 status fetch contract", () => {
    test("throws for both non-2xx and untrusted polling responses", async () => {
        const serverError = (async () => new Response(JSON.stringify(summary()), { status: 503 })) as typeof fetch;
        const invalidSummary = (async () => new Response(JSON.stringify({ ...summary(), status: "idle" }), { status: 200 })) as typeof fetch;

        await expect(fetchProductionStatus(batchId, "token", serverError)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
        await expect(fetchProductionStatus(batchId, "token", invalidSummary)).rejects.toThrow(WORKFLOW_PRODUCTION_RECONCILE_FAILURE_MESSAGE);
    });
});

describe("DC-04 polling wiring", () => {
    test("uses a semantic thirty-second interval, live token, and per-node batch single flight", () => {
        const source = readFileSync(new URL("../src/pages/canvas/use-canvas-workflow-production-status-polling.ts", import.meta.url), "utf8");
        const add = source.indexOf("inFlight.current.add(key);");
        const fetchStart = source.indexOf("fetchProductionStatus(batchId, token)");
        const release = source.indexOf(".finally(() => inFlight.current.delete(key))");

        expect(WORKFLOW_PRODUCTION_STATUS_POLL_INTERVAL_MS).toBe(30_000);
        expect(source).toContain("useAgentStore.getState().token");
        expect(source).toContain("JSON.stringify([node.id, batchId])");
        expect(source).toContain("inFlight.current.has(key)");
        expect(add).toBeGreaterThan(-1);
        expect(fetchStart).toBeGreaterThan(add);
        expect(release).toBeGreaterThan(fetchStart);
        expect(source).toContain("globalThis.setInterval(tick, WORKFLOW_PRODUCTION_STATUS_POLL_INTERVAL_MS)");
        expect(source).toContain("globalThis.clearInterval(handle)");
    });

    test("delegates latest-state merging, keeps fetch failures silent, and is wired once", () => {
        const source = readFileSync(new URL("../src/pages/canvas/use-canvas-workflow-production-status-polling.ts", import.meta.url), "utf8");
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const generationCapture = source.indexOf("const polledRequestId = state.requestId;");
        const fetchStart = source.indexOf("fetchProductionStatus(batchId, token)");

        expect(source).toContain("const currentState = readProductionState(currentNode.metadata);");
        expect(source).toContain("applyPolledProductionStatusSummary(currentState, summary, Date.now(), polledRequestId)");
        expect(generationCapture).toBeGreaterThan(-1);
        expect(fetchStart).toBeGreaterThan(generationCapture);
        expect(source).toContain(".catch(() => {})");
        expect(source).not.toContain("failProductionStatusReconciliation");
        expect(projectSource.match(/useCanvasWorkflowProductionStatusPolling\(\{ nodesRef, setNodes \}\);/g)).toHaveLength(1);
    });
});
