import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import {
    connectedWorkflowImageIds,
    createWorkflowDemoPlaceholder,
    findWorkflowDemoOutputPosition,
    readWorkflowDemoState,
    startWorkflowDemoSequence,
    WORKFLOW_DEMO_TOTAL,
    type WorkflowDemoFrame,
} from "@/lib/canvas/canvas-workflow-demo";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasWorkflowDemoMetadata } from "@/types/canvas";

type WorkflowDemoControllerOptions = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    warn: (message: string) => void;
};

type PendingConfirmation = {
    nodeId: string;
    previous: CanvasWorkflowDemoMetadata;
};

export function useCanvasWorkflowDemo({ nodes, connections, nodesRef, connectionsRef, setNodes, setConnections, warn }: WorkflowDemoControllerOptions) {
    const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
    const pendingConfirmationRef = useRef(pendingConfirmation);
    const sequencesRef = useRef(new Map<string, { cancel: () => void }>());

    useEffect(() => {
        pendingConfirmationRef.current = pendingConfirmation;
    }, [pendingConfirmation]);

    const updateWorkflowState = useCallback(
        (nodeId: string, update: (state: CanvasWorkflowDemoMetadata) => CanvasWorkflowDemoMetadata) => {
            setNodes((current) =>
                current.map((node) =>
                    node.id === nodeId && node.type === CanvasNodeType.Workflow
                        ? { ...node, metadata: { ...node.metadata, workflowDemo: update(readWorkflowDemoState(node.metadata)) } }
                        : node,
                ),
            );
        },
        [setNodes],
    );

    const requestStart = useCallback(
        (nodeId: string) => {
            const workflow = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Workflow);
            if (!workflow || readWorkflowDemoState(workflow.metadata).status === "running") return;
            const inputIds = connectedWorkflowImageIds(nodeId, nodesRef.current, connectionsRef.current);
            if (!inputIds.length) {
                warn("请先把至少 1 张图片素材连到工作流左侧输入点。");
                return;
            }
            const previous = readWorkflowDemoState(workflow.metadata);
            const pending = { nodeId, previous };
            pendingConfirmationRef.current = pending;
            setPendingConfirmation(pending);
            updateWorkflowState(nodeId, (state) => ({ ...state, status: "awaiting_confirmation", errorMessage: undefined }));
        },
        [connectionsRef, nodesRef, updateWorkflowState, warn],
    );

    const cancelConfirmation = useCallback(() => {
        const pending = pendingConfirmationRef.current;
        if (!pending) return;
        pendingConfirmationRef.current = null;
        setPendingConfirmation(null);
        updateWorkflowState(pending.nodeId, () => pending.previous);
    }, [updateWorkflowState]);

    const confirmStart = useCallback(() => {
        const pending = pendingConfirmationRef.current;
        if (!pending) return;
        const workflow = nodesRef.current.find((node) => node.id === pending.nodeId && node.type === CanvasNodeType.Workflow);
        const inputIds = workflow ? connectedWorkflowImageIds(workflow.id, nodesRef.current, connectionsRef.current) : [];
        if (!workflow || !inputIds.length) {
            pendingConfirmationRef.current = null;
            setPendingConfirmation(null);
            if (workflow) updateWorkflowState(workflow.id, () => pending.previous);
            warn(workflow ? "连接的图片素材已经移除，请重新连接后再开始。" : "工作流节点已不存在，本次演示没有开始。");
            return;
        }

        sequencesRef.current.get(workflow.id)?.cancel();
        const runId = nanoid(10);
        pendingConfirmationRef.current = null;
        setPendingConfirmation(null);
        updateWorkflowState(workflow.id, (state) => ({ ...state, status: "running", producedCount: 0, runId, errorMessage: undefined }));

        const sequence = startWorkflowDemoSequence({
            runId,
            onFrame: (frame) => insertFrame(workflow.id, frame, nodesRef, setNodes, setConnections),
            onComplete: () => {
                sequencesRef.current.delete(workflow.id);
                updateWorkflowState(workflow.id, (state) => ({ ...state, status: "completed", producedCount: WORKFLOW_DEMO_TOTAL, completedRuns: state.completedRuns + 1, runId, errorMessage: undefined }));
            },
            onError: () => {
                sequencesRef.current.delete(workflow.id);
                updateWorkflowState(workflow.id, (state) => ({ ...state, status: "failed", errorMessage: "演示没有完成，已经上桌的图片仍然保留。可以重新开始。" }));
                warn("演示没有完成，已经上桌的图片仍然保留。");
            },
        });
        sequencesRef.current.set(workflow.id, sequence);
    }, [connectionsRef, nodesRef, setConnections, setNodes, updateWorkflowState, warn]);

    const cancelNodes = useCallback((nodeIds: Set<string>) => {
        nodeIds.forEach((nodeId) => {
            sequencesRef.current.get(nodeId)?.cancel();
            sequencesRef.current.delete(nodeId);
        });
        const pending = pendingConfirmationRef.current;
        if (pending && nodeIds.has(pending.nodeId)) {
            pendingConfirmationRef.current = null;
            setPendingConfirmation(null);
        }
    }, []);

    const cancelAll = useCallback(() => {
        sequencesRef.current.forEach((sequence) => sequence.cancel());
        sequencesRef.current.clear();
        pendingConfirmationRef.current = null;
        setPendingConfirmation(null);
    }, []);

    useEffect(() => {
        const liveWorkflowIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Workflow).map((node) => node.id));
        sequencesRef.current.forEach((sequence, nodeId) => {
            const node = nodes.find((candidate) => candidate.id === nodeId);
            if (liveWorkflowIds.has(nodeId) && node && readWorkflowDemoState(node.metadata).status === "running") return;
            sequence.cancel();
            sequencesRef.current.delete(nodeId);
        });
        const pending = pendingConfirmationRef.current;
        if (pending && !liveWorkflowIds.has(pending.nodeId)) {
            pendingConfirmationRef.current = null;
            setPendingConfirmation(null);
        }
    }, [nodes]);

    useEffect(
        () => () => {
            sequencesRef.current.forEach((sequence) => sequence.cancel());
            sequencesRef.current.clear();
            pendingConfirmationRef.current = null;
        },
        [],
    );

    const pendingConnectedImageCount = useMemo(
        () => (pendingConfirmation ? connectedWorkflowImageIds(pendingConfirmation.nodeId, nodes, connections).length : 0),
        [connections, nodes, pendingConfirmation],
    );

    return {
        pendingNodeId: pendingConfirmation?.nodeId || null,
        pendingConnectedImageCount,
        requestStart,
        cancelConfirmation,
        confirmStart,
        cancelNodes,
        cancelAll,
    };
}

function insertFrame(
    workflowNodeId: string,
    frame: WorkflowDemoFrame,
    nodesRef: MutableRefObject<CanvasNodeData[]>,
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>,
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>,
) {
    const workflow = nodesRef.current.find((node) => node.id === workflowNodeId && node.type === CanvasNodeType.Workflow);
    if (!workflow) throw new Error("工作流节点已不存在");
    const position = findWorkflowDemoOutputPosition(workflow, nodesRef.current, frame);
    const content = createWorkflowDemoPlaceholder(frame);
    const output: CanvasNodeData = {
        id: frame.id,
        type: CanvasNodeType.Image,
        title: frame.label,
        position,
        width: frame.width,
        height: frame.height,
        metadata: {
            content,
            status: "success",
            naturalWidth: frame.naturalWidth,
            naturalHeight: frame.naturalHeight,
            workflowDemoOutput: { workflowNodeId, runId: frame.runId, index: frame.index },
        },
    };
    setNodes((current) => {
        if (!current.some((node) => node.id === workflowNodeId) || current.some((node) => node.id === output.id)) return current;
        return [
            ...current.map((node) =>
                node.id === workflowNodeId
                    ? { ...node, metadata: { ...node.metadata, workflowDemo: { ...readWorkflowDemoState(node.metadata), status: "running" as const, producedCount: frame.index, runId: frame.runId, errorMessage: undefined } } }
                    : node,
            ),
            output,
        ];
    });
    setConnections((current) => {
        if (current.some((connection) => connection.fromNodeId === workflowNodeId && connection.toNodeId === output.id)) return current;
        return [...current, { id: `conn-${frame.id}`, fromNodeId: workflowNodeId, toNodeId: output.id }];
    });
}
