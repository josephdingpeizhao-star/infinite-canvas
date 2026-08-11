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

const CONTRACT_HASH = "a030df8d0aa9c96d9275d7c6f463fbc9d8f10af57e8c4539c2cb9d0d903456d3";
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
const BATCH_INTAKE_ALLOWED_KEYS = [
    "status", "category", "contractHash", "batch_type", "productType", "productLengthCm", "productWidthCm", "productHeightCm", "allowClearWater",
    "prohibitPouringAndHeating", "skipMissingDAngle", "mainImageCount", "detailImageCount", "handheldMainCount", "handheldDetailCount", "facts", "requestId",
    "requestedAt", "updatedAt", "workflowNodeId", "sourceImageNodeIds", "setGroupImageNodeIds", "componentWhiteBgImageNodeIds", "batchId", "uploadBaseUrl",
    "expectedCount", "receivedCount", "errorMessage", "receipt",
].sort();

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
    test("pins the v4 contract hash", () => {
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

    test("defaults new category forms to single and keeps set hand-held counts at zero across declaration changes", () => {
        expect(categoryDefaultPatch(CATEGORY, CONTRACT_HASH)).toMatchObject({ batch_type: "single", setGroupImageNodeIds: [], componentWhiteBgImageNodeIds: [] });
        const setState = intakeState({ batch_type: "set", setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"], status: "failed", requestId: "old" });
        expect(batchTypeChangePatch(setState, "set")).toMatchObject({ batch_type: "set", handheldMainCount: 0, handheldDetailCount: 0 });
        const zeroedSetState = resetBatchDeclarationState(setState, batchTypeChangePatch(setState, "set"));
        expect(batchTypeChangePatch(zeroedSetState, "single", CATEGORY)).toEqual({
            batch_type: "single",
            setGroupImageNodeIds: [],
            componentWhiteBgImageNodeIds: [],
            handheldMainCount: CATEGORY.form.handheld.main.default,
            handheldDetailCount: CATEGORY.form.handheld.detail.default,
        });
        expect(resetBatchDeclarationState(zeroedSetState, batchTypeChangePatch(zeroedSetState, "single", CATEGORY))).toMatchObject({
            status: "draft",
            batch_type: "single",
            setGroupImageNodeIds: [],
            componentWhiteBgImageNodeIds: [],
            handheldMainCount: 2,
            handheldDetailCount: 1,
            requestId: undefined,
        });
        expect(categorySwitchPatch(setState, CATEGORY, CONTRACT_HASH)).toMatchObject({
            batch_type: "set",
            setGroupImageNodeIds: ["g"],
            componentWhiteBgImageNodeIds: ["c1", "c2"],
            handheldMainCount: 0,
            handheldDetailCount: 0,
        });
        expect(batchImageSelectionPatch("set_group", ["g", "g"])).toEqual({ setGroupImageNodeIds: ["g"] });
    });

    test("normalizes legacy set metadata before validation and restores current category defaults on single", () => {
        const legacySetState = readBatchIntakeState({
            batchIntake: {
                status: "draft",
                ...categoryDefaultPatch(CATEGORY, CONTRACT_HASH),
                batch_type: "set",
                setGroupImageNodeIds: ["g"],
                componentWhiteBgImageNodeIds: ["c1", "c2"],
                productHeightCm: 12,
                handheldMainCount: 5,
                handheldDetailCount: 4,
            },
        });
        expect(legacySetState).toMatchObject({ batch_type: "set", handheldMainCount: 0, handheldDetailCount: 0 });
        expect(validateBatchIntakeFacts(legacySetState, CATEGORY, CONTRACT_HASH)).toMatchObject({
            ok: true,
            facts: { handheld_main: 0, handheld_detail: 0 },
        });
        expect(batchTypeChangePatch(legacySetState, "single", CATEGORY)).toMatchObject({
            batch_type: "single",
            handheldMainCount: CATEGORY.form.handheld.main.default,
            handheldDetailCount: CATEGORY.form.handheld.detail.default,
        });
        const command = buildBatchIntakeCommand(
            legacySetState,
            CATEGORY,
            CONTRACT_HASH,
            { workflowNodeId: "machine", sourceImageNodeIds: ["white", "g", "c1", "c2"] },
            "request-legacy-set",
            1_000,
        );
        expect(command.state).toMatchObject({
            handheldMainCount: 0,
            handheldDetailCount: 0,
            facts: { handheld_main: 0, handheld_detail: 0 },
        });
        expect(Object.keys(command.state).sort()).toEqual(BATCH_INTAKE_ALLOWED_KEYS);
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
        expect(Object.keys(command.state).sort()).toEqual(BATCH_INTAKE_ALLOWED_KEYS);
        expect(Object.keys(command.state.facts || {})).toEqual(["product_type", "length_cm", "width_cm", "height_cm", "main_image_count", "detail_image_count", "handheld_main", "handheld_detail", "forbid_pouring_and_heating", "missing_d_no_retake"]);
    });

    test("lets set batches omit all dimensions while single height remains required", () => {
        const missingDimensions = intakeState({
            batch_type: "set",
            productLengthCm: undefined,
            productWidthCm: undefined,
            productHeightCm: undefined,
            setGroupImageNodeIds: ["g"],
            componentWhiteBgImageNodeIds: ["c1", "c2"],
            handheldMainCount: 0,
            handheldDetailCount: 0,
        });
        const result = validateBatchIntakeFacts(missingDimensions, CATEGORY, CONTRACT_HASH);
        expect(result).toEqual({
            ok: true,
            facts: {
                product_type: "杯子",
                length_cm: null,
                width_cm: null,
                height_cm: null,
                main_image_count: 6,
                detail_image_count: 8,
                handheld_main: 0,
                handheld_detail: 0,
                forbid_pouring_and_heating: true,
                missing_d_no_retake: true,
            },
        });
        const command = buildBatchIntakeCommand(missingDimensions, CATEGORY, CONTRACT_HASH, { workflowNodeId: "machine", sourceImageNodeIds: ["white", "g", "c1", "c2"] }, "request-set", 1000);
        expect(command.state.productHeightCm).toBeUndefined();
        expect(command.state.facts?.height_cm).toBeNull();

        expect(validateBatchIntakeFacts(intakeState({ productHeightCm: undefined }), CATEGORY, CONTRACT_HASH)).toEqual({
            ok: false,
            message: "高必须填写 1–9999 的整数厘米。",
        });

        const supplied = validateBatchIntakeFacts(missingDimensions, CATEGORY, CONTRACT_HASH);
        expect(supplied.ok && supplied.facts.height_cm).toBeNull();
        const suppliedSet = validateBatchIntakeFacts({ ...missingDimensions, productLengthCm: 10, productWidthCm: 11, productHeightCm: 12 }, CATEGORY, CONTRACT_HASH);
        expect(suppliedSet.ok && suppliedSet.facts).toMatchObject({ length_cm: 10, width_cm: 11, height_cm: 12 });
    });

    test("rejects nonzero set hand-held counts while preserving legal single counts", () => {
        const setState = intakeState({
            batch_type: "set",
            setGroupImageNodeIds: ["g"],
            componentWhiteBgImageNodeIds: ["c1", "c2"],
            handheldMainCount: 0,
            handheldDetailCount: 0,
        });
        expect(validateBatchIntakeFacts(setState, CATEGORY, CONTRACT_HASH)).toMatchObject({
            ok: true,
            facts: { handheld_main: 0, handheld_detail: 0 },
        });
        for (const patch of [{ handheldMainCount: 1 }, { handheldDetailCount: 1 }]) {
            expect(validateBatchIntakeFacts({ ...setState, ...patch }, CATEGORY, CONTRACT_HASH)).toEqual({
                ok: false,
                message: "套装批次暂不支持手持，主图与详情手持数量必须为 0。",
            });
        }
        expect(validateBatchIntakeFacts(intakeState({ handheldMainCount: 3, handheldDetailCount: 2 }), CATEGORY, CONTRACT_HASH).ok).toBe(true);
    });

    test("marks all three dimensions optional only on the set form", () => {
        const setHtml = renderCard(intakeState({ batch_type: "set", productLengthCm: undefined, productWidthCm: undefined, productHeightCm: undefined, setGroupImageNodeIds: ["g"], componentWhiteBgImageNodeIds: ["c1", "c2"] }));
        expect(setHtml).toContain("长（选填）");
        expect(setHtml).toContain("宽（选填）");
        expect(setHtml).toContain("高（选填）");
        const singleHtml = renderCard(intakeState());
        expect(singleHtml).toContain("高 *");
        expect(singleHtml).not.toContain("高（选填）");
    });

    test("disables both set hand-held inputs at zero while leaving single inputs editable", () => {
        const setHtml = renderCard(intakeState({
            batch_type: "set",
            setGroupImageNodeIds: ["g"],
            componentWhiteBgImageNodeIds: ["c1", "c2"],
            handheldMainCount: 5,
            handheldDetailCount: 4,
        }));
        expect(setHtml).toMatch(/title="主图手持"[\s\S]*?<input(?=[^>]*value="0")(?=[^>]*disabled="")[^>]*>/);
        expect(setHtml).toMatch(/title="详情图手持"[\s\S]*?<input(?=[^>]*value="0")(?=[^>]*disabled="")[^>]*>/);
        expect(setHtml).toContain("手持：主 0 + 详情 0");

        const singleHtml = renderCard(intakeState());
        expect(singleHtml).toMatch(/title="主图手持"[\s\S]*?<input(?![^>]*disabled="")(?=[^>]*value="2")[^>]*>/);
        expect(singleHtml).toMatch(/title="详情图手持"[\s\S]*?<input(?![^>]*disabled="")(?=[^>]*value="1")[^>]*>/);
    });

    test("wires batch type radio changes to the declaration patch before applying live category hand-held defaults", () => {
        const componentSource = readFileSync(new URL("../src/components/canvas/canvas-batch-info-node.tsx", import.meta.url), "utf8");
        expect(componentSource).toMatch(
            /const changeBatchType = \(nextBatchType: CanvasBatchType\) => \{\s+const patch = batchTypeChangePatch\(state, nextBatchType, category\);\s+onBatchTypeChange\(node\.id, nextBatchType\);\s+onChange\(node\.id, \{ handheldMainCount: patch\.handheldMainCount, handheldDetailCount: patch\.handheldDetailCount \}\);\s+\};/,
        );
        expect(componentSource).toContain('checked={batchType === value} disabled={!editable} onChange={() => changeBatchType(value)}');
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
