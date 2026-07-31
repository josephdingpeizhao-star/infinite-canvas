import { describe, expect, test } from "bun:test";

import {
    buildWorkflowImageDownloadPlan,
    isWorkflowImageDownloadCandidate,
    isWorkflowImageDownloadDisabled,
    resolveWorkflowImageDownloadBlobs,
} from "../src/lib/canvas/canvas-workflow-image-export";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkflowProductionOutputMetadata } from "../src/types/canvas";

const BATCH_ID = "plate_20260731";
const EXPECTED_CONFIG_IDS = ["main_01", "main_02", "detail_01"];
const SHA256 = "a".repeat(64);

function machine(): CanvasNodeData {
    return {
        id: "machine",
        type: CanvasNodeType.Workflow,
        title: "machine",
        position: { x: 0, y: 0 },
        width: 420,
        height: 300,
        metadata: {
            workflowProduction: {
                status: "completed",
                producedCount: EXPECTED_CONFIG_IDS.length,
                totalCount: EXPECTED_CONFIG_IDS.length,
                expectedConfigIds: [...EXPECTED_CONFIG_IDS],
                batchId: BATCH_ID,
            },
        },
    };
}

function output(id: string, configId: string, source: "renders" | "repaired" = "renders", proofPatch: Partial<CanvasWorkflowProductionOutputMetadata> = {}): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: {
            storageKey: `image:${id}`,
            workflowProductionOutput: {
                workflowNodeId: "machine",
                batchId: BATCH_ID,
                configId,
                index: 1,
                sha256: SHA256,
                downloadUrl: "http://127.0.0.1:17373/output",
                byteCount: 1,
                source,
                ...proofPatch,
            },
        },
    };
}

describe("EX-01 workflow image downloads", () => {
    test("rejects nodes outside every fail-closed evidence boundary", () => {
        const nonImage = { ...output("text", "main_01"), type: CanvasNodeType.Text };
        const withoutStorage = output("no-storage", "main_01");
        delete withoutStorage.metadata!.storageKey;
        const withoutProof = output("no-proof", "main_01");
        delete withoutProof.metadata!.workflowProductionOutput;
        const wrongBatch = output("wrong-batch", "main_01", "renders", { batchId: "other" });
        const unexpectedConfig = output("wrong-config", "detail_02");
        const invalidSource = output("wrong-source", "main_01");
        invalidSource.metadata!.workflowProductionOutput!.source = "other" as "renders";
        const invalidSha = output("wrong-sha", "main_01", "renders", { sha256: "xyz" });

        expect(isWorkflowImageDownloadCandidate(nonImage, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(withoutStorage, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(withoutProof, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(wrongBatch, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(unexpectedConfig, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(invalidSource, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
        expect(isWorkflowImageDownloadCandidate(invalidSha, BATCH_ID, EXPECTED_CONFIG_IDS)).toBe(false);
    });

    test("collects all or selected nodes once in machine config and source order", () => {
        const mainRender = output("main-render", "main_01");
        const mainRepair = output("main-repair", "main_01", "repaired");
        const mainTwo = output("main-two", "main_02");
        const detailRender = output("detail-render", "detail_01");
        const detailRepair = output("detail-repair", "detail_01", "repaired");
        const copiedMainRender = output("main-render-copy", "main_01");
        const crossBatch = output("cross-batch", "main_01", "renders", { batchId: "other" });
        const nodes = [detailRepair, mainTwo, mainRepair, detailRender, copiedMainRender, mainRender, mainRender, crossBatch];

        const all = buildWorkflowImageDownloadPlan(machine(), nodes, "all", new Set());
        const selected = buildWorkflowImageDownloadPlan(machine(), nodes, "selected", new Set(["main-repair", "detail-render", "cross-batch"]));

        expect(all?.items.map((item) => item.nodeId)).toEqual(["main-render", "main-repair", "main-two", "detail-render", "detail-repair"]);
        expect(selected?.items.map((item) => item.nodeId)).toEqual(["main-repair", "detail-render"]);
    });

    test("uses collision-safe render, repair, and batch ZIP names", () => {
        const plan = buildWorkflowImageDownloadPlan(machine(), [output("repair", "main_01", "repaired"), output("render", "main_01")], "all", new Set());

        expect(plan?.items.map((item) => item.fileName)).toEqual(["main_01.png", "main_01_返修.png"]);
        expect(plan?.zipFileName).toBe(`${BATCH_ID}.zip`);
    });

    test("classifies an expired storage key in the missing slot list", () => {
        const plan = buildWorkflowImageDownloadPlan(machine(), [output("available", "main_01"), output("missing", "main_02")], "all", new Set())!;
        const resolved = resolveWorkflowImageDownloadBlobs(
            plan,
            new Map([
                ["image:available", new Blob(["ok"], { type: "image/png" })],
                ["image:missing", null],
            ]),
        );

        expect(resolved.files.map((file) => file.configId)).toEqual(["main_01"]);
        expect(resolved.missingItems.map((item) => item.configId)).toEqual(["main_02"]);
    });

    test("disables selected download when the eligible intersection is empty", () => {
        const empty = buildWorkflowImageDownloadPlan(machine(), [output("main", "main_01")], "selected", new Set(["unrelated"]))!;

        expect(empty.items).toHaveLength(0);
        expect(isWorkflowImageDownloadDisabled(empty.items.length)).toBe(true);
        expect(isWorkflowImageDownloadDisabled(1)).toBe(false);
    });
});
