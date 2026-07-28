import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import {
    expireStyleReferenceRemovalState,
    prepareStyleReferenceRemovalCommand,
    readStyleReferenceRemovalState,
    readStyleReferenceState,
} from "@/lib/canvas/canvas-style-reference-intake";
import { useAgentStore } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";


type Options = {
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    warn: (message: string) => void;
};


export function useCanvasStyleReferenceRemoval({ nodesRef, setNodes, warn }: Options) {
    const token = useAgentStore((state) => state.token);

    const requestRemoval = useCallback(
        async (cardId: string) => {
            const card = nodesRef.current.find((node) => node.id === cardId);
            if (!card || card.type !== CanvasNodeType.BatchInfo || card.metadata?.batchIntake?.status !== "completed") {
                warn("这张信息卡尚未登记完成，不能移除风格参考图。");
                return;
            }
            const intake = readStyleReferenceState(card.metadata);
            if (intake.status === "queued" || intake.status === "upload_ready" || intake.status === "uploading") {
                warn("风格参考图正在补登，请等待本次操作结束后再移除。");
                return;
            }
            const removal = readStyleReferenceRemovalState(card.metadata);
            if (removal.status === "queued") return;
            try {
                const prepared = await prepareStyleReferenceRemovalCommand({
                    card,
                    token,
                    requestIdFactory: () => nanoid(10),
                    clock: Date.now,
                });
                if (!prepared.ok) {
                    warn(prepared.message);
                    return;
                }
                const command = prepared.command;
                setNodes((items) => items.map((node) => (
                    node.id === cardId
                        ? {
                            ...node,
                            metadata: {
                                ...node.metadata,
                                content: command.content,
                                styleReferenceRemoval: command.state,
                            },
                        }
                        : node
                )));
            } catch (error) {
                warn(error instanceof Error ? error.message : "风格参考图移除没有开始，请稍后重试。");
            }
        },
        [nodesRef, setNodes, token, warn],
    );

    useEffect(() => {
        const handle = globalThis.setInterval(() => {
            const now = Date.now();
            setNodes((items) => items.map((node) => {
                if (node.type !== CanvasNodeType.BatchInfo) return node;
                const state = readStyleReferenceRemovalState(node.metadata);
                const expired = expireStyleReferenceRemovalState(state, now);
                return expired === state
                    ? node
                    : { ...node, metadata: { ...node.metadata, styleReferenceRemoval: expired } };
            }));
        }, 1_000);
        return () => globalThis.clearInterval(handle);
    }, [setNodes]);

    return { requestRemoval };
}
