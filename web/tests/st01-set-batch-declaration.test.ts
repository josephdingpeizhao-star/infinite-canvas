import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasBatchInfoNode } from "../src/components/canvas/canvas-batch-info-node";
import {
    BATCH_INTAKE_CONTRACT_SHA256,
    DUPLICATE_PRODUCT_IMAGE_MESSAGE,
    batchImageSelectionPatch,
    batchTypeChangePatch,
    buildBatchIntakeCommand,
    categoryDefaultPatch,
    categorySwitchPatch,
    readBatchIntakeState,
    resetBatchDeclarationState,
    resolveBatchIntakeSelection,
    validateBatchIntakeFacts,
    validateBatchTypeDeclaration,
} from "../src/lib/canvas/canvas-batch-intake";
import { CanvasNodeType, type CanvasBatchCategoryCatalog, type CanvasBatchCategoryMetadata, type CanvasBatchIntakeMetadata, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const CONTRACT_HASH = "266f01ac2532a334e8b4378ee369d49a9a6f97cbe256fbce8daef06b357b9a61";
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
        image_counts: { main: { default: 6, minimum: 1, maximum: 30 }, detail: { default: 8, minimum: 1, maximum: 30 } },
        handheld: { main: { default: 2, minimum: 0 }, detail: { default: 1, minimum: 0 } },
        advanced_options: [
            { field: "forbid_pouring_and_heating", default: true, label: "禁止倒水和加热", description: "保持静态" },
            { field: "missing_d_no_retake", default: true, label: "缺角度不补拍", description: "继续登记" },
        ],
    },
};
const CATALOG: CanvasBatchCategoryCatalog = { contractHash: CONTRACT_HASH, categories: [CATEGORY] };

function intakeState(patch: Partial<CanvasBatchIntakeMetadata> = {}) {
    return readBatchIntakeState({
        batchIntake: {
            status: "draft",
            ...categoryDefaultPatch(CATEGORY, CONTRACT_HASH),
            productHeightCm: 12,
            ...patch,
        },
    });
}

function sourceNode(id: string, shaDigit: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: `${id}.png`,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: {
            storageKey: `image:${id}`,
            sourceFile: { name: `${id}.png`, size: 3, type: "image/png", lastModified: 1, sha256: shaDigit.repeat(64) },
        },
    };
}

function batchCard(state: CanvasBatchIntakeMetadata): CanvasNodeData {
    return { id: "card", type: CanvasNodeType.BatchInfo, title: "信息卡", position: { x: 0, y: 0 }, width: 420, height: 660, metadata: { batchIntake: state } };
}

function workflowNode(): CanvasNodeData {
    return { id: "machine", type: CanvasNodeType.Workflow, title: "工作流", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} };
}

function connection(id: string, fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}

function renderCard(state: CanvasBatchIntakeMetadata) {
    return renderToStaticMarkup(createElement(CanvasBatchInfoNode, {
        node: batchCard(state),
        connectedOriginalCount: 1,
        connectedStyleReferenceCount: 0,
        connectedOriginalFileNames: ["white.png"],
        connectedStyleReferenceFileNames: [],
        setGroupFileNames: ["group.png"],
        componentWhiteBgFileNames: ["one.png", "two.png"],
        categoryCatalog: CATALOG,
        categoryCatalogStatus: "ready",
        onChange: () => undefined,
        onBatchTypeChange: () => undefined,
        onUploadSetImages: () => undefined,
        onRegister: () => undefined,
        onSupplementStyle: () => undefined,
    }));
}

describe("ST-01 set batch declaration", () => {
    test("pins the v3 contract hash", () => {
        expect(BATCH_INTAKE_CONTRACT_SHA256).toBe(CONTRACT_HASH);
    });

    test("rejects missing, illegal, and non-string batch_type while accepting the closed values", () => {
        for (const batch_type of [undefined, "bundle", 1, true, null]) {
            const state = readBatchIntakeState({ batchIntake: { ...intakeState(), batch_type } as CanvasBatchIntakeMetadata });
            expect(validateBatchTypeDeclaration(state)).toEqual({ ok: false, message: "商品类型声明无效，请重新选择单品或套装。" });
            expect(validateBatchIntakeFacts(state, CATEGORY, CONTRACT_HASH).ok).toBe(false);
        }
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "single" }))).toEqual({ ok: true, batch_type: "single" });
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"] }))).toEqual({ ok: true, batch_type: "set" });
    });

    test("keeps duplicate product SHA rejection ahead of missing or illegal batch_type", () => {
        const machine = workflowNode();
        const first = sourceNode("first", "a");
        const second = sourceNode("second", "a");
        const links = [
            connection("card-machine", "card", machine.id),
            connection("first-machine", first.id, machine.id),
            connection("second-machine", second.id, machine.id),
        ];
        for (const batch_type of [undefined, "bundle"]) {
            const state = readBatchIntakeState({ batchIntake: { ...intakeState(), batch_type } as CanvasBatchIntakeMetadata });
            expect(resolveBatchIntakeSelection("card", [batchCard(state), machine, first, second], links)).toEqual({
                ok: false,
                message: DUPLICATE_PRODUCT_IMAGE_MESSAGE,
            });
        }
    });

    test("enforces set 1–3 group and 2–8 component images and keeps single at zero", () => {
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "single", setGroupImageNodeIds: ["g"] })).ok).toBe(false);
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "single", componentWhiteBgImageNodeIds: ["c"] })).ok).toBe(false);
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: ["c1", "c2"] }))).toEqual({ ok: false, message: "套装合影白底图必须上传 1–3 张。" });
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g1", "g2", "g3", "g4"], componentWhiteBgImageNodeIds: ["c1", "c2"] })).ok).toBe(false);
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1"] }))).toEqual({ ok: false, message: "各单件白底图必须上传 2–8 张。" });
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: Array.from({ length: 9 }, (_, index) => `c${index}`) })).ok).toBe(false);
        expect(validateBatchTypeDeclaration(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g1", "g2", "g3"], componentWhiteBgImageNodeIds: Array.from({ length: 8 }, (_, index) => `c${index}`) }))).toEqual({ ok: true, batch_type: "set" });
    });

    test("defaults new category forms to single, clears set metadata on single, and preserves set across category switches", () => {
        expect(categoryDefaultPatch(CATEGORY, CONTRACT_HASH)).toMatchObject({ batch_type: "single", setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: [] });
        const setState = intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"], status: "failed", requestId: "old" });
        expect(batchTypeChangePatch(setState, "single")).toEqual({ batch_type: "single", setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: [] });
        expect(resetBatchDeclarationState(setState, batchTypeChangePatch(setState, "single"))).toMatchObject({ status: "draft", batch_type: "single", setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: [], requestId: undefined });
        expect(categorySwitchPatch(setState, CATEGORY, CONTRACT_HASH)).toMatchObject({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"] });
        expect(batchImageSelectionPatch("set_group", ["g", "g"])).toEqual({ setGroupImageNodeIds: ["g"] });
    });

    test("merges connected white-bg, group, and component IDs without changing the single selection path", () => {
        const white = sourceNode("white", "1");
        const group = sourceNode("group", "2");
        const componentOne = sourceNode("component-one", "3");
        const componentTwo = sourceNode("component-two", "4");
        const machine = workflowNode();
        const links = [connection("card-machine", "card", machine.id), connection("white-machine", white.id, machine.id)];
        const setState = intakeState({ batch_type: "set", setGroupImageNodeIds: [group.id], componentWhiteBgImageNodeIds: [componentOne.id, componentTwo.id] });
        expect(resolveBatchIntakeSelection("card", [batchCard(setState), machine, white, group, componentOne, componentTwo], links)).toEqual({
            ok: true,
            workflowNodeId: "machine",
            sourceImageNodeIds: ["white", "group", "component-one", "component-two"],
        });
        expect(resolveBatchIntakeSelection("card", [batchCard(intakeState()), machine, white], links)).toEqual({ ok: true, workflowNodeId: "machine", sourceImageNodeIds: ["white"] });
    });

    test("places batch_type beside the existing contract fields and keeps the single command and ten facts unchanged", () => {
        const command = buildBatchIntakeCommand(intakeState(), CATEGORY, CONTRACT_HASH, { workflowNodeId: "machine", sourceImageNodeIds: ["white"] }, "request-1", 1000);
        expect(command.content).toBe("# batch-intake\n# request-id: request-1\n# requested-at: 1000\nbuild: batch");
        expect(command.state).toMatchObject({ batch_type: "single", category: "杯类", contractHash: CONTRACT_HASH, sourceImageNodeIds: ["white"], setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: [] });
        expect(Object.keys(command.state.facts || {})).toEqual(["product_type", "length_cm", "width_cm", "height_cm", "main_image_count", "detail_image_count", "handheld_main", "handheld_detail", "forbid_pouring_and_heating", "missing_d_no_retake"]);
    });

    test("shows set-only upload areas and locks the declaration after queueing", () => {
        const singleHtml = renderCard(intakeState());
        expect(singleHtml).toContain("单品（默认）");
        expect(singleHtml).not.toContain("套装合影白底图");
        const missingTypeHtml = renderCard(intakeState({ batch_type: undefined }));
        expect(missingTypeHtml.match(/<input type="radio"[^>]*checked=""/g) || []).toHaveLength(0);
        const setHtml = renderCard(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"] }));
        expect(setHtml).toContain("套装合影白底图");
        expect(setHtml).toContain("各单件白底图");
        expect(setHtml).toContain("选择图片（可多选）");
        const queuedHtml = renderCard(intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"], status: "queued" }));
        expect(queuedHtml.match(/<input type="radio"[^>]*disabled=""/g) || []).toHaveLength(2);
        expect(queuedHtml.match(/<button[^>]*disabled=""[^>]*>[\s\S]*?选择图片（可多选）<\/button>/g) || []).toHaveLength(2);
    });

    test("wires the two upload categories through the existing SHA and blob path without changing the intake hook", () => {
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const componentSource = readFileSync(new URL("../src/components/canvas/canvas-batch-info-node.tsx", import.meta.url), "utf8");
        const hookSource = readFileSync(new URL("../src/pages/canvas/use-canvas-batch-intake.ts", import.meta.url), "utf8");
        expect(projectSource).toContain("Promise.all([uploadImage(file), createBatchSourceFile(file)])");
        expect(projectSource).toContain('accept="image/*" multiple');
        expect(projectSource).toContain("onUploadSetImages={handleBatchSetUploadRequest}");
        expect(componentSource).toContain('checked={batchType === value} disabled={!editable}');
        expect(componentSource).toContain('label="套装合影白底图" range="1–3 张，必传" names={setGroupFileNames} disabled={!editable}');
        expect(componentSource).toContain('label="各单件白底图" range="2–8 张，必传" names={componentWhiteBgFileNames} disabled={!editable}');
        expect(componentSource).not.toContain('state.batch_type || "single"');
        expect(hookSource).toContain("selection.sourceImageNodeIds.map");
        expect(hookSource).not.toContain("setGroupImageNodeIds");
        expect(hookSource).not.toContain("componentWhiteBgImageNodeIds");
    });
});
