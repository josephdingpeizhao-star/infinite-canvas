import { describe, expect, test } from "bun:test";

import { applyQcSummaryToNodes, buildQcSummaryUrl, buildRepairedProjectionRequest, fetchWorkflowQcSummary, qcBadgeView, qcSummaryNeedsApplication, repairedProjectionCanStart, type WorkflowQcSummary } from "../src/lib/canvas/canvas-workflow-delivery";
import { importProductionOutput } from "../src/lib/canvas/canvas-workflow-output-import";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const CONFIG_IDS = [...Array.from({ length: 6 }, (_, index) => `main_${String(index + 1).padStart(2, "0")}`), ...Array.from({ length: 8 }, (_, index) => `detail_${String(index + 1).padStart(2, "0")}`)];
const SHA = "a".repeat(64);
const summary: WorkflowQcSummary = {
    ok: true,
    batchId: "cup",
    reportSha256: "b".repeat(64),
    images: CONFIG_IDS.map((configId) => ({ configId, status: configId === "main_01" ? "fail" : configId === "detail_03" ? "needs_review" : "pass", issueCount: configId === "main_01" ? 2 : 0, topCategories: configId === "main_01" ? ["text"] : [] })),
};

function output(source: "renders" | "repaired" | undefined, configId = "main_01"): CanvasNodeData {
    return {
        id: `node:${source || "legacy"}:${configId}`,
        type: CanvasNodeType.Image,
        title: "image",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: {
            content: "blob:image",
            storageKey: "image:ready",
            workflowProductionOutput: { workflowNodeId: "machine", batchId: "cup", configId, index: 1, source, sha256: SHA, byteCount: 3, downloadUrl: `http://127.0.0.1:17373/workflow-production/cup/outputs/${source}/${configId}` },
        },
    };
}

describe("workflow delivery badges and repaired projection", () => {
    test("builds only the loopback QC summary route", () => {
        expect(buildQcSummaryUrl("http://127.0.0.1:17373/", "杯子_1")).toContain("%E6%9D%AF%E5%AD%90_1/qc-summary");
        expect(buildQcSummaryUrl("https://example.com/", "cup")).toBeNull();
    });

    test("fetches one safe QC summary with the canvas token", async () => {
        let header = "";
        const result = await fetchWorkflowQcSummary("cup", " token ", async (_input, init) => {
            header = new Headers(init?.headers).get("x-canvas-agent-token") || "";
            return new Response(JSON.stringify(summary), { status: 200 });
        });
        expect(result?.images).toHaveLength(14);
        expect(header).toBe("token");
    });

    test("treats a missing QC report as a silent no-badge result", async () => {
        expect(await fetchWorkflowQcSummary("cup", "token", async () => new Response("", { status: 404 }))).toBeNull();
    });

    test("applies all three states only to verified render nodes", () => {
        const nodes = [output("renders"), output("renders", "detail_03"), output("repaired"), output(undefined)];
        const result = applyQcSummaryToNodes(nodes, "cup", summary);
        expect(result[0]?.metadata?.workflowProductionQc?.status).toBe("fail");
        expect(result[1]?.metadata?.workflowProductionQc?.status).toBe("needs_review");
        expect(result[2]?.metadata?.workflowProductionQc).toBeUndefined();
        expect(result[3]?.metadata?.workflowProductionQc).toBeUndefined();
    });

    test("returns the original array when the same QC summary is applied twice", () => {
        const first = applyQcSummaryToNodes([output("renders")], "cup", summary);
        const second = applyQcSummaryToNodes(first, "cup", summary);
        expect(second).toBe(first);
    });

    test("preserves an unchanged QC node while another node receives its badge", () => {
        const unchanged = applyQcSummaryToNodes([output("renders")], "cup", summary)[0]!;
        const nodes = [unchanged, output("renders", "detail_03")];
        const result = applyQcSummaryToNodes(nodes, "cup", summary);
        expect(result).not.toBe(nodes);
        expect(result[0]).toBe(unchanged);
    });

    test("skips cached QC hook work until a render needs a badge", () => {
        const applied = applyQcSummaryToNodes([output("renders")], "cup", summary);
        expect(qcSummaryNeedsApplication(applied, "cup", summary)).toBe(false);
        expect(qcSummaryNeedsApplication([...applied, output("renders", "main_02")], "cup", summary)).toBe(true);
    });

    test("renders fixed badge copy for pass, problems and review", () => {
        expect(qcBadgeView({ status: "pass", issueCount: 0, topCategories: [] })?.text).toBe("通过");
        expect(qcBadgeView({ status: "fail", issueCount: 3, topCategories: ["text"] })?.text).toBe("3 个问题");
        expect(qcBadgeView({ status: "needs_review", issueCount: 0, topCategories: [] })?.text).toBe("待核对");
    });

    test("builds repaired projection metadata without any execution command", () => {
        const state = buildRepairedProjectionRequest("cup", "request-1", 1000);
        const serialized = JSON.stringify(state);
        expect(state).toMatchObject({ status: "queued", batchId: "cup", projectedCount: 0 });
        expect(serialized).not.toMatch(/executor|run:|retry:/i);
    });

    test("allows the pure projection entry only after production completed", () => {
        const machine = { id: "machine", type: CanvasNodeType.Workflow, title: "machine", position: { x: 0, y: 0 }, width: 420, height: 300, metadata: { workflowProduction: { status: "completed", producedCount: 14, totalCount: 14 as const } } };
        expect(repairedProjectionCanStart(machine)).toBe(true);
        expect(repairedProjectionCanStart({ ...machine, metadata: { workflowProduction: { ...machine.metadata.workflowProduction, status: "running" } } })).toBe(false);
    });

    test("imports a repaired image through the existing SHA contract", async () => {
        const node = output("repaired");
        node.metadata!.storageKey = undefined;
        node.metadata!.content = "";
        node.metadata!.workflowProductionOutput!.downloadUrl = "http://127.0.0.1:17373/workflow-production/cup/outputs/repaired/main_01";
        const blob = new Blob(["abc"], { type: "image/png" });
        const metadata = await importProductionOutput(node, "token", {
            fetcher: async () => new Response(blob, { status: 200, headers: { "x-content-sha256": SHA } }),
            uploader: async () => ({ url: "blob:ready", storageKey: "image:ready", width: 1, height: 1, bytes: 3, mimeType: "image/png" }),
        }).catch((error) => error);
        expect(metadata).toBeInstanceOf(Error);
        expect(String(metadata)).not.toContain("接收地址无效");
    });
});
