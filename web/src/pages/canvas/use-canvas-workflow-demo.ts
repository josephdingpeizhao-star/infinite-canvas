import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import {
    buildWorkflowDemoCommand,
    connectedWorkflowImageIds,
    expireWorkflowDemoState,
    readWorkflowDemoState,
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

export function useCanvasWorkflowDemo({ nodes, connections, nodesRef, connectionsRef, setNodes, warn }: WorkflowDemoControllerOptions) {
    const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
    const pendingConfirmationRef = useRef(pendingConfirmation);

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
            const workflowStatus = workflow ? readWorkflowDemoState(workflow.metadata).status : "idle";
            if (!workflow || workflowStatus === "running" || workflowStatus === "queued" || workflowStatus === "awaiting_confirmation") return;
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

        const requestId = nanoid(10);
        pendingConfirmationRef.current = null;
        setPendingConfirmation(null);
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== workflow.id || node.type !== CanvasNodeType.Workflow) return node;
                const command = buildWorkflowDemoCommand(readWorkflowDemoState(node.metadata), requestId, Date.now());
                return { ...node, metadata: { ...node.metadata, content: command.content, workflowDemo: command.state } };
            }),
        );
    }, [connectionsRef, nodesRef, setNodes, updateWorkflowState, warn]);

    const cancelNodes = useCallback((nodeIds: Set<string>) => {
        const pending = pendingConfirmationRef.current;
        if (pending && nodeIds.has(pending.nodeId)) {
            pendingConfirmationRef.current = null;
            setPendingConfirmation(null);
        }
    }, []);

    const cancelAll = useCallback(() => {
        pendingConfirmationRef.current = null;
        setPendingConfirmation(null);
    }, []);

    useEffect(() => {
        const liveWorkflowIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Workflow).map((node) => node.id));
        const pending = pendingConfirmationRef.current;
        if (pending && !liveWorkflowIds.has(pending.nodeId)) {
            pendingConfirmationRef.current = null;
            setPendingConfirmation(null);
        }
    }, [nodes]);

    useEffect(
        () => () => {
            pendingConfirmationRef.current = null;
        },
        [],
    );

    useEffect(() => {
        const handle = globalThis.setInterval(() => {
            const now = Date.now();
            setNodes((current) =>
                current.map((node) => {
                    if (node.type !== CanvasNodeType.Workflow) return node;
                    const state = readWorkflowDemoState(node.metadata);
                    const expired = expireWorkflowDemoState(state, now);
                    if (expired === state) return node;
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            content: `# request-id: ${expired.runId || "unknown"}\n# expired`,
                            workflowDemo: expired,
                        },
                    };
                }),
            );
        }, 1000);
        return () => globalThis.clearInterval(handle);
    }, [setNodes]);

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
