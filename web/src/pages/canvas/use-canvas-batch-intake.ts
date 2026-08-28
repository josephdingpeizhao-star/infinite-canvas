import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { BATCH_CATEGORY_UNAVAILABLE_MESSAGE, BatchIntakeIntegrityError, buildBatchIntakeCommand, categoryDefaultPatch, categorySwitchPatch, expireBatchIntakeState, fetchBatchCategoryCatalog, isRenderQuality, readBatchIntakeState, resolveBatchIntakeSelection, uploadBatchSourceImages, validateBatchIntakeFacts } from "@/lib/canvas/canvas-batch-intake";
import { getImageBlob } from "@/services/image-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasBatchCategoryCatalog, type CanvasBatchIntakeMetadata, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type EditableFacts = Pick<
    CanvasBatchIntakeMetadata,
    "category" | "renderQuality" | "productLengthCm" | "productWidthCm" | "productHeightCm" | "mainImageCount" | "detailImageCount" | "handheldMainCount" | "handheldDetailCount" | "prohibitPouringAndHeating" | "skipMissingDAngle"
>;

type BatchIntakeControllerOptions = {
    nodes: CanvasNodeData[];
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
};

export function useCanvasBatchIntake({ nodes, nodesRef, connectionsRef, setNodes, warn }: BatchIntakeControllerOptions) {
    const token = useAgentStore((state) => state.token);
    const startedRequestsRef = useRef(new Set<string>());
    const requestControllersRef = useRef(new Map<string, AbortController>());
    const [categoryCatalog, setCategoryCatalog] = useState<CanvasBatchCategoryCatalog>();
    const [categoryCatalogStatus, setCategoryCatalogStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        let active = true;
        setCategoryCatalog(undefined);
        setCategoryCatalogStatus("loading");
        void fetchBatchCategoryCatalog(token)
            .then((catalog) => {
                if (!active) return;
                setCategoryCatalog(catalog);
                setCategoryCatalogStatus("ready");
                setNodes((current) =>
                    current.map((node) => {
                        if (node.type !== CanvasNodeType.BatchInfo) return node;
                        const state = readBatchIntakeState(node.metadata);
                        if (state.status !== "draft" && state.status !== "failed") return node;
                        const category = catalog.categories.find((item) => item.key === state.category) || catalog.categories[0]!;
                        if (hasCurrentCategoryForm(state, category.key, category.product_noun, catalog.contractHash)) return node;
                        return resetDraftNode(node, state, categoryDefaultPatch(category, catalog.contractHash));
                    }),
                );
            })
            .catch(() => {
                if (!active) return;
                setCategoryCatalogStatus("error");
            });
        return () => {
            active = false;
        };
    }, [setNodes, token]);

    const updateFacts = useCallback(
        (nodeId: string, patch: Partial<EditableFacts>) => {
            setNodes((current) =>
                current.map((node) => {
                    if (node.id !== nodeId || node.type !== CanvasNodeType.BatchInfo) return node;
                    const state = readBatchIntakeState(node.metadata);
                    if (state.status !== "draft" && state.status !== "failed") return node;
                    const selected = patch.category ? categoryCatalog?.categories.find((item) => item.key === patch.category) : undefined;
                    const effectivePatch = selected && categoryCatalog ? categorySwitchPatch(state, selected, categoryCatalog.contractHash) : patch;
                    return resetDraftNode(node, state, effectivePatch);
                }),
            );
        },
        [categoryCatalog, setNodes],
    );

    const requestRegistration = useCallback(
        (nodeId: string) => {
            const card = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.BatchInfo);
            if (!card) return;
            const state = readBatchIntakeState(card.metadata);
            if (state.status === "integrity_blocked") {
                warn("原图完整性核对已经硬停止，请保留现场并等待裁决。");
                return;
            }
            if (state.status === "completed") {
                warn("这个批次已经登记完成，不会重复登记。");
                return;
            }
            if (state.status === "queued" || state.status === "upload_ready" || state.status === "uploading") return;

            const category = categoryCatalog?.categories.find((item) => item.key === state.category);
            const facts = validateBatchIntakeFacts(state, category, categoryCatalog?.contractHash || "");
            if (!facts.ok) {
                warn(categoryCatalogStatus === "ready" ? facts.message : BATCH_CATEGORY_UNAVAILABLE_MESSAGE);
                return;
            }
            const selection = resolveBatchIntakeSelection(nodeId, nodesRef.current, connectionsRef.current);
            if (!selection.ok) {
                warn(selection.message);
                return;
            }

            const requestId = nanoid(10);
            const command = buildBatchIntakeCommand(state, category, categoryCatalog!.contractHash, selection, requestId, Date.now());
            setNodes((current) => current.map((node) => (node.id === nodeId && node.type === CanvasNodeType.BatchInfo ? { ...node, metadata: { ...node.metadata, content: command.content, batchIntake: command.state } } : node)));
        },
        [categoryCatalog, categoryCatalogStatus, connectionsRef, nodesRef, setNodes, warn],
    );

    const updateRequestState = useCallback(
        (nodeId: string, requestId: string, update: (state: CanvasBatchIntakeMetadata) => CanvasBatchIntakeMetadata) => {
            setNodes((current) =>
                current.map((node) => {
                    if (node.id !== nodeId || node.type !== CanvasNodeType.BatchInfo) return node;
                    const state = readBatchIntakeState(node.metadata);
                    if (state.requestId !== requestId) return node;
                    return { ...node, metadata: { ...node.metadata, batchIntake: update(state) } };
                }),
            );
        },
        [setNodes],
    );

    const uploadReadyRequest = useCallback(
        async (nodeId: string, accepted: CanvasBatchIntakeMetadata) => {
            const requestId = accepted.requestId!;
            const controller = new AbortController();
            requestControllersRef.current.set(requestId, controller);
            try {
                const selection = resolveBatchIntakeSelection(nodeId, nodesRef.current, connectionsRef.current);
                if (!selection.ok) throw new Error("画布连线或原图清单在接单后发生了变化，本次已停止且不会自动重试。");
                if (selection.workflowNodeId !== accepted.workflowNodeId || !sameIds(selection.sourceImageNodeIds, accepted.sourceImageNodeIds || []) || accepted.expectedCount !== selection.sourceImageNodeIds.length) {
                    throw new Error("画布连线或原图清单在接单后发生了变化，本次已停止且不会自动重试。");
                }
                if (!accepted.batchId || !accepted.uploadBaseUrl) throw new Error("本机服务没有返回完整的原图接收信息，本次已停止。");

                const sources = await Promise.all(
                    selection.sourceImageNodeIds.map(async (sourceNodeId) => {
                        const sourceNode = nodesRef.current.find((node) => node.id === sourceNodeId && node.type === CanvasNodeType.Image);
                        if (!sourceNode?.metadata?.storageKey || !sourceNode.metadata.sourceFile) throw new Error("连接的原图已被替换，请从磁盘重新拖入后再登记。");
                        const blob = await getImageBlob(sourceNode.metadata.storageKey);
                        if (!blob) throw new Error("浏览器中找不到连接的原图，请从磁盘重新拖入后再登记。");
                        return { nodeId: sourceNode.id, sourceFile: sourceNode.metadata.sourceFile, blob };
                    }),
                );

                updateRequestState(nodeId, requestId, (state) =>
                    state.status === "completed" || state.status === "failed" || state.status === "integrity_blocked" ? state : { ...state, status: "uploading", updatedAt: Date.now(), receivedCount: 0, errorMessage: undefined },
                );
                const uploaded = await uploadBatchSourceImages({
                    uploadBaseUrl: accepted.uploadBaseUrl,
                    batchId: accepted.batchId,
                    requestId,
                    token,
                    sources,
                    signal: controller.signal,
                });
                updateRequestState(nodeId, requestId, (state) =>
                    state.status === "completed" || state.status === "failed" || state.status === "integrity_blocked" ? state : { ...state, status: "uploading", updatedAt: Date.now(), receivedCount: uploaded.length, errorMessage: undefined },
                );
            } catch (error) {
                if (controller.signal.aborted) return;
                const integrityBlocked = error instanceof BatchIntakeIntegrityError;
                updateRequestState(nodeId, requestId, (state) =>
                    state.status === "completed" || state.status === "integrity_blocked"
                        ? state
                        : {
                              ...state,
                              status: integrityBlocked ? "integrity_blocked" : "failed",
                              updatedAt: Date.now(),
                              errorMessage: integrityBlocked ? "原图 SHA-256 不一致，已立即硬停止。不会重试，也不会降低无损标准。" : safeUploadError(error),
                          },
                );
            } finally {
                requestControllersRef.current.delete(requestId);
            }
        },
        [connectionsRef, nodesRef, token, updateRequestState],
    );

    useEffect(() => {
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.BatchInfo) return;
            const state = readBatchIntakeState(node.metadata);
            if (state.status !== "upload_ready" || !state.requestId || startedRequestsRef.current.has(state.requestId)) return;
            startedRequestsRef.current.add(state.requestId);
            void uploadReadyRequest(node.id, state);
        });
    }, [nodes, uploadReadyRequest]);

    useEffect(() => {
        const handle = globalThis.setInterval(() => {
            const now = Date.now();
            setNodes((current) =>
                current.map((node) => {
                    if (node.type !== CanvasNodeType.BatchInfo) return node;
                    const state = readBatchIntakeState(node.metadata);
                    const expired = expireBatchIntakeState(state, now);
                    return expired === state ? node : { ...node, metadata: { ...node.metadata, batchIntake: expired } };
                }),
            );
        }, 1000);
        return () => globalThis.clearInterval(handle);
    }, [setNodes]);

    const cancelNodes = useCallback(
        (nodeIds: Set<string>) => {
            nodesRef.current.forEach((node) => {
                if (!nodeIds.has(node.id) || node.type !== CanvasNodeType.BatchInfo) return;
                const requestId = readBatchIntakeState(node.metadata).requestId;
                if (requestId) requestControllersRef.current.get(requestId)?.abort();
            });
        },
        [nodesRef],
    );

    const cancelAll = useCallback(() => {
        requestControllersRef.current.forEach((controller) => controller.abort());
        requestControllersRef.current.clear();
    }, []);

    useEffect(() => cancelAll, [cancelAll]);

    return { updateFacts, requestRegistration, cancelNodes, cancelAll, categoryCatalog, categoryCatalogStatus };
}

function resetDraftNode(node: CanvasNodeData, state: CanvasBatchIntakeMetadata, patch: Partial<CanvasBatchIntakeMetadata>): CanvasNodeData {
    return {
        ...node,
        metadata: {
            ...node.metadata,
            content: undefined,
            batchIntake: {
                ...state,
                ...patch,
                status: "draft",
                requestId: undefined,
                requestedAt: undefined,
                updatedAt: undefined,
                workflowNodeId: undefined,
                sourceImageNodeIds: undefined,
                batchId: undefined,
                uploadBaseUrl: undefined,
                expectedCount: undefined,
                receivedCount: undefined,
                errorMessage: undefined,
                receipt: undefined,
                facts: undefined,
            },
        },
    };
}

function hasCurrentCategoryForm(state: CanvasBatchIntakeMetadata, category: string, productNoun: string, contractHash: string) {
    return (
        state.category === category &&
        state.productType === productNoun &&
        state.contractHash === contractHash &&
        isRenderQuality(state.renderQuality) &&
        Number.isInteger(state.mainImageCount) &&
        Number.isInteger(state.detailImageCount) &&
        Number.isInteger(state.handheldMainCount) &&
        Number.isInteger(state.handheldDetailCount) &&
        typeof state.prohibitPouringAndHeating === "boolean" &&
        typeof state.skipMissingDAngle === "boolean"
    );
}

function sameIds(first: string[], second: string[]) {
    return first.length === second.length && first.every((id) => second.includes(id));
}

function safeUploadError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const allowed = [
        "画布连线或原图清单在接单后发生了变化，本次已停止且不会自动重试。",
        "本机服务没有返回完整的原图接收信息，本次已停止。",
        "连接的原图已被替换，请从磁盘重新拖入后再登记。",
        "浏览器中找不到连接的原图，请从磁盘重新拖入后再登记。",
        "本机画布连接令牌不可用，请重新启动画布服务后再试。",
        "原图接收地址无效，登记已停止。",
        "原图接收地址不是批准的本机地址，登记已停止。",
        "原图接收信息不完整，登记已停止。",
        "本机批次登记服务拒绝了原图，本次已停止且不会自动重试。",
    ];
    return allowed.includes(message) ? message : "本机原图接收中断，本次已停止且不会自动重试。";
}
