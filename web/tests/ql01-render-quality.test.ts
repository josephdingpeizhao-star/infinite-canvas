import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { BATCH_INTAKE_CONTRACT_SHA256, buildBatchIntakeCommand, categoryDefaultPatch, readBatchIntakeState, RENDER_QUALITY_LEVELS } from "@/lib/canvas/canvas-batch-intake";
import { productionConfirmationCopy } from "@/lib/canvas/canvas-workflow-production";
import type { CanvasBatchCategoryMetadata } from "@/types/canvas";


const intakeSource = readFileSync(new URL("../src/lib/canvas/canvas-batch-intake.ts", import.meta.url), "utf8");
const batchCardSource = readFileSync(new URL("../src/components/canvas/canvas-batch-info-node.tsx", import.meta.url), "utf8");
const confirmationCardSource = readFileSync(new URL("../src/components/canvas/canvas-workflow-production-cost-card.tsx", import.meta.url), "utf8");
const CATEGORY: CanvasBatchCategoryMetadata = {
    key: "杯类",
    display_name: "杯类",
    product_noun: "杯子",
    form: {
        dimensions: { required: ["height_cm"], fields: [{ key: "height_cm", label: "高", unit: "厘米", minimum: 1, maximum: 9999 }] },
        image_counts: { main: { default: 6, minimum: 1, maximum: 30 }, detail: { default: 8, minimum: 1, maximum: 30 } },
        handheld: { main: { default: 2, minimum: 0 }, detail: { default: 1, minimum: 0 } },
        advanced_options: [
            { field: "forbid_pouring_and_heating", default: true, label: "禁止动作", description: "离线测试" },
            { field: "missing_d_no_retake", default: true, label: "缺角度继续", description: "离线测试" },
        ],
    },
};


describe("QL-01 render quality", () => {
    test("normalizes saved quality and legacy or invalid values", () => {
        expect(readBatchIntakeState({ batchIntake: { status: "draft", renderQuality: "high" } as never }).renderQuality).toBe("high");
        expect(readBatchIntakeState({ batchIntake: { status: "draft" } as never }).renderQuality).toBe("auto");
        expect(readBatchIntakeState({ batchIntake: { status: "draft", renderQuality: "ultra" } as never }).renderQuality).toBe("auto");
    });

    test("anchors the payload key and exact legal value order", () => {
        expect([...RENDER_QUALITY_LEVELS]).toEqual(["auto", "low", "medium", "high"]);
        expect(intakeSource).toContain('export const RENDER_QUALITY_LEVELS = ["auto", "low", "medium", "high"] as const;');
        expect(intakeSource).toContain("render_quality: state.renderQuality");
        expect(intakeSource).not.toContain('from "@/components/canvas/image-settings-panel"');

        const state = readBatchIntakeState({
            batchIntake: { ...categoryDefaultPatch(CATEGORY, BATCH_INTAKE_CONTRACT_SHA256), productHeightCm: 12, renderQuality: "low", status: "draft" },
        });
        const command = buildBatchIntakeCommand(state, CATEGORY, BATCH_INTAKE_CONTRACT_SHA256, { workflowNodeId: "workflow", sourceImageNodeIds: ["image"] }, "request-0001", 1_000);
        expect(command.state.render_quality).toBe("low");
    });

    test("keeps the batch card four choices local and ordered", () => {
        expect(batchCardSource).toContain('value: "auto", label: "自动"');
        expect(batchCardSource).toContain('value: "high", label: "高"');
        expect(batchCardSource).toContain('value: "medium", label: "中"');
        expect(batchCardSource).toContain('value: "low", label: "低"');
    });

    test("removes amount copy and states the provider billing boundary", () => {
        const copy = productionConfirmationCopy({ remainingCount: 3, textModelLabel: "Codex gpt-5.5（medium）", renderQuality: "medium", estimatedMinutes: 24 });
        expect(copy).toEqual({
            title: "确认开始真实制作",
            buttonLabel: "确认开始",
            notice: "时长按当前缺图数量估算。确认后机器才会进入真实制作；任一步失败都会停下，不会自动重试。实际费用以图片服务商后台为准。",
            footnote: "取消不会写入命令、不会修改批次，也不会产生费用。",
            rows: [
                { key: "remaining", label: "本次还需制作", value: "3 张" },
                { key: "textModel", label: "识图模型", value: "Codex gpt-5.5（medium）" },
                { key: "quality", label: "生图质量", value: "中" },
                { key: "duration", label: "预计时长", value: "约 24 分钟" },
            ],
        });
        expect(confirmationCardSource).not.toContain("预计金额");
        expect(confirmationCardSource).not.toContain("确认费用并开始");
        expect(confirmationCardSource).toContain("productionConfirmationCopy");
    });
});
