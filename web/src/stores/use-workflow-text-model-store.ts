import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CodexReasoningEffort } from "@/lib/canvas/canvas-workflow-text-model";

export type WorkflowTextModelSelection =
    | { kind: "codex"; model: string; effort: CodexReasoningEffort }
    | { kind: "channel"; channelModel: string };

export type WorkflowTextModelSyncState = "idle" | "synced" | "unavailable" | "failed";

export const DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION: WorkflowTextModelSelection = { kind: "codex", model: "gpt-5.6-sol", effort: "medium" };

type WorkflowTextModelStore = {
    selection: WorkflowTextModelSelection;
    syncState: WorkflowTextModelSyncState;
    syncedLabel: string;
    syncHint: string;
    setSelection: (selection: WorkflowTextModelSelection) => void;
    setSyncStatus: (syncState: WorkflowTextModelSyncState, syncedLabel?: string, syncHint?: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function migrateWorkflowTextModelStore(persistedState: unknown, version: number): Partial<WorkflowTextModelStore> {
    const state = persistedState as Partial<WorkflowTextModelStore>;
    if (version >= 1 || !isRecord(persistedState) || !isRecord(persistedState.selection)) return state;
    const selection = persistedState.selection;
    if (selection.kind !== "codex" || selection.model !== "gpt-5.5") return state;
    return {
        ...persistedState,
        selection: { ...selection, model: "gpt-5.6-sol" } as WorkflowTextModelSelection,
    };
}

export const useWorkflowTextModelStore = create<WorkflowTextModelStore>()(
    persist(
        (set) => ({
            selection: DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION,
            syncState: "idle",
            syncedLabel: "",
            syncHint: "",
            setSelection: (selection) => set({ selection }),
            setSyncStatus: (syncState, syncedLabel = "", syncHint = "") => set({ syncState, syncedLabel, syncHint }),
        }),
        {
            name: "infinite-canvas:workflow_text_model",
            version: 1,
            migrate: migrateWorkflowTextModelStore,
            partialize: (state) => ({ selection: state.selection }),
        },
    ),
);
