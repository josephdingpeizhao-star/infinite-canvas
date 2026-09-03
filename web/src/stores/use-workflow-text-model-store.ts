import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CodexReasoningEffort } from "@/lib/canvas/canvas-workflow-text-model";

export type WorkflowTextModelSelection =
    | { kind: "codex"; model: string; effort: CodexReasoningEffort }
    | { kind: "channel"; channelModel: string };

export type WorkflowTextModelSyncState = "idle" | "synced" | "unavailable" | "failed";

export const DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION: WorkflowTextModelSelection = { kind: "codex", model: "gpt-5.5", effort: "medium" };

type WorkflowTextModelStore = {
    selection: WorkflowTextModelSelection;
    syncState: WorkflowTextModelSyncState;
    syncedLabel: string;
    syncHint: string;
    setSelection: (selection: WorkflowTextModelSelection) => void;
    setSyncStatus: (syncState: WorkflowTextModelSyncState, syncedLabel?: string, syncHint?: string) => void;
};

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
            partialize: (state) => ({ selection: state.selection }),
        },
    ),
);
