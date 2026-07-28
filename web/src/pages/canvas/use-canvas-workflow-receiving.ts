import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { buildAcceptancePayload, createReceivingBox, fetchAcceptanceStatus, receivingBoxId, receivingSelections, submitAcceptanceCloseout } from "@/lib/canvas/canvas-workflow-receiving";
import { readExpectedImageSet, resolveProductionSelection, WORKFLOW_COUNT_DATA_MISSING_MESSAGE } from "@/lib/canvas/canvas-workflow-production";
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
                    const expected = readExpectedImageSet(state.totalCount, state.expectedConfigIds);
                    if (!expected || !sameIds(status.expectedConfigIds, expected.expectedConfigIds)) throw new Error(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
                    if (status.status !== "closed") return;
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === box.id
                                ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "closed", closedAt: status.closedAt, selectionCount: receivingSelections(node, items).length, message: "本批次已关账。" } } }
                                : node,
                        ),
                    );
                })
                .catch((error) => {
                    if (!(error instanceof Error) || error.message !== WORKFLOW_COUNT_DATA_MISSING_MESSAGE) return;
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === box.id ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "failed", message: WORKFLOW_COUNT_DATA_MISSING_MESSAGE } } } : node,
                        ),
                    );
                    warn(WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
                });
        });
    }, [nodes, setNodes, token, warn]);

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
            let box: CanvasNodeData;
            try {
                box = createReceivingBox(machine, selection.batchId);
            } catch (error) {
                warn(error instanceof Error ? error.message : WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
                return;
            }
            setNodes((items) => (items.some((node) => node.id === id) ? items : [...items, box]));
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
                warn(error instanceof Error ? error.message : WORKFLOW_COUNT_DATA_MISSING_MESSAGE);
                return;
            }
            const selectionCount = payload.selections.length;
            setNodes((items) =>
                items.map((node) =>
                    node.id === boxId ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "submitting", selectionCount, message: `正在核对 ${selectionCount} 张收货图片…` } } } : node,
                ),
            );
            void submitAcceptanceCloseout(state.batchId, token, payload)
                .then((result) => {
                    setNodes((items) =>
                        items.map((node) =>
                            node.id === boxId
                                ? { ...node, metadata: { ...node.metadata, workflowReceivingBox: { ...state, status: "closed", selectionCount, closedAt: result.closedAt, message: "已关账" } } }
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

function sameIds(first: string[], second: string[]) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
}
