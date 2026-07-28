import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { readExpectedImageSet, WORKFLOW_COUNT_DATA_MISSING_MESSAGE } from "@/lib/canvas/canvas-workflow-production";

const PRODUCTION_ORIGIN = "http://127.0.0.1:17373";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type ReceivingSelection = { configId: string; source: "renders" | "repaired"; sha256: string };

export function receivingBoxId(batchId: string) {
    return `wfprod-receiving:${batchId}`;
}

export function createReceivingBox(machine: CanvasNodeData, batchId: string): CanvasNodeData {
    const countInfo = readExpectedImageSet(machine.metadata?.workflowProduction?.totalCount, machine.metadata?.workflowProduction?.expectedConfigIds);
    if (!countInfo) throw new Error(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
    return {
        id: receivingBoxId(batchId),
        type: CanvasNodeType.Group,
        title: "已收货",
        position: { x: machine.position.x, y: machine.position.y + machine.height + 180 },
        width: 820,
        height: 560,
        metadata: {
            workflowReceivingBox: {
                status: "open",
                batchId,
                workflowNodeId: machine.id,
                selectionCount: 0,
                totalCount: countInfo.totalCount,
                expectedConfigIds: countInfo.expectedConfigIds,
                message: "把满意的正式图或返修图拖进来。",
            },
        },
    };
}

export function receivingSelections(box: CanvasNodeData, nodes: CanvasNodeData[]): ReceivingSelection[] {
    const state = box.metadata?.workflowReceivingBox;
    if (box.type !== CanvasNodeType.Group || !state) return [];
    const countInfo = readExpectedImageSet(state.totalCount, state.expectedConfigIds);
    if (!countInfo) return [];
    const configIdSet = new Set(countInfo.expectedConfigIds);
    const selected = new Map<string, ReceivingSelection>();
    nodes.forEach((node) => {
        if (node.metadata?.groupId !== box.id) return;
        const proof = verifiedReceivingProof(node, state.batchId, configIdSet);
        if (proof) selected.set(proof.configId, proof);
    });
    return countInfo.expectedConfigIds.flatMap((configId) => {
        const value = selected.get(configId);
        return value ? [value] : [];
    });
}

export function snapNodesIntoReceivingBox(movedIds: Set<string>, nodes: CanvasNodeData[], box: CanvasNodeData) {
    const state = box.metadata?.workflowReceivingBox;
    if (!state) return nodes;
    const countInfo = readExpectedImageSet(state.totalCount, state.expectedConfigIds);
    if (!countInfo) return nodes;
    const configIdSet = new Set(countInfo.expectedConfigIds);
    const moving = nodes.filter((node) => movedIds.has(node.id));
    const winners = new Map<string, string>();
    moving.forEach((node) => {
        const proof = verifiedReceivingProof(node, state.batchId, configIdSet);
        if (proof) winners.set(proof.configId, node.id);
    });
    if (!winners.size) return nodes;
    const eligibleIds = new Set(winners.values());
    const eligible = moving.filter((node) => eligibleIds.has(node.id));
    const bounds = nodeBounds(eligible);
    const pad = 28;
    const left = box.position.x + pad;
    const top = box.position.y + 76;
    const right = box.position.x + box.width - pad;
    const bottom = box.position.y + box.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        const proof = verifiedReceivingProof(node, state.batchId, configIdSet);
        const winnerId = proof ? winners.get(proof.configId) : undefined;
        if (node.metadata?.groupId === box.id && winnerId && node.id !== winnerId) {
            const { groupId: _removed, ...metadata } = node.metadata || {};
            return { ...node, position: { x: box.position.x - node.width - 36, y: node.position.y }, metadata };
        }
        if (!eligibleIds.has(node.id)) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: box.id } };
    });
}

export function buildAcceptancePayload(box: CanvasNodeData, nodes: CanvasNodeData[], requestId: string) {
    const state = box.metadata?.workflowReceivingBox;
    if (!state) throw new Error("已收货框信息不完整。");
    const countInfo = readExpectedImageSet(state.totalCount, state.expectedConfigIds);
    if (!countInfo) throw new Error(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
    const selections = receivingSelections(box, nodes);
    if (selections.length !== countInfo.totalCount) throw new Error(`必须先收满 ${countInfo.totalCount} 个不同图位。`);
    return { requestId, machineId: state.workflowNodeId, selections };
}

export function receivingBoxView(box: CanvasNodeData, nodes: CanvasNodeData[]) {
    const state = box.metadata?.workflowReceivingBox;
    const countInfo = readExpectedImageSet(state?.totalCount, state?.expectedConfigIds);
    const count = receivingSelections(box, nodes).length;
    return {
        count,
        totalCount: countInfo?.totalCount,
        label: countInfo ? `已收 ${count}/${countInfo.totalCount}` : WORKFLOW_COUNT_DATA_MISSING_MESSAGE,
        canConfirm: Boolean(countInfo && count === countInfo.totalCount && state && state.status !== "submitting" && state.status !== "closed"),
        closed: state?.status === "closed",
        errorMessage: countInfo ? undefined : WORKFLOW_COUNT_DATA_MISSING_MESSAGE,
    };
}

export async function fetchAcceptanceStatus(batchId: string, token: string, fetcher: typeof fetch = globalThis.fetch) {
    const url = acceptanceUrl(batchId);
    if (!url || !token.trim()) throw new Error("本机收货服务尚未就绪。");
    const response = await fetcher(url, { method: "GET", headers: { "X-Canvas-Agent-Token": token.trim() } });
    if (!response.ok) throw new Error("本机收货服务尚未就绪。");
    const payload: unknown = await response.json();
    if (!validStatus(payload, batchId)) throw new Error(statusCountError(payload) ? WORKFLOW_COUNT_DATA_MISSING_MESSAGE : "本机收货状态不可信。");
    return payload;
}

export async function submitAcceptanceCloseout(batchId: string, token: string, payload: ReturnType<typeof buildAcceptancePayload>, fetcher: typeof fetch = globalThis.fetch) {
    const url = acceptanceUrl(batchId);
    if (!url || !token.trim()) throw new Error("本机收货服务尚未就绪。");
    const response = await fetcher(url, {
        method: "POST",
        headers: { "X-Canvas-Agent-Token": token.trim(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(response.status === 409 ? "本批次已关账，不能重复关账。" : "关账核对没有通过，请保留画布并检查收货图片。");
    const result: unknown = await response.json();
    const expectedIds = payload.selections.map((item) => item.configId);
    if (!validStatus(result, batchId) || result.status !== "closed" || !sameIds(result.expectedConfigIds, expectedIds)) {
        throw new Error(statusCountError(result) ? WORKFLOW_COUNT_DATA_MISSING_MESSAGE : "本机没有返回可信的关账回执。");
    }
    return result;
}

function verifiedReceivingProof(node: CanvasNodeData, batchId: string, configIdSet: ReadonlySet<string>): ReceivingSelection | null {
    const proof = node.metadata?.workflowProductionOutput;
    if (node.type !== CanvasNodeType.Image || !node.metadata?.storageKey || !proof || proof.batchId !== batchId || !configIdSet.has(proof.configId) || !SHA256_PATTERN.test(proof.sha256) || (proof.source !== "renders" && proof.source !== "repaired")) return null;
    return { configId: proof.configId, source: proof.source, sha256: proof.sha256 };
}

function acceptanceUrl(batchId: string) {
    return batchId ? `${PRODUCTION_ORIGIN}/workflow-production/${encodeURIComponent(batchId)}/acceptance-closeout` : null;
}

function validStatus(payload: unknown, batchId: string): payload is { ok: true; batchId: string; status: "open" | "closed"; totalCount: number; expectedConfigIds: string[]; closedAt?: string } {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as { ok?: unknown; batchId?: unknown; status?: unknown; totalCount?: unknown; expectedConfigIds?: unknown; closedAt?: unknown };
    return Boolean(
        value.ok === true &&
            value.batchId === batchId &&
            (value.status === "open" || value.status === "closed") &&
            readExpectedImageSet(value.totalCount, value.expectedConfigIds) &&
            (value.closedAt === undefined || typeof value.closedAt === "string"),
    );
}

function statusCountError(payload: unknown) {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as { ok?: unknown; totalCount?: unknown; expectedConfigIds?: unknown };
    return value.ok === true && !readExpectedImageSet(value.totalCount, value.expectedConfigIds);
}

function sameIds(first: string[], second: string[]) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}
