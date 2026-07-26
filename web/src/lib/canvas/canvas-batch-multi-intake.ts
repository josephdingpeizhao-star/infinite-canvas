import { nanoid } from "nanoid";

import {
    readBatchIntakeState,
    resolveBatchIntakeSelection,
    validateBatchIntakeFacts,
} from "@/lib/canvas/canvas-batch-intake";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import type { UploadedImage } from "@/services/image-storage";
import {
    CanvasNodeType,
    type CanvasBatchSourceFile,
    type CanvasConnection,
    type CanvasNodeData,
    type Position,
} from "@/types/canvas";

export const BATCH_MULTI_INTAKE_MAX_FILES = 12;
export const BATCH_MULTI_INTAKE_HEALTH_URL = "http://127.0.0.1:17373/workbench-health";

export const BATCH_MULTI_INTAKE_MESSAGES = {
    invalidSelection: "请选择 1–12 张有效的产品图片，本次整批未导入。",
    tooMany: (count: number) =>
        `一次最多选择 12 张产品原图。本次选择了 ${count} 张，整批未导入，请重新选择。`,
    cardUnavailable: "批次信息卡已不存在，本次整批未导入。",
    cardBusy: "这张信息卡正在登记，请等待本次登记结束。",
    cardCompleted: "这个批次已经登记完成，不会再次添加产品原图。",
    integrityBlocked: "原图完整性核对已经硬停止，请保留现场并等待裁决。",
    serviceNotRunning: "本机画布工作台没有启动，本次尚未导入，也未发出登记。",
    workerStopped: "本机建批接单工人已停止，需要重新启动画布服务后再试。",
    reconnecting: "画布正在重新连接，本次尚未导入，也未发出登记；连接稳定后请重新点击。",
    canvasChanged: "画布连线或原图清单在导入期间发生了变化，本次整批未导入，请重新选择。",
    localFailure: (index: number, name: string) =>
        `第 ${index} 张“${name}”读取失败，本次整批未导入且不会自动重试。`,
    cleanupFailure: "本次导入失败，浏览器临时文件未能完整清理；画布没有新增节点或连线，请保留现场并等待处理。",
    busy: "产品原图正在导入，请等待本次操作结束。",
} as const;

export type BatchMultiIntakeProof = {
    file: File;
    sourceFile: CanvasBatchSourceFile;
};

export type BatchMultiIntakeItem = BatchMultiIntakeProof & {
    image: UploadedImage;
};

export type BatchMultiIntakeSnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type BatchMultiIntakeCommit = BatchMultiIntakeSnapshot & {
    newNodes: CanvasNodeData[];
    newConnections: CanvasConnection[];
};

export type BatchMultiIntakeDependencies = {
    getSnapshot: () => BatchMultiIntakeSnapshot;
    createSourceFile: (file: File) => Promise<CanvasBatchSourceFile>;
    checkHealth: () => Promise<{ ok: true } | { ok: false; message: string }>;
    uploadImage: (file: File) => Promise<UploadedImage>;
    deleteStoredImages: (keys: Iterable<string>) => Promise<void>;
    commit: (result: BatchMultiIntakeCommit) => void;
    register: (cardId: string) => void;
    idFactory?: () => string;
};

export function resolveBatchMultiIntakeSelection(
    cardId: string,
    proofs: BatchMultiIntakeProof[],
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): { ok: true; workflowNodeId: string; sourceSignature: string } | { ok: false; message: string } {
    if (!proofs.length) return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.invalidSelection };
    if (proofs.length > BATCH_MULTI_INTAKE_MAX_FILES) {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.tooMany(proofs.length) };
    }
    if (
        proofs.some(
            ({ file, sourceFile }) =>
                !file.type.startsWith("image/") ||
                file.size <= 0 ||
                sourceFile.name !== file.name ||
                sourceFile.size !== file.size ||
                sourceFile.type !== file.type ||
                sourceFile.lastModified !== file.lastModified ||
                !/^[0-9a-f]{64}$/i.test(sourceFile.sha256),
        )
    ) {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.invalidSelection };
    }

    const cardCheck = validateCard(cardId, nodes);
    if (!cardCheck.ok) return cardCheck;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const workflowIds = Array.from(
        new Set(
            connections
                .filter(
                    (connection) =>
                        connection.fromNodeId === cardId &&
                        nodeById.get(connection.toNodeId)?.type === CanvasNodeType.Workflow,
                )
                .map((connection) => connection.toNodeId),
        ),
    );
    const usedIds = new Set(nodes.map((node) => node.id));
    const virtualNodes = proofs.map((proof, index): CanvasNodeData => {
        let id = `mu01-preflight-${index + 1}`;
        while (usedIds.has(id)) id = `${id}-candidate`;
        usedIds.add(id);
        return {
            id,
            type: CanvasNodeType.Image,
            title: proof.sourceFile.name,
            position: { x: 0, y: 0 },
            width: 1,
            height: 1,
            metadata: {
                storageKey: `image:mu01-preflight:${index + 1}`,
                sourceFile: proof.sourceFile,
            },
        };
    });
    const virtualConnections = virtualNodes.flatMap((node, nodeIndex) =>
        workflowIds.map(
            (workflowNodeId, workflowIndex): CanvasConnection => ({
                id: `mu01-preflight-connection-${nodeIndex + 1}-${workflowIndex + 1}`,
                fromNodeId: node.id,
                toNodeId: workflowNodeId,
            }),
        ),
    );
    const candidateNodes = [...nodes, ...virtualNodes];
    const selection = resolveBatchIntakeSelection(
        cardId,
        candidateNodes,
        [...connections, ...virtualConnections],
    );
    if (!selection.ok) return { ok: false, message: selection.message };
    const candidateById = new Map(candidateNodes.map((node) => [node.id, node]));
    return {
        ok: true,
        workflowNodeId: selection.workflowNodeId,
        sourceSignature: JSON.stringify(
            selection.sourceImageNodeIds.map((nodeId) => {
                const node = candidateById.get(nodeId)!;
                const sourceFile = node.metadata?.sourceFile!;
                return {
                    nodeId,
                    storageKey: node.metadata?.storageKey,
                    name: sourceFile.name,
                    size: sourceFile.size,
                    type: sourceFile.type,
                    lastModified: sourceFile.lastModified,
                    sha256: sourceFile.sha256.toLowerCase(),
                };
            }),
        ),
    };
}

export async function preflightBatchIntakeWorker({
    token,
    fetcher = globalThis.fetch,
}: {
    token: string;
    fetcher?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; message: string }> {
    let response: Response;
    try {
        response = await fetcher(BATCH_MULTI_INTAKE_HEALTH_URL, {
            method: "GET",
            headers: token.trim() ? { "X-Canvas-Agent-Token": token.trim() } : undefined,
        });
    } catch {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.serviceNotRunning };
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.serviceNotRunning };
    }
    const worker = readWorkerHealth(payload, "batch_intake");
    if (!worker) return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.serviceNotRunning };
    if (worker.status === "waiting_canvas") {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.reconnecting };
    }
    if (!response.ok || worker.status !== "running") {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.workerStopped };
    }
    return { ok: true };
}

export function planBatchImagePlacements(
    workflowNode: CanvasNodeData,
    existingNodes: CanvasNodeData[],
    sizes: Array<{ width: number; height: number }>,
): Position[] {
    if (!sizes.length) return [];

    const columns = Math.min(4, Math.ceil(Math.sqrt(sizes.length)));
    const rows = Math.ceil(sizes.length / columns);
    const cellWidth = Math.max(...sizes.map((size) => size.width));
    const cellHeight = Math.max(...sizes.map((size) => size.height));
    const columnGap = 64;
    const rowGap = 52;
    const blockWidth = columns * cellWidth + (columns - 1) * columnGap;
    const blockHeight = rows * cellHeight + (rows - 1) * rowGap;
    let blockX = workflowNode.position.x - 140 - blockWidth;
    const blockY = workflowNode.position.y + workflowNode.height / 2 - blockHeight / 2;

    for (let attempt = 0; attempt <= existingNodes.length; attempt++) {
        const block = {
            position: { x: blockX, y: blockY },
            width: blockWidth,
            height: blockHeight,
        };
        const collisions = existingNodes.filter((node) => rectanglesOverlap(block, node, 20));
        if (!collisions.length) break;
        blockX = Math.min(...collisions.map((node) => node.position.x)) - blockWidth - 40;
    }

    const finalBlock = {
        position: { x: blockX, y: blockY },
        width: blockWidth,
        height: blockHeight,
    };
    if (existingNodes.some((node) => rectanglesOverlap(finalBlock, node, 20))) {
        const leftmost = Math.min(...existingNodes.map((node) => node.position.x));
        blockX = leftmost - blockWidth - 40;
    }

    return sizes.map((size, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            x: blockX + column * (cellWidth + columnGap) + (cellWidth - size.width) / 2,
            y: blockY + row * (cellHeight + rowGap) + (cellHeight - size.height) / 2,
        };
    });
}

export function buildBatchMultiIntakeCommit({
    nodes,
    connections,
    workflowNodeId,
    items,
    idFactory = nanoid,
}: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    workflowNodeId: string;
    items: BatchMultiIntakeItem[];
    idFactory?: () => string;
}): BatchMultiIntakeCommit {
    if (!items.length) return { nodes, connections, newNodes: [], newConnections: [] };
    const workflowNode = nodes.find(
        (node) => node.id === workflowNodeId && node.type === CanvasNodeType.Workflow,
    );
    if (!workflowNode) return { nodes, connections, newNodes: [], newConnections: [] };

    const sizes = items.map((item) => fitNodeSize(item.image.width, item.image.height));
    const positions = planBatchImagePlacements(workflowNode, nodes, sizes);
    const usedNodeIds = new Set(nodes.map((node) => node.id));
    const usedConnectionIds = new Set(connections.map((connection) => connection.id));
    const nextId = (prefix: string, used: Set<string>) => {
        const base = `${prefix}-${idFactory()}`;
        let id = base;
        let suffix = 2;
        while (used.has(id)) {
            id = `${base}-${suffix}`;
            suffix += 1;
        }
        used.add(id);
        return id;
    };

    const newNodes = items.map((item, index): CanvasNodeData => {
        const size = sizes[index]!;
        return {
            id: nextId("image", usedNodeIds),
            type: CanvasNodeType.Image,
            title: item.file.name,
            position: positions[index]!,
            width: size.width,
            height: size.height,
            metadata: {
                content: item.image.url,
                storageKey: item.image.storageKey,
                status: "success",
                naturalWidth: item.image.width,
                naturalHeight: item.image.height,
                bytes: item.image.bytes,
                mimeType: item.image.mimeType,
                sourceFile: item.sourceFile,
            },
        };
    });
    const newConnections = newNodes.map(
        (node): CanvasConnection => ({
            id: nextId("conn", usedConnectionIds),
            fromNodeId: node.id,
            toNodeId: workflowNodeId,
        }),
    );
    return {
        nodes: [...nodes, ...newNodes],
        connections: [...connections, ...newConnections],
        newNodes,
        newConnections,
    };
}

export async function executeBatchMultiIntake({
    cardId,
    files,
    dependencies,
}: {
    cardId: string;
    files: File[];
    dependencies: BatchMultiIntakeDependencies;
}): Promise<string | undefined> {
    if (!files.length) return undefined;
    if (files.length > BATCH_MULTI_INTAKE_MAX_FILES) {
        return BATCH_MULTI_INTAKE_MESSAGES.tooMany(files.length);
    }
    if (files.some((file) => !file.type.startsWith("image/") || file.size <= 0)) {
        return BATCH_MULTI_INTAKE_MESSAGES.invalidSelection;
    }

    const initialSnapshot = dependencies.getSnapshot();
    const cardCheck = validateCard(cardId, initialSnapshot.nodes);
    if (!cardCheck.ok) return cardCheck.message;

    const proofs: BatchMultiIntakeProof[] = [];
    for (let index = 0; index < files.length; index++) {
        const file = files[index]!;
        try {
            proofs.push({ file, sourceFile: await dependencies.createSourceFile(file) });
        } catch {
            return BATCH_MULTI_INTAKE_MESSAGES.localFailure(index + 1, file.name);
        }
    }

    const initialSelection = resolveBatchMultiIntakeSelection(
        cardId,
        proofs,
        initialSnapshot.nodes,
        initialSnapshot.connections,
    );
    if (!initialSelection.ok) return initialSelection.message;

    const health = await dependencies.checkHealth();
    if (!health.ok) return health.message;

    const items: BatchMultiIntakeItem[] = [];
    for (let index = 0; index < proofs.length; index++) {
        const proof = proofs[index]!;
        try {
            items.push({
                ...proof,
                image: await dependencies.uploadImage(proof.file),
            });
        } catch {
            const cleaned = await cleanupKnownStorage(
                items.map((item) => item.image.storageKey),
                dependencies.deleteStoredImages,
            );
            return cleaned
                ? BATCH_MULTI_INTAKE_MESSAGES.localFailure(index + 1, proof.file.name)
                : BATCH_MULTI_INTAKE_MESSAGES.cleanupFailure;
        }
    }

    const latestSnapshot = dependencies.getSnapshot();
    const latestSelection = resolveBatchMultiIntakeSelection(
        cardId,
        proofs,
        latestSnapshot.nodes,
        latestSnapshot.connections,
    );
    if (
        !latestSelection.ok ||
        latestSelection.workflowNodeId !== initialSelection.workflowNodeId ||
        latestSelection.sourceSignature !== initialSelection.sourceSignature
    ) {
        const cleaned = await cleanupKnownStorage(
            items.map((item) => item.image.storageKey),
            dependencies.deleteStoredImages,
        );
        return cleaned
            ? BATCH_MULTI_INTAKE_MESSAGES.canvasChanged
            : BATCH_MULTI_INTAKE_MESSAGES.cleanupFailure;
    }

    const commit = buildBatchMultiIntakeCommit({
        ...latestSnapshot,
        workflowNodeId: latestSelection.workflowNodeId,
        items,
        idFactory: dependencies.idFactory,
    });
    if (
        !commit.newNodes.length ||
        commit.nodes === latestSnapshot.nodes ||
        commit.connections === latestSnapshot.connections
    ) {
        const cleaned = await cleanupKnownStorage(
            items.map((item) => item.image.storageKey),
            dependencies.deleteStoredImages,
        );
        return cleaned
            ? BATCH_MULTI_INTAKE_MESSAGES.canvasChanged
            : BATCH_MULTI_INTAKE_MESSAGES.cleanupFailure;
    }

    dependencies.commit(commit);
    dependencies.register(cardId);
    return undefined;
}

function validateCard(
    cardId: string,
    nodes: CanvasNodeData[],
): { ok: true } | { ok: false; message: string } {
    const card = nodes.find(
        (node) => node.id === cardId && node.type === CanvasNodeType.BatchInfo,
    );
    if (!card) return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.cardUnavailable };
    const state = readBatchIntakeState(card.metadata);
    if (state.status === "integrity_blocked") {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.integrityBlocked };
    }
    if (state.status === "completed") {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.cardCompleted };
    }
    if (state.status === "queued" || state.status === "upload_ready" || state.status === "uploading") {
        return { ok: false, message: BATCH_MULTI_INTAKE_MESSAGES.cardBusy };
    }
    const facts = validateBatchIntakeFacts(state);
    return facts.ok ? { ok: true } : { ok: false, message: facts.message };
}

function rectanglesOverlap(
    first: Pick<CanvasNodeData, "position" | "width" | "height">,
    second: Pick<CanvasNodeData, "position" | "width" | "height">,
    gap = 0,
) {
    return !(
        first.position.x + first.width + gap <= second.position.x - gap ||
        second.position.x + second.width + gap <= first.position.x - gap ||
        first.position.y + first.height + gap <= second.position.y - gap ||
        second.position.y + second.height + gap <= first.position.y - gap
    );
}

function readWorkerHealth(
    payload: unknown,
    name: string,
): { status: string; lastStatusAt: number } | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const workers = (payload as { workers?: unknown }).workers;
    if (!workers || typeof workers !== "object") return undefined;
    const worker = (workers as Record<string, unknown>)[name];
    if (!worker || typeof worker !== "object") return undefined;
    const status = (worker as { status?: unknown }).status;
    const lastStatusAt = (worker as { lastStatusAt?: unknown }).lastStatusAt;
    return typeof status === "string" &&
        typeof lastStatusAt === "number" &&
        Number.isFinite(lastStatusAt)
        ? { status, lastStatusAt }
        : undefined;
}

async function cleanupKnownStorage(
    keys: string[],
    cleanup: (keys: Iterable<string>) => Promise<void>,
) {
    if (!keys.length) return true;
    try {
        await cleanup(keys);
        return true;
    } catch {
        return false;
    }
}
