import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
    applyPolledProductionStatusSummary,
    fetchProductionStatus,
    readProductionState,
    shouldPollProductionStatus,
    WORKFLOW_PRODUCTION_STATUS_POLL_INTERVAL_MS,
} from "@/lib/canvas/canvas-workflow-production";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type Options = {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
};

export function useCanvasWorkflowProductionStatusPolling({ nodesRef, setNodes }: Options) {
    const inFlight = useRef(new Set<string>());

    useEffect(() => {
        const tick = () => {
            const token = useAgentStore.getState().token;
            nodesRef.current.forEach((node) => {
                if (node.type !== CanvasNodeType.Workflow) return;
                const state = readProductionState(node.metadata);
                if (!shouldPollProductionStatus(state)) return;
                const batchId = state.batchId!;
                const polledRequestId = state.requestId;
                const key = JSON.stringify([node.id, batchId]);
                if (inFlight.current.has(key)) return;
                inFlight.current.add(key);
                void fetchProductionStatus(batchId, token)
                    .then((summary) => {
                        setNodes((currentNodes) =>
                            currentNodes.map((currentNode) => {
                                if (currentNode.id !== node.id || currentNode.type !== CanvasNodeType.Workflow) return currentNode;
                                const currentState = readProductionState(currentNode.metadata);
                                const next = applyPolledProductionStatusSummary(currentState, summary, Date.now(), polledRequestId);
                                return next
                                    ? { ...currentNode, metadata: { ...currentNode.metadata, workflowProduction: next } }
                                    : currentNode;
                            }),
                        );
                    })
                    .catch(() => {})
                    .finally(() => inFlight.current.delete(key));
            });
        };

        const handle = globalThis.setInterval(tick, WORKFLOW_PRODUCTION_STATUS_POLL_INTERVAL_MS);
        return () => globalThis.clearInterval(handle);
    }, [nodesRef, setNodes]);
}
