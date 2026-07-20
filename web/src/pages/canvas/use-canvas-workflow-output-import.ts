import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { importProductionOutput, ProductionOutputIntegrityError, productionOutputNeedsImport } from "@/lib/canvas/canvas-workflow-output-import";
import { useAgentStore } from "@/stores/use-agent-store";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasWorkflowOutputImport({ nodes, setNodes }: { nodes: CanvasNodeData[]; setNodes: Dispatch<SetStateAction<CanvasNodeData[]>> }) {
    const token = useAgentStore((state) => state.token);
    const started = useRef(new Set<string>());
    const controllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        nodes.forEach((node) => {
            if (!productionOutputNeedsImport(node)) return;
            const proof = node.metadata?.workflowProductionOutput;
            const key = `${node.id}:${proof?.sha256 || "missing"}`;
            if (started.current.has(key)) return;
            started.current.add(key);
            const controller = new AbortController();
            controllers.current.set(node.id, controller);
            void importProductionOutput(node, token, { signal: controller.signal })
                .then((metadata) => {
                    if (controller.signal.aborted) return;
                    setNodes((items) => items.map((item) => (item.id === node.id ? { ...item, metadata } : item)));
                })
                .catch((error) => {
                    if (controller.signal.aborted) return;
                    const message = error instanceof ProductionOutputIntegrityError ? error.message : "正式图片没有完成浏览器持久化，已停止且不会自动重试。";
                    setNodes((items) => items.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails: message } } : item)));
                })
                .finally(() => controllers.current.delete(node.id));
        });
    }, [nodes, setNodes, token]);

    const cancelNodes = useCallback((nodeIds: Set<string>) => {
        nodeIds.forEach((id) => controllers.current.get(id)?.abort());
    }, []);

    const cancelAll = useCallback(() => {
        controllers.current.forEach((controller) => controller.abort());
        controllers.current.clear();
    }, []);

    useEffect(() => cancelAll, [cancelAll]);
    return { cancelNodes, cancelAll };
}
