import { describe, expect, test } from "bun:test";

import {
    BATCH_CATEGORY_UNAVAILABLE_MESSAGE,
    BATCH_INTAKE_CONTRACT_SHA256,
    buildBatchIntakeCommand,
    categoryDefaultPatch,
    fetchBatchCategoryCatalog,
    readBatchIntakeState,
} from "../src/lib/canvas/canvas-batch-intake";
import type { CanvasBatchCategoryMetadata } from "../src/types/canvas";

const EXPECTED_CONTRACT_HASH = "266f01ac2532a334e8b4378ee369d49a9a6f97cbe256fbce8daef06b357b9a61";
const CATEGORY: CanvasBatchCategoryMetadata = {
    key: "杯类",
    display_name: "杯类",
    product_noun: "杯子",
    form: {
        dimensions: {
            required: ["height_cm"],
            fields: [
                { key: "length_cm", label: "长", unit: "厘米", minimum: 1, maximum: 9999 },
                { key: "width_cm", label: "宽", unit: "厘米", minimum: 1, maximum: 9999 },
                { key: "height_cm", label: "高", unit: "厘米", minimum: 1, maximum: 9999 },
            ],
        },
        image_counts: {
            main: { default: 6, minimum: 1, maximum: 30 },
            detail: { default: 8, minimum: 1, maximum: 30 },
        },
        handheld: {
            main: { default: 2, minimum: 0 },
            detail: { default: 1, minimum: 0 },
        },
        advanced_options: [
            { field: "forbid_pouring_and_heating", default: true, label: "不出现倒水、加热等动作画面", description: "禁止动作场景。" },
            { field: "missing_d_no_retake", default: true, label: "拍摄角度不全时直接继续", description: "缺角度时按现有原图继续。" },
        ],
    },
};

function categoryResponse(category: unknown) {
    return new Response(JSON.stringify({ ok: true, contractHash: EXPECTED_CONTRACT_HASH, categories: [category] }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

describe("CFG-01 clear-water retirement contract", () => {
    test("anchors the fork to the shared ten-field contract hash", () => {
        expect(BATCH_INTAKE_CONTRACT_SHA256).toBe(EXPECTED_CONTRACT_HASH);
    });

    test("accepts exactly the two remaining advanced-option keys", async () => {
        const accepted = await fetchBatchCategoryCatalog("in-memory-token", async () => categoryResponse(CATEGORY));
        expect(accepted.categories[0]?.form.advanced_options.map((option) => option.field)).toEqual([
            "forbid_pouring_and_heating",
            "missing_d_no_retake",
        ]);

        const missingOption = {
            ...CATEGORY,
            form: { ...CATEGORY.form, advanced_options: CATEGORY.form.advanced_options.slice(0, 1) },
        };
        const retiredOption = {
            ...CATEGORY,
            form: {
                ...CATEGORY.form,
                advanced_options: [
                    ...CATEGORY.form.advanced_options,
                    { field: "allow_clear_water", default: false, label: "退役字段", description: "不得重新进入新契约。" },
                ],
            },
        };
        await expect(fetchBatchCategoryCatalog("in-memory-token", async () => categoryResponse(missingOption))).rejects.toThrow(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
        await expect(fetchBatchCategoryCatalog("in-memory-token", async () => categoryResponse(retiredOption))).rejects.toThrow(BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
    });

    test("builds a ten-field intake payload without the retired key", () => {
        const state = readBatchIntakeState({
            batchIntake: {
                status: "draft",
                ...categoryDefaultPatch(CATEGORY, EXPECTED_CONTRACT_HASH),
                productHeightCm: 25,
            },
        });
        const command = buildBatchIntakeCommand(
            state,
            CATEGORY,
            EXPECTED_CONTRACT_HASH,
            { workflowNodeId: "machine", sourceImageNodeIds: ["image"] },
            "request-cfg01",
            1_000,
        );

        expect(Object.keys(command.state.facts)).toEqual([
            "product_type",
            "length_cm",
            "width_cm",
            "height_cm",
            "main_image_count",
            "detail_image_count",
            "handheld_main",
            "handheld_detail",
            "forbid_pouring_and_heating",
            "missing_d_no_retake",
        ]);
        expect("allow_clear_water" in command.state.facts).toBe(false);
    });
});
