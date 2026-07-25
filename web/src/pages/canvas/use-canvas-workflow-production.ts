import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { buildProductionCommand, expireProductionState, fetchProductionQuote, hasProductionSubmission, isProductionStartBlocked, readProductionState, reserveProductionSubmission, resolveProductionSelection, type WorkflowProductionQuote } from "@/lib/canvas/canvas-workflow-production";
import type { ClosedWorkflowCommand } from "@/lib/canvas/canvas-command-assistant";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasWorkflowProductionMetadata } from "@/types/canvas";

type Options = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
};

type Pending = {
    nodeId: string;
    cardId: string;
    batchId: string;
    materialCount: number;
    quote: WorkflowProductionQuote;
    previous: CanvasWorkflowProductionMetadata;
    requestedCommand?: ClosedWorkflowCommand;
};

export function useCanvasWorkflowProduction({ nodes, connections, nodesRef, connectionsRef, setNodes, warn }: Options) {
    const token = useAgentStore((state) => state.token);
    const [pending, setPending] = useState<Pending | null>(null);
    const pendingRef = useRef(pending);
    const submittedRef = useRef(new Set<string>());

    useEffect(() => {
        pendingRef.current = pending;
    }, [pending]);

    const requestStart = useCallback(
        async (nodeId: string, requestedCommand?: ClosedWorkflowCommand) => {
            const selection = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
            if (selection.mode === "demo") return false;
            if (selection.mode === "error") {
                warn(selection.message);
                return true;
            }
            const workflow = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Workflow);
            if (!workflow) return true;
            if (hasProductionSubmission(submittedRef.current, nodeId, selection.batchId)) {
                warn("这次真实制作已经提交过一次。若已获得新的执行批准，请重新打开画布后再点“开始”。");
                return true;
            }
            const state = readProductionState(workflow.metadata);
            if (isProductionStartBlocked(state)) return true;
            try {
                const quote = await fetchProductionQuote(selection.batchId, token);
                const latest = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
                if (latest.mode !== "production" || latest.cardId !== selection.cardId || latest.batchId !== selection.batchId) {
                    warn("信息卡或素材连线已经变化，请核对后重新开始。");
                    return true;
                }
                const next = {
                    nodeId,
                    ...latest,
                    quote,
                    previous: state,
                    requestedCommand,
                };
                pendingRef.current = next;
                setPending(next);
            } catch (error) {
                warn(safeQuoteError(error));
            }
            return true;
        },
        [connectionsRef, nodesRef, token, warn],
    );

    const cancelConfirmation = useCallback(() => {
        pendingRef.current = null;
        setPending(null);
    }, []);

    const confirmStart = useCallback(() => {
        const current = pendingRef.current;
        if (!current) return;
        const selection = resolveProductionSelection(current.nodeId, nodesRef.current, connectionsRef.current);
        pendingRef.current = null;
        setPending(null);
        if (selection.mode !== "production" || selection.cardId !== current.cardId || selection.batchId !== current.batchId) {
            warn("信息卡或素材连线已经变化，本次没有开始。");
            return;
        }
        if (!reserveProductionSubmission(submittedRef.current, current.nodeId, selection.batchId)) {
            warn("这次真实制作已经提交过一次。若已获得新的执行批准，请重新打开画布后再点“开始”。");
            return;
        }
        const requestId = nanoid(10);
        const now = Date.now();
        setNodes((items) =>
            items.map((node) => {
                if (node.id !== current.nodeId || node.type !== CanvasNodeType.Workflow) return node;
                const command = buildProductionCommand(
                    readProductionState(node.metadata),
                    selection.batchId,
                    requestId,
                    now,
                    current.requestedCommand,
                );
                return { ...node, metadata: { ...node.metadata, content: command.content, workflowProduction: command.state } };
            }),
        );
    }, [connectionsRef, nodesRef, setNodes, warn]);

    useEffect(() => {
        const handle = globalThis.setInterval(() => {
            const now = Date.now();
            setNodes((items) =>
                items.map((node) => {
                    if (node.type !== CanvasNodeType.Workflow) return node;
                    const state = readProductionState(node.metadata);
                    const expired = expireProductionState(state, now);
                    return expired === state ? node : { ...node, metadata: { ...node.metadata, workflowProduction: expired } };
                }),
            );
        }, 1_000);
        return () => globalThis.clearInterval(handle);
    }, [setNodes]);

    useEffect(() => {
        const current = pendingRef.current;
        if (current && !nodes.some((node) => node.id === current.nodeId)) cancelConfirmation();
    }, [cancelConfirmation, nodes]);

    const cancelNodes = useCallback((nodeIds: Set<string>) => {
        if (pendingRef.current && nodeIds.has(pendingRef.current.nodeId)) cancelConfirmation();
    }, [cancelConfirmation]);

    return {
        pending,
        requestStart,
        cancelConfirmation,
        confirmStart,
        cancelNodes,
        cancelAll: cancelConfirmation,
    };
}

function safeQuoteError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    return message === "本机真实制作服务尚未就绪，请重新启动画布服务后再试。" || message === "本机真实制作服务没有返回可信的费用估算，本次没有开始。"
        ? message
        : "无法取得可信的费用估算，本次没有开始。";
}
