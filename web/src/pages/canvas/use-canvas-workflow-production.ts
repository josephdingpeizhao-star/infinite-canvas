import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { applyProductionQuote, buildProductionCommand, expireProductionState, fetchProductionQuote, isProductionStartBlocked, isSameProductionTarget, isTerminalRebindError, readProductionState, rebindBeforeQuoteIfEligible, resolveProductionSelection, shouldRebindBeforeQuote, WORKFLOW_COUNT_DATA_MISSING_MESSAGE, WorkflowProductionRebindError, type WorkflowProductionQuote } from "@/lib/canvas/canvas-workflow-production";
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
            const state = readProductionState(workflow.metadata);
            if (isProductionStartBlocked(state)) return true;
            const rebindAttempted = shouldRebindBeforeQuote(state, selection.batchId, requestedCommand);
            try {
                const rebind = await rebindBeforeQuoteIfEligible(state, selection.batchId, token, globalThis.fetch, requestedCommand);
                if (rebind) {
                    const currentTarget = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
                    if (!isSameProductionTarget(selection, currentTarget)) {
                        warn("信息卡或素材连线已经变化，请核对后重新开始。");
                        return true;
                    }
                    setNodes((items) =>
                        items.map((node) => {
                            if (node.id !== nodeId || node.type !== CanvasNodeType.Workflow) return node;
                            const current = readProductionState(node.metadata);
                            return {
                                ...node,
                                metadata: {
                                    ...node.metadata,
                                    workflowProduction: {
                                        ...current,
                                        recovery: undefined,
                                        errorMessage: rebind.message || `已剔除缺失白底图，正用剩余 ${rebind.remainingCount} 张重新报价。`,
                                        message: undefined,
                                    },
                                },
                            };
                        }),
                    );
                }
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
                if (rebindAttempted) {
                    const currentTarget = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
                    if (!isSameProductionTarget(selection, currentTarget)) {
                        warn("信息卡或素材连线已经变化，请核对后重新开始。");
                        return true;
                    }
                }
                if (isTerminalRebindError(error)) {
                    setNodes((items) =>
                        items.map((node) => {
                            if (node.id !== nodeId || node.type !== CanvasNodeType.Workflow) return node;
                            const current = readProductionState(node.metadata);
                            return { ...node, metadata: { ...node.metadata, workflowProduction: { ...current, recovery: undefined, errorMessage: safeProductionStartError(error) } } };
                        }),
                    );
                }
                warn(safeProductionStartError(error));
            }
            return true;
        },
        [connectionsRef, nodesRef, setNodes, token, warn],
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
        const requestId = nanoid(10);
        const now = Date.now();
        setNodes((items) =>
            items.map((node) => {
                if (node.id !== current.nodeId || node.type !== CanvasNodeType.Workflow) return node;
                const state = readProductionState(node.metadata);
                if (isProductionStartBlocked(state)) return node;
                const command = buildProductionCommand(
                    applyProductionQuote(state, current.quote),
                    selection.batchId,
                    requestId,
                    now,
                    current.requestedCommand,
                    current.quote,
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

function safeProductionStartError(error: unknown) {
    if (error instanceof WorkflowProductionRebindError) return error.message;
    const message = error instanceof Error ? error.message : "";
    return message === "本机真实制作服务尚未就绪，请重新启动画布服务后再试。" || message === "本机真实制作服务没有返回可信的费用估算，本次没有开始。" || message === WORKFLOW_COUNT_DATA_MISSING_MESSAGE
        ? message
        : "无法取得可信的费用估算，本次没有开始。";
}
