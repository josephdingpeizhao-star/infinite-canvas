import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    parseAngleInventorySummary,
    parseBindingDistribution,
    productionObservationMessages,
} from "../src/lib/canvas/canvas-workflow-production-observations";
import type { CanvasWorkflowProductionMetadata } from "../src/types/canvas";


const angleSummary = {
    uploaded_count: 3,
    qualified: [{ source_asset_id: "img_001", file_name: "front.jpg", angle_slot: "D" as const }],
    rejected: [
        { source_asset_id: "img_002", file_name: "side.jpg" },
        { source_asset_id: "img_003", file_name: "bottom.jpg" },
    ],
    missing_angle_slots: ["A", "B", "C"] as Array<"A" | "B" | "C" | "D">,
    single_source_production: true,
};

function productionState(status: CanvasWorkflowProductionMetadata["status"] = "running"): CanvasWorkflowProductionMetadata {
    return {
        status,
        producedCount: 0,
        angleInventorySummary: angleSummary,
        bindingDistribution: { bound_reference_counts: { "front.jpg": 5, "detail.jpg": 2 } },
    };
}

describe("AN-01 production observation parsing", () => {
    test("accepts D as a qualified slot and validates count consistency", () => {
        expect(parseAngleInventorySummary(angleSummary)).toEqual(angleSummary);
        expect(parseAngleInventorySummary({ ...angleSummary, uploaded_count: 2 })).toBeUndefined();
        expect(parseAngleInventorySummary({ ...angleSummary, qualified: [{ ...angleSummary.qualified[0], angle_slot: "E" }] })).toBeUndefined();
        expect(parseAngleInventorySummary({ ...angleSummary, single_source_production: false })).toBeUndefined();
    });

    test("accepts a factual binding distribution and rejects nonpositive counts", () => {
        expect(parseBindingDistribution({ bound_reference_counts: { "front.jpg": 5 } })).toEqual({ bound_reference_counts: { "front.jpg": 5 } });
        expect(parseBindingDistribution({ bound_reference_counts: { "front.jpg": 0 } })).toBeUndefined();
    });
});

describe("AN-01 production observation wording", () => {
    test("lists every rejected upload and the single production source", () => {
        expect(productionObservationMessages(productionState())).toEqual([
            "图 side.jpg 已判定不可用于生产",
            "图 bottom.jpg 已判定不可用于生产",
            "本批全部成图将只以 图front.jpg 为基准生成",
        ]);
    });

    test("shows binding distribution only in the completed state", () => {
        expect(productionObservationMessages(productionState("running"))).not.toContain("绑定分布（仅供参考）：图 front.jpg 5 张；图 detail.jpg 2 张");
        expect(productionObservationMessages(productionState("completed"))).toContain("绑定分布（仅供参考）：图 front.jpg 5 张；图 detail.jpg 2 张");
    });

    test("returns no notice when a historical batch has no observation events", () => {
        expect(productionObservationMessages({ status: "completed", producedCount: 3 })).toEqual([]);
    });
});

describe("AN-01 production-card wiring", () => {
    test("calls the pure wording helper and renders each returned line", () => {
        const source = readFileSync(new URL("../src/components/canvas/canvas-workflow-node.tsx", import.meta.url), "utf8");
        const helperCall = source.indexOf("productionObservationMessages(productionState)");
        const renderGuard = source.indexOf("observationMessages.length", helperCall);
        const renderLoop = source.indexOf("observationMessages.map((message)", renderGuard);

        expect(source).toContain('import { productionObservationMessages } from "@/lib/canvas/canvas-workflow-production-observations";');
        expect(helperCall).toBeGreaterThan(-1);
        expect(renderGuard).toBeGreaterThan(helperCall);
        expect(renderLoop).toBeGreaterThan(renderGuard);
        expect(source).toContain("<div key={message}>{message}</div>");
    });
});
