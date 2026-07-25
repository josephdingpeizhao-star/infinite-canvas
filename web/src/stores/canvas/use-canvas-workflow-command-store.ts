import { create } from "zustand";

import {
    isClosedWorkflowCommand,
    type ClosedWorkflowCommand,
} from "@/lib/canvas/canvas-command-assistant";


export type WorkflowCommandTarget = {
    nodeId: string;
    title: string;
    mode: "demo" | "production" | "error";
    batchId?: string;
    message?: string;
};

export type WorkflowCommandSender = (
    nodeId: string,
    command?: ClosedWorkflowCommand,
) => void;

type WorkflowCommandBridgeState = {
    ownerId: string;
    targets: WorkflowCommandTarget[];
    sender: WorkflowCommandSender | null;
};

const EMPTY_STATE: WorkflowCommandBridgeState = {
    ownerId: "",
    targets: [],
    sender: null,
};

export const useCanvasWorkflowCommandStore = create<WorkflowCommandBridgeState>(
    () => EMPTY_STATE,
);

export function registerWorkflowCommandBridge(
    ownerId: string,
    targets: WorkflowCommandTarget[],
    sender: WorkflowCommandSender,
) {
    if (!ownerId || typeof sender !== "function") return;
    useCanvasWorkflowCommandStore.setState((current) => {
        const stableTargets = sameTargets(current.targets, targets)
            ? current.targets
            : targets.map((target) => ({ ...target }));
        if (
            current.ownerId === ownerId &&
            current.sender === sender &&
            current.targets === stableTargets
        ) {
            return current;
        }
        return {
            ownerId,
            targets: stableTargets,
            sender,
        };
    });
}

export function clearWorkflowCommandBridge(ownerId: string) {
    useCanvasWorkflowCommandStore.setState((current) =>
        current.ownerId === ownerId ? EMPTY_STATE : current,
    );
}

export function sendWorkflowCommandDraft(nodeId: string, command: unknown) {
    const state = useCanvasWorkflowCommandStore.getState();
    if (
        !state.sender ||
        !state.targets.some((target) => target.nodeId === nodeId) ||
        !isClosedWorkflowCommand(command)
    ) {
        return false;
    }
    state.sender(nodeId, command);
    return true;
}

function sameTargets(
    previous: WorkflowCommandTarget[],
    next: WorkflowCommandTarget[],
) {
    return (
        previous.length === next.length &&
        previous.every((target, index) => {
            const candidate = next[index];
            return (
                target.nodeId === candidate?.nodeId &&
                target.title === candidate.title &&
                target.mode === candidate.mode &&
                target.batchId === candidate.batchId &&
                target.message === candidate.message
            );
        })
    );
}
