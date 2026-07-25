import { describe, expect, test } from "bun:test";

import {
    CROSS_ROLE_IMAGE_MESSAGE,
    DUPLICATE_PRODUCT_IMAGE_MESSAGE,
    connectedBatchOriginalFileNames,
    resolveBatchIntakeSelection,
} from "../src/lib/canvas/canvas-batch-intake";
import {
    applyIntakeRoleBadgesToNodes,
    batchRegistrationButtonLabel,
    composeImageBadgeStack,
    intakeRoleBadgeView,
    intakeRoleBadgesNeedApplication,
    styleSupplementButtonLabel,
} from "../src/lib/canvas/canvas-intake-role-visibility";
import {
    connectedStyleReferenceFileNames,
    resolveStyleReferenceSelection,
} from "../src/lib/canvas/canvas-style-reference-intake";
import { qcBadgeView } from "../src/lib/canvas/canvas-workflow-delivery";
import {
    CanvasNodeType,
    type CanvasBatchSourceFile,
    type CanvasConnection,
    type CanvasNodeData,
} from "../src/types/canvas";


const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const DUPLICATE_MESSAGE =
    "同一张图被重复加入本次产品原图登记，不能建批。" +
    "请删除重复项，只保留一张；产品原图连工作流机器，风格参考图连信息卡。";
const CROSS_ROLE_MESSAGE =
    "这张图已经是本批的产品原图，不能再登记为风格参考。" +
    "若是接反了：产品原图连工作流机器，风格参考图连信息卡。";


function sourceFile(name: string, sha256: string): CanvasBatchSourceFile {
    return { name, size: 3, type: "image/jpeg", lastModified: 1_000, sha256 };
}


function image(id: string, name: string, sha256: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: name,
        position: { x: 0, y: 0 },
        width: 180,
        height: 180,
        metadata: {
            content: `blob:${id}`,
            storageKey: `image:${id}`,
            sourceFile: sourceFile(name, sha256),
        },
    };
}


function workflow(): CanvasNodeData {
    return {
        id: "machine",
        type: CanvasNodeType.Workflow,
        title: "工作流",
        position: { x: 500, y: 0 },
        width: 420,
        height: 300,
    };
}


function card(sourceImageNodeIds: string[] = []): CanvasNodeData {
    return {
        id: "card",
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 250, y: 0 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status: sourceImageNodeIds.length ? "completed" : "draft",
                productType: "杯子",
                productHeightCm: 8,
                allowClearWater: false,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                workflowNodeId: "machine",
                sourceImageNodeIds,
                receipt: sourceImageNodeIds.length
                    ? { batchId: "cup", imageCount: sourceImageNodeIds.length, facts: {} }
                    : undefined,
            },
        },
    } as CanvasNodeData;
}


function connection(id: string, fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}


describe("NC-01 intake role visibility and hash guardrails", () => {
    test("front-end rejection copy exactly matches the approved full wording", () => {
        expect(DUPLICATE_PRODUCT_IMAGE_MESSAGE).toBe(DUPLICATE_MESSAGE);
        expect(CROSS_ROLE_IMAGE_MESSAGE).toBe(CROSS_ROLE_MESSAGE);
    });

    test("two different product nodes with one hash are rejected before command creation", () => {
        const info = card();
        const machine = workflow();
        const first = image("first", "正面.jpg", SHA_A);
        const second = image("second", "背面.jpg", SHA_A);
        const result = resolveBatchIntakeSelection(
            info.id,
            [info, machine, first, second],
            [
                connection("card-machine", info.id, machine.id),
                connection("first-machine", first.id, machine.id),
                connection("second-machine", second.id, machine.id),
            ],
        );
        expect(result).toEqual({ ok: false, message: DUPLICATE_MESSAGE });
    });

    test("a registered product hash cannot be selected as a style reference", () => {
        const info = card(["product"]);
        const product = image("product", "产品.jpg", SHA_A);
        const style = image("style", "风格.jpg", SHA_A);
        expect(
            resolveStyleReferenceSelection(
                info.id,
                [info, product, style],
                [connection("style-card", style.id, info.id)],
            ),
        ).toEqual({ ok: false, message: CROSS_ROLE_MESSAGE });
    });

    test("product badges use registration order while style badges use the direct card role", () => {
        const info = card();
        const machine = workflow();
        const first = image("first", "正面.jpg", SHA_A);
        const second = image("second", "背面.jpg", SHA_B);
        const style = image("style", "风格.jpg", "c".repeat(64));
        const nodes = [info, machine, first, second, style];
        const connections = [
            connection("card-machine", info.id, machine.id),
            connection("first-machine", first.id, machine.id),
            connection("second-machine", second.id, machine.id),
            connection("style-card", style.id, info.id),
        ];
        const result = applyIntakeRoleBadgesToNodes(nodes, connections);
        expect(result[2]?.metadata?.batchIntakeRole).toEqual({ role: "product_original", index: 1, count: 2 });
        expect(result[3]?.metadata?.batchIntakeRole).toEqual({ role: "product_original", index: 2, count: 2 });
        expect(result[4]?.metadata?.batchIntakeRole).toEqual({ role: "style_reference" });
        expect(intakeRoleBadgeView(result[2]?.metadata?.batchIntakeRole)?.text).toBe("产品原图 1");
        expect(intakeRoleBadgeView(result[4]?.metadata?.batchIntakeRole)?.text).toBe("风格参考");
    });

    test("disconnecting removes the role immediately", () => {
        const machine = workflow();
        const product = image("product", "产品.jpg", SHA_A);
        const applied = applyIntakeRoleBadgesToNodes(
            [machine, product],
            [connection("product-machine", product.id, machine.id)],
        );
        const disconnected = applyIntakeRoleBadgesToNodes(applied, []);
        expect(applied[1]?.metadata?.batchIntakeRole).toBeDefined();
        expect(disconnected[1]?.metadata?.batchIntakeRole).toBeUndefined();
    });

    test("a node connected to both destinations shows an explicit conflict badge", () => {
        const info = card();
        const machine = workflow();
        const conflicted = image("same", "接反.jpg", SHA_A);
        const result = applyIntakeRoleBadgesToNodes(
            [info, machine, conflicted],
            [
                connection("same-machine", conflicted.id, machine.id),
                connection("same-card", conflicted.id, info.id),
            ],
        );
        expect(result[2]?.metadata?.batchIntakeRole).toEqual({ role: "conflict" });
        expect(intakeRoleBadgeView(result[2]?.metadata?.batchIntakeRole)?.text).toBe("原图 / 风格冲突");
    });

    test("unchanged role application preserves the array and every unchanged node reference", () => {
        const machine = workflow();
        const product = image("product", "产品.jpg", SHA_A);
        const connections = [connection("product-machine", product.id, machine.id)];
        const first = applyIntakeRoleBadgesToNodes([machine, product], connections);
        const second = applyIntakeRoleBadgesToNodes(first, [...connections]);
        expect(second).toBe(first);
        expect(second[0]).toBe(first[0]);
        expect(second[1]).toBe(first[1]);
        expect(intakeRoleBadgesNeedApplication(second, connections)).toBe(false);
    });

    test("the role stack coexists with the unchanged QC badge view", () => {
        const machine = workflow();
        const product = image("product", "产品.jpg", SHA_A);
        const qc = { status: "pass" as const, issueCount: 0, topCategories: [] };
        product.metadata = { ...product.metadata, workflowProductionQc: qc };
        const result = applyIntakeRoleBadgesToNodes(
            [machine, product],
            [connection("product-machine", product.id, machine.id)],
        );
        const qcView = qcBadgeView(result[1]?.metadata?.workflowProductionQc);
        const roleView = intakeRoleBadgeView(result[1]?.metadata?.batchIntakeRole);
        const stack = composeImageBadgeStack(roleView, qcView);
        expect(result[1]?.metadata?.workflowProductionQc).toBe(qc);
        expect(qcView).toEqual({ text: "通过", tone: "pass" });
        expect(stack.visible).toBe(true);
        expect(stack.role?.text).toBe("产品原图");
        expect(stack.qc).toBe(qcView);
    });

    test("file lists and dynamic action labels expose the exact pending roles", () => {
        const info = card();
        const machine = workflow();
        const first = image("first", "正面.jpg", SHA_A);
        const second = image("second", "背面.jpg", SHA_B);
        const style = image("style", "咖啡风格.jpg", "c".repeat(64));
        const nodes = [info, machine, first, second, style];
        const connections = [
            connection("card-machine", info.id, machine.id),
            connection("first-machine", first.id, machine.id),
            connection("second-machine", second.id, machine.id),
            connection("style-card", style.id, info.id),
        ];
        expect(connectedBatchOriginalFileNames(info.id, nodes, connections)).toEqual(["正面.jpg", "背面.jpg"]);
        expect(connectedStyleReferenceFileNames(info.id, nodes, connections)).toEqual(["咖啡风格.jpg"]);
        expect(batchRegistrationButtonLabel(2, false, false)).toBe("登记 2 张产品原图");
        expect(batchRegistrationButtonLabel(2, true, false)).toBe("正在登记 2 张产品原图");
        expect(styleSupplementButtonLabel(1, false, false)).toBe("补登 1 张风格参考图");
        expect(styleSupplementButtonLabel(1, true, false)).toBe("正在补登 1 张风格参考图");
    });

    test("the image node uses one stack for the new role and existing QC badges", async () => {
        const nodeSource = await Bun.file(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url)).text();
        const stackSource = await Bun.file(new URL("../src/components/canvas/canvas-image-badge-stack.tsx", import.meta.url)).text();
        expect(nodeSource).toContain("<CanvasImageBadgeStack role={data.metadata?.batchIntakeRole} qc={qcBadge} />");
        expect(stackSource).toContain("composeImageBadgeStack");
        expect(stackSource).toContain("stack.role");
        expect(stackSource).toContain("stack.qc");
        expect(stackSource).toContain('"#166534"');
        expect(stackSource).toContain('"#92400e"');
        expect(stackSource).toContain('"#991b1b"');
    });
});
