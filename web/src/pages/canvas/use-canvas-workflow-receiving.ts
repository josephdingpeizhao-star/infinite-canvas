import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { buildAcceptancePayload, createReceivingBox, fetchAcceptanceStatus, receivingBoxId, receivingSelections, submitAcceptanceCloseout } from "@/lib/canvas/canvas-workflow-receiving";
import { resolveProductionSelection } from "@/lib/canvas/canvas-workflow-production";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function useCanvasWorkflowReceiving({
    nodes,
    nodesRef,
    connectionsRef,
    setNodes,
    warn,
}: {
    nodes: CanvasNodeData[];
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
}) {
    const token = useAgentStore((state) => state.token);
    const checked = useRef(new Set<string>());

    useEffect(() => {
        nodes.forEach((box) => {
            const state = box.metadata?.workflowReceivingBox;
            if (!state || checked.current.has(state.batchId) || !token.trim()) return;
            checked.current.add(state.batchId);
            void fetchAcceptanceStatus(state.batchId, token)
                .then((status) => {
                    if (status.status !== "closed") return;
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === box.id
                                ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "closed", closedAt: status.closedAt, selectionCount: receivingSelections(node, items).length, message: "本批次已关账。" } } }
                                : node,
                        ),
                    );
                })
                .catch(() => undefined);
        });
    }, [nodes, setNodes, token]);

    const ensureBox = useCallback(
        (nodeId: string) => {
            const selection = resolveProductionSelection(nodeId, nodesRef.current, connectionsRef.current);
            if (selection.mode !== "production") {
                warn(selection.mode === "error" ? selection.message : "已收货框只属于已登记的真实批次。");
                return;
            }
            const machine = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Workflow);
            if (!machine) return;
            const id = receivingBoxId(selection.batchId);
            setNodes((items) => (items.some((node) => node.id === id) ? items : [...items, createReceivingBox(machine, selection.batchId)]));
        },
        [connectionsRef, nodesRef, setNodes, warn],
    );

    const confirmCloseout = useCallback(
        (boxId: string) => {
            const box = nodesRef.current.find((node) => node.id === boxId);
            const state = box?.metadata?.workflowReceivingBox;
            if (!box || !state || state.status === "submitting" || state.status === "closed") return;
            let payload: ReturnType<typeof buildAcceptancePayload>;
            try {
                payload = buildAcceptancePayload(box, nodesRef.current, nanoid(12));
            } catch (error) {
                warn(error instanceof Error ? error.message : "必须先收满 14 个不同图位。");
                return;
            }
            setNodes((items) =>
                items.map((node) =>
                    node.id === boxId ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "submitting", selectionCount: 14, message: "正在核对 14 张收货图片…" } } } : node,
                ),
            );
            void submitAcceptanceCloseout(state.batchId, token, payload)
                .then((result) => {
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === boxId
                                ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "closed", selectionCount: 14, closedAt: result.closedAt, message: "已关账" } } }
                                : node,
                        ),
                    );
                })
                .catch((error) => {
                    const message = error instanceof Error ? error.message : "关账核对没有通过。";
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === boxId ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "failed", selectionCount: receivingSelections(node, items).length, message } } } : node,
                        ),
                    );
                    warn(message);
                });
        },
        [nodesRef, setNodes, token, warn],
    );
    return { ensureBox, confirmCloseout };
}
