import { describe, expect, test } from "bun:test";

import {
    CONFIG_CONNECTION_REJECTED_MESSAGE,
    buildConnectionsToAdd,
    describeBatchConnectResult,
    planBatchConnections,
    type BatchConnectHost,
    type BatchConnectPlan,
} from "../src/lib/canvas/canvas-batch-connect";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

function node(id: string, type = CanvasNodeType.Image): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100 };
}

function connection(fromNodeId: string, toNodeId: string, id = `${fromNodeId}-${toNodeId}`): CanvasConnection {
    return { id, fromNodeId, toNodeId };
}

function createHost(hiddenNodeIds: ReadonlySet<string> = new Set()): BatchConnectHost {
    return {
        normalizeConnection(firstNodeId, secondNodeId, nodes, firstHandleType) {
            const first = nodes.find((item) => item.id === firstNodeId);
            const second = nodes.find((item) => item.id === secondNodeId);
            if (!first || !second || first.id === second.id) return null;
            if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
            if (first.type === CanvasNodeType.Workflow && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
            if (first.type === CanvasNodeType.BatchInfo && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
            if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
            if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
            if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
            if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
            return { fromNodeId: first.id, toNodeId: second.id };
        },
        isNodeHidden: (item) => hiddenNodeIds.has(item.id),
    };
}

function plan(overrides: Partial<Parameters<typeof planBatchConnections>[0]> = {}) {
    const nodes = overrides.nodes || [node("origin"), node("target")];
    return planBatchConnections({
        originNodeId: "origin",
        targetNodeId: "target",
        selectedNodeIds: new Set(),
        nodes,
        existingConnections: [],
        handleType: "source",
        host: createHost(),
        ...overrides,
    });
}

function noticePlan(overrides: Partial<BatchConnectPlan>): BatchConnectPlan {
    return {
        isBatch: true,
        additions: [],
        skipped: [],
        connectedCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
        ...overrides,
    };
}

describe("BC-01 batch connection contract", () => {
    test("T0 keeps the single-source path when only the origin itself is selected", () => {
        const result = plan({
            nodes: [node("origin", CanvasNodeType.Config), node("target", CanvasNodeType.Config)],
            selectedNodeIds: new Set(["origin"]),
        });

        expect(result.isBatch).toBe(false);
        expect(describeBatchConnectResult(result)).toEqual({
            message: CONFIG_CONNECTION_REJECTED_MESSAGE,
            severity: "warning",
        });
    });

    test("T1 keeps the single-source path when the origin is not selected", () => {
        const result = plan({ selectedNodeIds: new Set(["other", "target"]) });

        expect(result.isBatch).toBe(false);
        expect(result.additions).toEqual([{ fromNodeId: "origin", toNodeId: "target" }]);
        expect(describeBatchConnectResult(result)).toBeNull();
    });

    test("T2 keeps a single self-connection silent", () => {
        const result = plan({ targetNodeId: "origin" });

        expect(result.additions).toEqual([]);
        expect(result.skipped).toEqual([{ nodeId: "origin", reason: "target" }]);
        expect(describeBatchConnectResult(result)).toBeNull();
    });

    test("T3 keeps the existing single invalid-connection wording exactly", () => {
        const result = plan({
            nodes: [node("origin", CanvasNodeType.Config), node("target", CanvasNodeType.Config)],
        });

        expect(result.additions).toEqual([]);
        expect(describeBatchConnectResult(result)).toEqual({
            message: CONFIG_CONNECTION_REJECTED_MESSAGE,
            severity: "warning",
        });
        expect(CONFIG_CONNECTION_REJECTED_MESSAGE).toBe("配置节点之间不能连接");
    });

    test("T4 keeps an existing single connection silent", () => {
        const result = plan({ existingConnections: [connection("origin", "target")] });

        expect(result.additions).toEqual([]);
        expect(result.skipped).toEqual([{ nodeId: "origin", reason: "duplicate" }]);
        expect(describeBatchConnectResult(result)).toBeNull();
    });

    test("T5 adds every selected valid source in node-array order", () => {
        const nodes = [node("third"), node("origin"), node("second"), node("target")];
        const result = plan({ nodes, selectedNodeIds: new Set(["origin", "second", "third"]) });

        expect(result.isBatch).toBe(true);
        expect(result.additions).toEqual([
            { fromNodeId: "third", toNodeId: "target" },
            { fromNodeId: "origin", toNodeId: "target" },
            { fromNodeId: "second", toNodeId: "target" },
        ]);
        expect(result.connectedCount).toBe(3);
    });

    test("T6 skips a selected group as invalid and counts it as rejected", () => {
        const nodes = [node("origin"), node("group", CanvasNodeType.Group), node("target")];
        const result = plan({ nodes, selectedNodeIds: new Set(["origin", "group"]) });

        expect(result.additions).toEqual([{ fromNodeId: "origin", toNodeId: "target" }]);
        expect(result.skipped).toContainEqual({ nodeId: "group", reason: "invalid" });
        expect(result.rejectedCount).toBe(1);
    });

    test("T7 skips Config-to-Config through the injected normalization rule", () => {
        const nodes = [node("origin", CanvasNodeType.Config), node("other", CanvasNodeType.Image), node("target", CanvasNodeType.Config)];
        const result = plan({ nodes, selectedNodeIds: new Set(["origin", "other"]) });

        expect(result.skipped).toContainEqual({ nodeId: "origin", reason: "invalid" });
        expect(result.additions).toEqual([{ fromNodeId: "other", toNodeId: "target" }]);
        expect(result.rejectedCount).toBe(1);
    });

    test("T8 skips the selected target without counting or mentioning it", () => {
        const result = plan({ selectedNodeIds: new Set(["origin", "target"]) });

        expect(result.skipped).toEqual([{ nodeId: "target", reason: "target" }]);
        expect(result.connectedCount).toBe(1);
        expect(result.duplicateCount).toBe(0);
        expect(result.rejectedCount).toBe(0);
        expect(describeBatchConnectResult(result)).toBeNull();
    });

    test("T9 skips an existing pair instead of adding it again", () => {
        const nodes = [node("origin"), node("other"), node("target")];
        const result = plan({
            nodes,
            selectedNodeIds: new Set(["origin", "other"]),
            existingConnections: [connection("origin", "target")],
        });

        expect(result.additions).toEqual([{ fromNodeId: "other", toNodeId: "target" }]);
        expect(result.skipped).toContainEqual({ nodeId: "origin", reason: "duplicate" });
        expect(result.duplicateCount).toBe(1);
    });

    test("T10 skips a hidden batch child and counts it as rejected", () => {
        const nodes = [node("origin"), node("hidden"), node("target")];
        const result = plan({
            nodes,
            selectedNodeIds: new Set(["origin", "hidden"]),
            host: createHost(new Set(["hidden"])),
        });

        expect(result.additions).toEqual([{ fromNodeId: "origin", toNodeId: "target" }]);
        expect(result.skipped).toContainEqual({ nodeId: "hidden", reason: "hidden" });
        expect(result.rejectedCount).toBe(1);
    });

    test("T11 normalizes every selected source independently, including opposite directions", () => {
        const nodes = [
            node("image"),
            node("workflow", CanvasNodeType.Workflow),
            node("batch", CanvasNodeType.BatchInfo),
            node("config", CanvasNodeType.Config),
            node("target"),
        ];
        const result = plan({
            originNodeId: "image",
            nodes,
            selectedNodeIds: new Set(["image", "workflow", "batch", "config"]),
            handleType: "target",
        });

        expect(result.additions).toEqual([
            { fromNodeId: "image", toNodeId: "target" },
            { fromNodeId: "target", toNodeId: "workflow" },
            { fromNodeId: "target", toNodeId: "batch" },
            { fromNodeId: "target", toNodeId: "config" },
        ]);
    });

    test("T12 warns when a batch has no connectable source", () => {
        const nodes = [node("origin", CanvasNodeType.Group), node("other", CanvasNodeType.Group), node("target")];
        const result = plan({ nodes, selectedNodeIds: new Set(["origin", "other"]) });

        expect(result.connectedCount).toBe(0);
        expect(describeBatchConnectResult(result)).toEqual({
            message: "2 个节点不能连接到这里。",
            severity: "warning",
        });
    });

    test("T13 keeps a fully successful batch silent", () => {
        const nodes = [node("origin"), node("other"), node("target")];
        const result = plan({ nodes, selectedNodeIds: new Set(["origin", "other"]) });

        expect(result.connectedCount).toBe(2);
        expect(describeBatchConnectResult(result)).toBeNull();
    });

    test("T14 describes all three non-zero result segments exactly", () => {
        const notice = describeBatchConnectResult(noticePlan({ connectedCount: 2, duplicateCount: 1, rejectedCount: 3 }));

        expect(notice).toEqual({ message: "已连接 2 条，1 条已存在，3 个节点不能连接到这里。", severity: "info" });
    });

    test("T14 describes duplicate-only and rejected-only batches exactly", () => {
        expect(describeBatchConnectResult(noticePlan({ duplicateCount: 2 }))).toEqual({ message: "2 条已存在。", severity: "warning" });
        expect(describeBatchConnectResult(noticePlan({ rejectedCount: 4 }))).toEqual({ message: "4 个节点不能连接到这里。", severity: "warning" });
    });

    test("T15 de-duplicates against pairs already accumulated in this batch", () => {
        const nodes = [node("origin"), node("other"), node("target")];
        const result = plan({
            nodes,
            selectedNodeIds: new Set(["origin", "other"]),
            host: {
                normalizeConnection: () => ({ fromNodeId: "shared", toNodeId: "target" }),
                isNodeHidden: () => false,
            },
        });

        expect(result.additions).toEqual([{ fromNodeId: "shared", toNodeId: "target" }]);
        expect(result.skipped).toEqual([{ nodeId: "other", reason: "duplicate" }]);
        expect(result.duplicateCount).toBe(1);
    });

    test("T16 creates unique ids while preserving every connection pair", () => {
        const additions = Array.from({ length: 24 }, (_, index) => ({ fromNodeId: `from-${index}`, toNodeId: `to-${index}` }));
        const built = buildConnectionsToAdd(additions);

        expect(built).toHaveLength(additions.length);
        expect(new Set(built.map((item) => item.id)).size).toBe(additions.length);
        expect(built.map(({ fromNodeId, toNodeId }) => ({ fromNodeId, toNodeId }))).toEqual(additions);
    });
});
