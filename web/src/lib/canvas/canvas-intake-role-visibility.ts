import {
    CanvasNodeType,
    type CanvasBatchIntakeRoleMetadata,
    type CanvasConnection,
    type CanvasNodeData,
} from "@/types/canvas";


export type IntakeRoleBadgeView = {
    text: string;
    tone: "product" | "style" | "conflict";
};


export function applyIntakeRoleBadgesToNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const assignments = intakeRoleAssignments(nodes, connections);
    let changed = false;
    const nextNodes = nodes.map((node) => {
        if (node.type !== CanvasNodeType.Image) return node;
        const current = node.metadata?.batchIntakeRole;
        const next = assignments.get(node.id);
        if (sameRole(current, next)) return node;
        changed = true;
        if (!next) {
            const { batchIntakeRole: _removed, ...metadata } = node.metadata || {};
            return { ...node, metadata };
        }
        return { ...node, metadata: { ...node.metadata, batchIntakeRole: next } };
    });
    return changed ? nextNodes : nodes;
}


export function intakeRoleBadgesNeedApplication(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return applyIntakeRoleBadgesToNodes(nodes, connections) !== nodes;
}


export function intakeRoleBadgeView(role?: CanvasBatchIntakeRoleMetadata): IntakeRoleBadgeView | null {
    if (!role) return null;
    if (role.role === "conflict") return { text: "原图 / 风格冲突", tone: "conflict" };
    if (role.role === "style_reference") return { text: "风格参考", tone: "style" };
    return {
        text: role.count && role.count > 1 ? `产品原图 ${role.index}` : "产品原图",
        tone: "product",
    };
}


export function composeImageBadgeStack<T>(role: IntakeRoleBadgeView | null, qc: T | null) {
    return { visible: Boolean(role || qc), role, qc };
}


export function batchRegistrationButtonLabel(count: number, busy: boolean, blocked: boolean) {
    if (blocked) return "已硬停止，请等待裁决";
    return `${busy ? "正在登记" : "登记"} ${count} 张产品原图`;
}


export function styleSupplementButtonLabel(count: number, busy: boolean, blocked: boolean) {
    if (blocked) return "补登已硬停止";
    return `${busy ? "正在补登" : "补登"} ${count} 张风格参考图`;
}


function intakeRoleAssignments(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const productRoles = new Map<string, CanvasBatchIntakeRoleMetadata>();
    const workflowIds = nodes.filter((node) => node.type === CanvasNodeType.Workflow).map((node) => node.id);
    workflowIds.forEach((workflowId) => {
        const imageIds = uniqueStrings(
            connections
                .filter((connection) => connection.toNodeId === workflowId && nodesById.get(connection.fromNodeId)?.type === CanvasNodeType.Image)
                .map((connection) => connection.fromNodeId),
        );
        imageIds.forEach((nodeId, index) => {
            if (!productRoles.has(nodeId)) {
                productRoles.set(nodeId, {
                    role: "product_original",
                    index: index + 1,
                    count: imageIds.length,
                });
            }
        });
    });
    const styleIds = new Set(
        connections
            .filter((connection) => nodesById.get(connection.toNodeId)?.type === CanvasNodeType.BatchInfo && nodesById.get(connection.fromNodeId)?.type === CanvasNodeType.Image)
            .map((connection) => connection.fromNodeId),
    );
    const assignments = new Map<string, CanvasBatchIntakeRoleMetadata>();
    nodes.forEach((node) => {
        if (node.type !== CanvasNodeType.Image) return;
        const product = productRoles.get(node.id);
        const style = styleIds.has(node.id);
        if (product && style) assignments.set(node.id, { role: "conflict" });
        else if (product) assignments.set(node.id, product);
        else if (style) assignments.set(node.id, { role: "style_reference" });
    });
    return assignments;
}


function sameRole(first?: CanvasBatchIntakeRoleMetadata, second?: CanvasBatchIntakeRoleMetadata) {
    return first?.role === second?.role && first?.index === second?.index && first?.count === second?.count;
}


function uniqueStrings(values: string[]) {
    return Array.from(new Set(values));
}
