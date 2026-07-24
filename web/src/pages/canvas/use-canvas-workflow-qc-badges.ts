import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { applyQcSummaryToNodes, fetchWorkflowQcSummary, type WorkflowQcSummary } from "@/lib/canvas/canvas-workflow-delivery";
import { useAgentStore } from "@/stores/use-agent-store";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasWorkflowQcBadges({ nodes, setNodes }: { nodes: CanvasNodeData[]; setNodes: Dispatch<SetStateAction<CanvasNodeData[]>> }) {
    const token = useAgentStore((state) => state.token);
    const started = useRef(new Set<string>());
    const cache = useRef(new Map<string, WorkflowQcSummary>());

    useEffect(() => {
        const batches = new Set(
            nodes
                .map((node) => node.metadata?.workflowProductionOutput)
                .filter((proof) => proof?.source === "renders")
                .map((proof) => proof!.batchId),
        );
        batches.forEach((batchId) => {
            const cached = cache.current.get(batchId);
            if (cached) {
                setNodes((items) => applyQcSummaryToNodes(items, batchId, cached));
                return;
            }
            if (!token.trim() || started.current.has(batchId)) return;
            started.current.add(batchId);
            void fetchWorkflowQcSummary(batchId, token)
                .then((summary) => {
                    if (!summary) return;
                    cache.current.set(batchId, summary);
                    setNodes((items) => applyQcSummaryToNodes(items, batchId, summary));
                })
                .catch(() => undefined);
        });
    }, [nodes, setNodes, token]);
}
