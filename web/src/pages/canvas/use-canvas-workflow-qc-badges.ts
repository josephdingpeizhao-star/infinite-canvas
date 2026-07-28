import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { applyQcSummaryToNodes, fetchWorkflowQcSummary, qcSummaryNeedsApplication, type WorkflowQcSummary } from "@/lib/canvas/canvas-workflow-delivery";
import { WORKFLOW_COUNT_DATA_MISSING_MESSAGE } from "@/lib/canvas/canvas-workflow-production";
import { useAgentStore } from "@/stores/use-agent-store";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasWorkflowQcBadges({ nodes, setNodes, warn }: { nodes: CanvasNodeData[]; setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>; warn: (message: string) => void }) {
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
                if (qcSummaryNeedsApplication(nodes, batchId, cached)) setNodes((items) => applyQcSummaryToNodes(items, batchId, cached));
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
                .catch((error) => {
                    if (!(error instanceof Error) || error.message !== WORKFLOW_COUNT_DATA_MISSING_MESSAGE) return;
                    setNodes((items) =>
                        items.map((node) => {
                            if (node.metadata?.workflowProductionOutput?.batchId !== batchId || !node.metadata.workflowProductionQc) return node;
                            const { workflowProductionQc: _removed, ...metadata } = node.metadata;
                            return { ...node, metadata };
                        }),
                    );
                    warn(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
                });
        });
    }, [nodes, setNodes, token, warn]);
}
