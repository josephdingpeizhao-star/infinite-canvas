import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { buildRepairedProjectionRequest, repairedProjectionCanStart } from "@/lib/canvas/canvas-workflow-delivery";
import { resolveProductionSelection } from "@/lib/canvas/canvas-workflow-production";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function useCanvasWorkflowRepairedProjection({
    nodesRef,
    connectionsRef,
    setNodes,
    warn,
}: {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
}) {
    const submitted = useRef(new Set<string>());
    const requestProjection = useCallback(
        (nodeId: string) => {
            const selection = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
            if (selection.mode !== "production") {
                warn(selection.mode === "error" ? selection.message : "返修图只属于已登记的真实批次。");
                return;
            }
            const machine = nodesRef.current.find((node) => node.id === nodeId);
            if (!machine || !repairedProjectionCanStart(machine)) {
                warn("请先等本批次质检完成，再上桌返修图。");
                return;
            }
            const key = `${nodeId}:${selection.batchId}`;
            if (submitted.current.has(key)) {
                warn("本页已经提交过返修图上桌；已上桌图片会保留，不会重复添加。");
                return;
            }
            submitted.current.add(key);
            const state = buildRepairedProjectionRequest(selection.batchId, nanoid(12), Date.now());
            setNodes((items) =>
                items.map((node) => (node.id === nodeId && node.type === CanvasNodeType.Workflow ? { ...node, metadata: { ...node.metadata, workflowRepairedProjection: state } } : node)),
            );
        },
        [connectionsRef, nodesRef, setNodes, warn],
    );
    return { requestProjection };
}
