import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

export const DOCKED_PAIR_GEOMETRY_TOLERANCE = 3;
export const DOCKED_WORKFLOW_EMPTY_INPUT_MESSAGE = "请把至少 1 张产品原图连到下方“产品原图接入口”。";

type DockedNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export type DockedPairPlan = {
    card: CanvasNodeData;
    machine: CanvasNodeData;
    connection: CanvasConnection;
};

export type DockedPairVariant = "top" | "bottom";

export function createDockedPairPlan(input: {
    center: Position;
    cardId: string;
    machineId: string;
    connectionId: string;
    cardSpec: DockedNodeSpec;
    machineSpec: DockedNodeSpec;
}): DockedPairPlan {
    const { center, cardId, machineId, connectionId, cardSpec, machineSpec } = input;
    const width = Math.max(cardSpec.width, machineSpec.width);
    const totalHeight = cardSpec.height + machineSpec.height;
    const x = center.x - width / 2;
    const cardY = center.y - totalHeight / 2;
    const card: CanvasNodeData = {
        id: cardId,
        type: CanvasNodeType.BatchInfo,
        title: cardSpec.title,
        position: { x, y: cardY },
        width,
        height: cardSpec.height,
        metadata: { ...cardSpec.metadata, pairedNodeId: machineId },
    };
    const machine: CanvasNodeData = {
        id: machineId,
        type: CanvasNodeType.Workflow,
        title: machineSpec.title,
        position: { x, y: cardY + card.height },
        width,
        height: machineSpec.height,
        metadata: { ...machineSpec.metadata, pairedNodeId: cardId },
    };
    return {
        card,
        machine,
        connection: { id: connectionId, fromNodeId: cardId, toNodeId: machineId },
    };
}

export function isDockedPair(card: CanvasNodeData | undefined, machine: CanvasNodeData | undefined, connections: readonly CanvasConnection[], tolerance = DOCKED_PAIR_GEOMETRY_TOLERANCE) {
    if (!card || !machine || card.type !== CanvasNodeType.BatchInfo || machine.type !== CanvasNodeType.Workflow) return false;
    if (card.metadata?.pairedNodeId !== machine.id || machine.metadata?.pairedNodeId !== card.id) return false;
    if (Math.abs(card.position.x - machine.position.x) > tolerance || Math.abs(card.width - machine.width) > tolerance || Math.abs(machine.position.y - (card.position.y + card.height)) > tolerance) return false;
    return connections.some((connection) => connection.fromNodeId === card.id && connection.toNodeId === machine.id);
}

export function dockedPairVariant(node: CanvasNodeData, nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[]): DockedPairVariant | null {
    const partner = pairedPartner(node, nodes);
    if (!partner) return null;
    if (node.type === CanvasNodeType.BatchInfo && isDockedPair(node, partner, connections)) return "top";
    if (node.type === CanvasNodeType.Workflow && isDockedPair(partner, node, connections)) return "bottom";
    return null;
}

export function shouldHideDockedPairConnection(connection: CanvasConnection, nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[]) {
    const first = nodes.find((node) => node.id === connection.fromNodeId);
    const second = nodes.find((node) => node.id === connection.toNodeId);
    if (!first || !second) return false;
    const card = first.type === CanvasNodeType.BatchInfo ? first : second.type === CanvasNodeType.BatchInfo ? second : undefined;
    const machine = first.type === CanvasNodeType.Workflow ? first : second.type === CanvasNodeType.Workflow ? second : undefined;
    return Boolean(card && machine && connection.fromNodeId === card.id && connection.toNodeId === machine.id && isDockedPair(card, machine, connections));
}

export function resolvePairedCascadeIds(seedIds: ReadonlySet<string>, nodes: readonly CanvasNodeData[]) {
    const ids = new Set(seedIds);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    Array.from(seedIds).forEach((id) => {
        const partnerId = nodeById.get(id)?.metadata?.pairedNodeId;
        if (partnerId && nodeById.has(partnerId)) ids.add(partnerId);
    });
    return ids;
}

export function stripPairedNodeId(metadata?: CanvasNodeMetadata) {
    if (!metadata || !("pairedNodeId" in metadata)) return metadata;
    const { pairedNodeId: _pairedNodeId, ...rest } = metadata;
    return rest;
}

export function remapPairedNodeId(metadata: CanvasNodeMetadata | undefined, idMap: ReadonlyMap<string, string>) {
    if (!metadata?.pairedNodeId) return metadata;
    const pairedNodeId = idMap.get(metadata.pairedNodeId);
    return pairedNodeId ? { ...metadata, pairedNodeId } : stripPairedNodeId(metadata);
}

export function workflowEmptyInputMessage(docked: boolean, legacyMessage: string) {
    return docked ? DOCKED_WORKFLOW_EMPTY_INPUT_MESSAGE : legacyMessage;
}

function pairedPartner(node: CanvasNodeData, nodes: readonly CanvasNodeData[]) {
    const partnerId = node.metadata?.pairedNodeId;
    return partnerId ? nodes.find((candidate) => candidate.id === partnerId) : undefined;
}
