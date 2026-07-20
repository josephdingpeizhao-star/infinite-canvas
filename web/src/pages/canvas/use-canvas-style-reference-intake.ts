import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { buildStyleReferenceCommand, expireStyleReferenceState, readStyleReferenceState, resolveStyleReferenceSelection, StyleReferenceIntegrityError, uploadStyleReferences } from "@/lib/canvas/canvas-style-reference-intake";
import { getImageBlob } from "@/services/image-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasStyleReferenceMetadata } from "@/types/canvas";

type Options = {
    nodes: CanvasNodeData[];
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
};

export function useCanvasStyleReferenceIntake({ nodes, nodesRef, connectionsRef, setNodes, warn }: Options) {
    const token = useAgentStore((state) => state.token);
    const started = useRef(new Set<string>());
    const controllers = useRef(new Map<string, AbortController>());

    const requestSupplement = useCallback(
        (cardId: string) => {
            const selection = resolveStyleReferenceSelection(cardId, nodesRef.current, connectionsRef.current);
            if (!selection.ok) {
                warn(selection.message);
                return;
            }
            const card = nodesRef.current.find((node) => node.id === cardId)!;
            const current = readStyleReferenceState(card.metadata);
            if (current.status === "queued" || current.status === "upload_ready" || current.status === "uploading") return;
            if (current.status === "integrity_blocked") {
                warn("这次风格补登已因完整性问题硬停止，请保留现场并等待裁决。");
                return;
            }
            const sources = selection.sourceNodeIds.map((id) => nodesRef.current.find((node) => node.id === id)!).filter(Boolean);
            const command = buildStyleReferenceCommand(card, sources, nanoid(10), Date.now());
            setNodes((items) => items.map((node) => (node.id === cardId ? { ...node, metadata: { ...node.metadata, content: command.content, styleReferenceIntake: command.state } } : node)));
        },
        [connectionsRef, nodesRef, setNodes, warn],
    );

    const updateRequest = useCallback(
        (cardId: string, requestId: string, update: (state: CanvasStyleReferenceMetadata) => CanvasStyleReferenceMetadata) => {
            setNodes((items) => items.map((node) => {
                if (node.id !== cardId || node.type !== CanvasNodeType.BatchInfo) return node;
                const state = readStyleReferenceState(node.metadata);
                return state.requestId === requestId ? { ...node, metadata: { ...node.metadata, styleReferenceIntake: update(state) } } : node;
            }));
        },
        [setNodes],
    );

    const uploadReady = useCallback(
        async (cardId: string, accepted: CanvasStyleReferenceMetadata) => {
            const requestId = accepted.requestId!;
            const controller = new AbortController();
            controllers.current.set(requestId, controller);
            try {
                const selection = resolveStyleReferenceSelection(cardId, nodesRef.current, connectionsRef.current);
                if (!selection.ok || selection.batchId !== accepted.batchId || !sameIds(selection.sourceNodeIds, accepted.sources.map((item) => item.nodeId))) throw new Error("风格参考图连线已变化，本次已停止且不会自动重试。");
                if (!accepted.uploadBaseUrl || !accepted.batchId) throw new Error("本机服务没有返回完整的风格补登信息，本次已停止。");
                const sources = await Promise.all(selection.sourceNodeIds.map(async (id) => {
                    const node = nodesRef.current.find((item) => item.id === id);
                    if (!node?.metadata?.storageKey || !node.metadata.sourceFile) throw new Error("浏览器中找不到风格参考原图，请重新拖入后再试。");
                    const blob = await getImageBlob(node.metadata.storageKey);
                    if (!blob) throw new Error("浏览器中找不到风格参考原图，请重新拖入后再试。");
                    return { nodeId: id, sourceFile: node.metadata.sourceFile, blob };
                }));
                updateRequest(cardId, requestId, (state) => ({ ...state, status: "uploading", updatedAt: Date.now(), errorMessage: undefined }));
                await uploadStyleReferences({ uploadBaseUrl: accepted.uploadBaseUrl, batchId: accepted.batchId, requestId, token, sources, signal: controller.signal });
            } catch (error) {
                if (controller.signal.aborted) return;
                const blocked = error instanceof StyleReferenceIntegrityError;
                updateRequest(cardId, requestId, (state) => state.status === "completed" || state.status === "integrity_blocked" ? state : { ...state, status: blocked ? "integrity_blocked" : "failed", updatedAt: Date.now(), errorMessage: blocked ? error.message : "风格补登中断，已停止且不会自动重试。" });
            } finally {
                controllers.current.delete(requestId);
            }
        },
        [connectionsRef, nodesRef, token, updateRequest],
    );

    useEffect(() => {
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.BatchInfo) return;
            const state = readStyleReferenceState(node.metadata);
            if (state.status !== "upload_ready" || !state.requestId || started.current.has(state.requestId)) return;
            started.current.add(state.requestId);
            void uploadReady(node.id, state);
        });
    }, [nodes, uploadReady]);

    useEffect(() => {
        const handle = globalThis.setInterval(() => {
            const now = Date.now();
            setNodes((items) => items.map((node) => {
                if (node.type !== CanvasNodeType.BatchInfo) return node;
                const state = readStyleReferenceState(node.metadata);
                const expired = expireStyleReferenceState(state, now);
                return expired === state ? node : { ...node, metadata: { ...node.metadata, styleReferenceIntake: expired } };
            }));
        }, 1_000);
        return () => globalThis.clearInterval(handle);
    }, [setNodes]);

    const cancelNodes = useCallback((nodeIds: Set<string>) => {
        nodesRef.current.forEach((node) => {
            if (!nodeIds.has(node.id)) return;
            const requestId = readStyleReferenceState(node.metadata).requestId;
            if (requestId) controllers.current.get(requestId)?.abort();
        });
    }, [nodesRef]);
    const cancelAll = useCallback(() => {
        controllers.current.forEach((controller) => controller.abort());
        controllers.current.clear();
    }, []);
    useEffect(() => cancelAll, [cancelAll]);
    return { requestSupplement, cancelNodes, cancelAll };
}

function sameIds(first: string[], second: string[]) {
    return first.length === second.length && first.every((id) => second.includes(id));
}
