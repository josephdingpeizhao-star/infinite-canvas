import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasBatchInfoNode } from "../src/components/canvas/canvas-batch-info-node";
import { CanvasNode } from "../src/components/canvas/canvas-node";
import { CanvasWorkflowNode } from "../src/components/canvas/canvas-workflow-node";
import {
    createDockedPairPlan,
    dockedPairVariant,
    isDockedPair,
    remapPairedNodeId,
    resolvePairedCascadeIds,
    shouldHideDockedPairConnection,
    stripPairedNodeId,
    workflowEmptyInputMessage,
} from "../src/lib/canvas/canvas-docked-pair";
import { applyIntakeRoleBadgesToNodes } from "../src/lib/canvas/canvas-intake-role-visibility";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const legacyMessage = "请先把至少 1 张图片素材连到左侧输入点。";

function node(id: string, type: CanvasNodeType, x: number, y: number, width = 440, height = type === CanvasNodeType.BatchInfo ? 540 : 300): CanvasNodeData {
    return { id, type, title: id, position: { x, y }, width, height };
}

function plan() {
    return createDockedPairPlan({
        center: { x: 500, y: 600 },
        cardId: "card",
        machineId: "machine",
        connectionId: "internal",
        cardSpec: { width: 440, height: 540, title: "批次信息卡", metadata: { batchIntake: { status: "draft" } } },
        machineSpec: { width: 420, height: 300, title: "生图工作流 · 演示", metadata: { workflowDemo: { status: "idle", producedCount: 0, completedRuns: 0 } } },
    });
}

function renderWorkflow(docked?: boolean) {
    return renderToStaticMarkup(
        createElement(CanvasWorkflowNode, {
            node: plan().machine,
            docked,
            connectedImageCount: 0,
            downloadableSelectedImageCount: 0,
            downloadableAllImageCount: 0,
            onStart: () => undefined,
            onDownloadSelected: () => undefined,
            onDownloadAll: () => undefined,
            onProjectRepaired: () => undefined,
            onEnsureReceiving: () => undefined,
            onToggleDetails: () => undefined,
        }),
    );
}

function renderBatch(docked?: boolean) {
    return renderToStaticMarkup(
        createElement(CanvasBatchInfoNode, {
            node: plan().card,
            docked,
            connectedOriginalCount: 0,
            connectedStyleReferenceCount: 0,
            connectedOriginalFileNames: [],
            connectedStyleReferenceFileNames: [],
            setGroupFileNames: [],
            componentWhiteBgFileNames: [],
            categoryCatalogStatus: "loading",
            onChange: () => undefined,
            onBatchTypeChange: () => undefined,
            onRegister: () => undefined,
            onSupplementStyle: () => undefined,
        }),
    );
}

function renderShell(suppressResizeHandles: boolean, dockedVariant?: "top" | "bottom", data = plan().card) {
    return renderToStaticMarkup(
        createElement(CanvasNode, {
            data,
            scale: 1,
            isSelected: false,
            isRelated: false,
            isFocusRelated: false,
            isConnectionTarget: false,
            isConnecting: false,
            dockedVariant,
            suppressResizeHandles,
            showPanel: false,
            showImageInfo: false,
            onMouseDown: () => undefined,
            onHoverStart: () => undefined,
            onHoverEnd: () => undefined,
            onConnectStart: () => undefined,
            onResize: () => undefined,
            onContentChange: () => undefined,
            onTitleChange: () => undefined,
            onContextMenu: () => undefined,
        }),
    );
}

function renderShellFromDockedState(data: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    const executableProjectSource = projectSource.replace(/[/][*][\s\S]*?[*][/]/g, "").replace(/[/][/].*$/gm, "");
    expect(executableProjectSource).toContain("suppressResizeHandles={Boolean(dockedVariantByNodeId.get(node.id))}");
    const variant = dockedPairVariant(data, nodes, connections);
    return renderShell(Boolean(variant), variant || undefined, data);
}

function resizeHandleCount(html: string) {
    return (html.match(/cursor-(?:nwse|nesw)-resize/g) || []).length;
}

describe("MG-01 docked pair plan", () => {
    test("creates equal-width adjacent nodes with mutual ids and one retained internal connection", () => {
        const result = plan();
        expect(result.card.width).toBe(440);
        expect(result.machine.width).toBe(440);
        expect(result.machine.position).toEqual({ x: result.card.position.x, y: result.card.position.y + result.card.height });
        expect(result.card.metadata?.pairedNodeId).toBe(result.machine.id);
        expect(result.machine.metadata?.pairedNodeId).toBe(result.card.id);
        expect(result.connection).toEqual({ id: "internal", fromNodeId: result.card.id, toNodeId: result.machine.id });
        expect(result.card.position.y + (result.card.height + result.machine.height) / 2).toBe(600);
    });

    test("recognizes only a mutual, correctly typed, adjacent pair with its internal connection", () => {
        const result = plan();
        const nodes = [result.card, result.machine];
        expect(isDockedPair(result.card, result.machine, [result.connection])).toBe(true);
        expect(dockedPairVariant(result.card, nodes, [result.connection])).toBe("top");
        expect(dockedPairVariant(result.machine, nodes, [result.connection])).toBe("bottom");
    });

    test("rejects a missing node, missing marker, wrong type, or one-way marker", () => {
        const result = plan();
        expect(isDockedPair(result.card, undefined, [result.connection])).toBe(false);
        expect(isDockedPair({ ...result.card, metadata: undefined }, result.machine, [result.connection])).toBe(false);
        expect(isDockedPair({ ...result.card, type: CanvasNodeType.Image }, result.machine, [result.connection])).toBe(false);
        expect(isDockedPair(result.card, { ...result.machine, metadata: undefined }, [result.connection])).toBe(false);
    });

    test("accepts geometry within tolerance and rejects geometry outside it", () => {
        const result = plan();
        expect(isDockedPair(result.card, { ...result.machine, position: { x: result.machine.position.x + 3, y: result.machine.position.y + 3 }, width: result.machine.width - 3 }, [result.connection])).toBe(true);
        expect(isDockedPair(result.card, { ...result.machine, position: { x: result.machine.position.x + 4, y: result.machine.position.y } }, [result.connection])).toBe(false);
        expect(isDockedPair(result.card, { ...result.machine, position: { x: result.machine.position.x, y: result.machine.position.y + 4 } }, [result.connection])).toBe(false);
    });

    test("A1 rejects an otherwise valid pair when the internal line is missing", () => {
        const result = plan();
        expect(isDockedPair(result.card, result.machine, [])).toBe(false);
        expect(dockedPairVariant(result.card, [result.card, result.machine], [])).toBeNull();
    });
});

describe("MG-01 hiding and legacy fallback", () => {
    test("hides the retained internal line only when the shared docked-pair decision is true", () => {
        const result = plan();
        expect(shouldHideDockedPairConnection(result.connection, [result.card, result.machine], [result.connection])).toBe(true);
        expect(shouldHideDockedPairConnection(result.connection, [result.card, result.machine], [])).toBe(false);
    });

    test("never hides ordinary, missing-endpoint, or reverse-direction connections", () => {
        const result = plan();
        const image = node("image", CanvasNodeType.Image, -100, 0, 200, 200);
        const ordinary = { id: "ordinary", fromNodeId: image.id, toNodeId: result.machine.id };
        const missing = { id: "missing", fromNodeId: "missing", toNodeId: result.machine.id };
        const reverse = { id: "reverse", fromNodeId: result.machine.id, toNodeId: result.card.id };
        const connections = [result.connection, ordinary, missing, reverse];
        expect(shouldHideDockedPairConnection(ordinary, [image, result.card, result.machine], connections)).toBe(false);
        expect(shouldHideDockedPairConnection(missing, [image, result.card, result.machine], connections)).toBe(false);
        expect(shouldHideDockedPairConnection(reverse, [image, result.card, result.machine], connections)).toBe(false);
    });

    test("keeps legacy intake roles, visible connections, and delete ids unchanged without pairedNodeId", () => {
        const card = node("legacy-card", CanvasNodeType.BatchInfo, 0, 0);
        const machine = node("legacy-machine", CanvasNodeType.Workflow, 0, 540);
        const product = node("product", CanvasNodeType.Image, -300, 540, 200, 200);
        const style = node("style", CanvasNodeType.Image, -300, 0, 200, 200);
        const connections: CanvasConnection[] = [
            { id: "legacy-internal", fromNodeId: card.id, toNodeId: machine.id },
            { id: "product-line", fromNodeId: product.id, toNodeId: machine.id },
            { id: "style-line", fromNodeId: style.id, toNodeId: card.id },
        ];
        const legacyNodes = [card, machine, product, style];
        const roles = applyIntakeRoleBadgesToNodes(legacyNodes, connections);
        expect(roles.find((item) => item.id === product.id)?.metadata?.batchIntakeRole?.role).toBe("product_original");
        expect(roles.find((item) => item.id === style.id)?.metadata?.batchIntakeRole?.role).toBe("style_reference");
        expect(connections.filter((connection) => !shouldHideDockedPairConnection(connection, legacyNodes, connections))).toEqual(connections);
        expect(Array.from(resolvePairedCascadeIds(new Set([card.id]), legacyNodes))).toEqual([card.id]);
    });

    test("keeps both component defaults verbatim while docked variants switch only their merged presentation", () => {
        const legacyBatch = renderBatch();
        const legacyWorkflow = renderWorkflow();
        expect(legacyBatch).toContain("批次信息卡");
        expect(legacyBatch).toContain("只登记批次 · 不生图 · 不收费");
        expect(legacyWorkflow).toContain("零成本彩排 · 费用 0 元");
        expect(legacyWorkflow).toContain(legacyMessage);

        const dockedBatch = renderBatch(true);
        const dockedWorkflow = renderWorkflow(true);
        expect(dockedBatch).toContain("生图工作流");
        expect(dockedBatch).toContain("演示模式 · 批次未登记");
        expect(dockedWorkflow).not.toContain("零成本彩排 · 费用 0 元");
        expect(dockedWorkflow).toContain("产品原图接入口");
    });
});

describe("MG-01 copy, cascade, copy and guidance rules", () => {
    test("remaps a fully copied pair and strips a half-pair marker", () => {
        const result = plan();
        const fullMap = new Map([
            [result.card.id, "card-copy"],
            [result.machine.id, "machine-copy"],
        ]);
        expect(remapPairedNodeId(result.card.metadata, fullMap)?.pairedNodeId).toBe("machine-copy");
        expect(remapPairedNodeId(result.machine.metadata, fullMap)?.pairedNodeId).toBe("card-copy");
        expect(remapPairedNodeId(result.card.metadata, new Map([[result.card.id, "card-copy"]]))?.pairedNodeId).toBeUndefined();
    });

    test("always strips pairedNodeId for single-node duplication without touching other metadata", () => {
        expect(stripPairedNodeId({ pairedNodeId: "machine", status: "success", content: "kept" })).toEqual({ status: "success", content: "kept" });
        expect(stripPairedNodeId({ status: "idle" })).toEqual({ status: "idle" });
    });

    test("adds an existing partner for drag and delete cascades without consulting geometry or connections", () => {
        const result = plan();
        const movedMachine = { ...result.machine, position: { x: 999, y: 999 } };
        expect(Array.from(resolvePairedCascadeIds(new Set([result.card.id]), [result.card, movedMachine]))).toEqual([result.card.id, result.machine.id]);
        expect(Array.from(resolvePairedCascadeIds(new Set([result.machine.id]), [result.card, movedMachine]))).toEqual([result.machine.id, result.card.id]);
        expect(Array.from(resolvePairedCascadeIds(new Set([result.card.id]), [result.card]))).toEqual([result.card.id]);
    });

    test("routes docked guidance through the new literal and preserves the old literal exactly", () => {
        expect(workflowEmptyInputMessage(true, legacyMessage)).toBe("请把至少 1 张产品原图连到下方“产品原图接入口”。");
        expect(workflowEmptyInputMessage(false, legacyMessage)).toBe(legacyMessage);
    });
});

describe("MG-01 A2 resize suppression and integration guards", () => {
    test("suppresses resize handles for a complete four-condition docked pair", () => {
        const result = plan();
        expect(resizeHandleCount(renderShellFromDockedState(result.card, [result.card, result.machine], [result.connection]))).toBe(0);
    });

    test("restores all resize handles when mutual ids remain but the internal line is missing", () => {
        const result = plan();
        expect(resizeHandleCount(renderShellFromDockedState(result.card, [result.card, result.machine], []))).toBe(4);
    });

    test("restores all resize handles when mutual ids remain but geometry is outside tolerance", () => {
        const result = plan();
        const movedMachine = { ...result.machine, position: { ...result.machine.position, y: result.machine.position.y + 4 } };
        expect(resizeHandleCount(renderShellFromDockedState(result.card, [result.card, movedMachine], [result.connection]))).toBe(4);
    });

    test("keeps all resize handles for an ordinary non-paired node", () => {
        const ordinary = node("ordinary", CanvasNodeType.Workflow, 0, 0, 420, 300);
        expect(resizeHandleCount(renderShellFromDockedState(ordinary, [ordinary], []))).toBe(4);
    });

    test("keeps the pure helpers wired into the single toolbar, render filter, copy, drag, delete, and resize paths", () => {
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const toolbarSource = readFileSync(new URL("../src/components/canvas/canvas-toolbar.tsx", import.meta.url), "utf8");
        const executableProjectSource = projectSource.replace(/[/][*][\s\S]*?[*][/]/g, "").replace(/[/][/].*$/gm, "");
        expect(toolbarSource).toContain('label="生图工作流"');
        expect(toolbarSource).not.toContain("onAddBatchInfo");
        expect(executableProjectSource).toContain("createDockedPairPlan({");
        expect(executableProjectSource).toContain("allIds = resolvePairedCascadeIds(allIds, nodesRef.current)");
        expect(executableProjectSource).toContain("dragIds = resolvePairedCascadeIds(dragIds, currentNodes)");
        expect(executableProjectSource).toContain("metadata: stripPairedNodeId(source.metadata)");
        expect(executableProjectSource).toContain("const metadata = remapPairedNodeId(node.metadata, idMap)");
        expect(executableProjectSource).toContain("!shouldHideDockedPairConnection(connection, nodes, connections)");
        expect(executableProjectSource).toContain("suppressResizeHandles={Boolean(dockedVariantByNodeId.get(node.id))}");
        expect(executableProjectSource).not.toContain("resizeSuppressedNodeIds");
    });

    test("removes the retired two-condition helper from production and tests", () => {
        const retiredName = ["hasMutual", "PairedPartner"].join("");
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const helperSource = readFileSync(new URL("../src/lib/canvas/canvas-docked-pair.ts", import.meta.url), "utf8");
        const testSource = readFileSync(new URL("./canvas-docked-pair.test.ts", import.meta.url), "utf8");
        expect(projectSource).not.toContain(retiredName);
        expect(helperSource).not.toContain(retiredName);
        expect(testSource).not.toContain(retiredName);
    });
});
