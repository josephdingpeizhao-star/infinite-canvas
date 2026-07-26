import {
    useCallback,
    useRef,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";

import { createBatchSourceFile } from "@/lib/canvas/canvas-batch-intake";
import {
    BATCH_MULTI_INTAKE_MESSAGES,
    executeBatchMultiIntake,
    preflightBatchIntakeWorker,
    type BatchMultiIntakeCommit,
} from "@/lib/canvas/canvas-batch-multi-intake";
import {
    deleteStoredImages,
    uploadImage,
} from "@/services/image-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type Options = {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    requestRegistration: (cardId: string) => void;
};

export function useCanvasBatchMultiIntake({
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    requestRegistration,
}: Options) {
    const token = useAgentStore((state) => state.token);
    const activeCardsRef = useRef(new Set<string>());

    const selectOriginalFiles = useCallback(
        async (cardId: string, files: File[]) => {
            if (activeCardsRef.current.has(cardId)) return BATCH_MULTI_INTAKE_MESSAGES.busy;
            activeCardsRef.current.add(cardId);
            try {
                return await executeBatchMultiIntake({
                    cardId,
                    files,
                    dependencies: {
                        getSnapshot: () => ({
                            nodes: nodesRef.current,
                            connections: connectionsRef.current,
                        }),
                        createSourceFile: createBatchSourceFile,
                        checkHealth: () => preflightBatchIntakeWorker({ token }),
                        uploadImage,
                        deleteStoredImages,
                        commit: (result: BatchMultiIntakeCommit) => {
                            if (
                                result.nodes === nodesRef.current &&
                                result.connections === connectionsRef.current
                            ) {
                                return;
                            }
                            nodesRef.current = result.nodes;
                            connectionsRef.current = result.connections;
                            setNodes(result.nodes);
                            setConnections(result.connections);
                        },
                        register: requestRegistration,
                    },
                });
            } finally {
                activeCardsRef.current.delete(cardId);
            }
        },
        [
            connectionsRef,
            nodesRef,
            requestRegistration,
            setConnections,
            setNodes,
            token,
        ],
    );

    return { selectOriginalFiles };
}
