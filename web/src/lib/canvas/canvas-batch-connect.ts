import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

/** 宿主能力端口：两个判据都由 project.tsx 注入其既有实现，模块内不得自行实现。 */
export type BatchConnectHost = {
    normalizeConnection: (
        firstNodeId: string,
        secondNodeId: string,
        nodes: CanvasNodeData[],
        firstHandleType: "source" | "target",
    ) => { fromNodeId: string; toNodeId: string } | null;
    isNodeHidden: (node: CanvasNodeData) => boolean;
};

export type BatchConnectSkipReason = "target" | "missing" | "hidden" | "invalid" | "duplicate";

export type BatchConnectPlan = {
    isBatch: boolean;
    additions: Array<{ fromNodeId: string; toNodeId: string }>;
    skipped: Array<{ nodeId: string; reason: BatchConnectSkipReason }>;
    connectedCount: number;
    duplicateCount: number;
    rejectedCount: number;
};

export type BatchConnectNotice = {
    message: string;
    severity: "info" | "warning";
} | null;

type SkipCountCategory = "duplicateCount" | "rejectedCount" | null;

const SKIP_COUNT_CATEGORY = {
    target: null,
    missing: null,
    hidden: "rejectedCount",
    invalid: "rejectedCount",
    duplicate: "duplicateCount",
} as const satisfies Record<BatchConnectSkipReason, SkipCountCategory>;

/** 今天既有的单条拒绝文案，逐字不得改动。 */
export const CONFIG_CONNECTION_REJECTED_MESSAGE = "配置节点之间不能连接";

/** 决策层：算出该加哪些连线、跳过哪些、为什么。 */
export function planBatchConnections(input: {
    originNodeId: string;
    targetNodeId: string;
    selectedNodeIds: ReadonlySet<string>;
    nodes: CanvasNodeData[];
    existingConnections: CanvasConnection[];
    handleType: "source" | "target";
    host: BatchConnectHost;
}): BatchConnectPlan {
    const { originNodeId, targetNodeId, selectedNodeIds, nodes, existingConnections, handleType, host } = input;
    const isBatch = selectedNodeIds.has(originNodeId) && selectedNodeIds.size > 1;
    const sourceNodeIds = isBatch ? nodes.filter((node) => selectedNodeIds.has(node.id)).map((node) => node.id) : [originNodeId];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const knownPairs = new Set(existingConnections.map((connection) => connectionPairKey(connection.fromNodeId, connection.toNodeId)));
    const additions: BatchConnectPlan["additions"] = [];
    const skipped: BatchConnectPlan["skipped"] = [];

    for (const nodeId of sourceNodeIds) {
        if (nodeId === targetNodeId) {
            skipped.push({ nodeId, reason: "target" });
            continue;
        }

        const node = nodeById.get(nodeId);
        if (!node) {
            skipped.push({ nodeId, reason: "missing" });
            continue;
        }
        if (host.isNodeHidden(node)) {
            skipped.push({ nodeId, reason: "hidden" });
            continue;
        }

        const connection = host.normalizeConnection(nodeId, targetNodeId, nodes, handleType);
        if (!connection) {
            skipped.push({ nodeId, reason: "invalid" });
            continue;
        }

        const pairKey = connectionPairKey(connection.fromNodeId, connection.toNodeId);
        if (knownPairs.has(pairKey)) {
            skipped.push({ nodeId, reason: "duplicate" });
            continue;
        }

        knownPairs.add(pairKey);
        additions.push(connection);
    }

    const counts = skipped.reduce(
        (current, item) => {
            const category = SKIP_COUNT_CATEGORY[item.reason];
            if (category) current[category] += 1;
            return current;
        },
        { duplicateCount: 0, rejectedCount: 0 },
    );

    return {
        isBatch,
        additions,
        skipped,
        connectedCount: additions.length,
        ...counts,
    };
}

/** 表达层：把计划翻译成给用户看的一句话。 */
export function describeBatchConnectResult(plan: BatchConnectPlan): BatchConnectNotice {
    // 单条路径保留既有逐字文案合同；批量路径才使用汇总文案，不能合并为同一提示逻辑。
    if (!plan.isBatch) {
        return plan.skipped.length === 1 && plan.skipped[0].reason === "invalid"
            ? { message: CONFIG_CONNECTION_REJECTED_MESSAGE, severity: "warning" }
            : null;
    }

    if (plan.duplicateCount === 0 && plan.rejectedCount === 0) return null;

    const segments: string[] = [];
    if (plan.connectedCount > 0) segments.push(`已连接 ${plan.connectedCount} 条`);
    if (plan.duplicateCount > 0) segments.push(`${plan.duplicateCount} 条已存在`);
    if (plan.rejectedCount > 0) segments.push(`${plan.rejectedCount} 个节点不能连接到这里`);
    return {
        message: `${segments.join("，")}。`,
        severity: plan.connectedCount > 0 ? "info" : "warning",
    };
}

/** 组装层：生成带唯一 id 的连线对象。 */
export function buildConnectionsToAdd(additions: Array<{ fromNodeId: string; toNodeId: string }>): CanvasConnection[] {
    const stamp = Date.now();
    return additions.map((addition, index) => ({
        id: `conn-${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        ...addition,
    }));
}

function connectionPairKey(fromNodeId: string, toNodeId: string) {
    return `${fromNodeId}\u0000${toNodeId}`;
}
