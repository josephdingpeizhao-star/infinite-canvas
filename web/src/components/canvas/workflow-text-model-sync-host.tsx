import { useEffect } from "react";

import { resolveWorkflowTextModelPayload, syncWorkflowTextModel } from "@/lib/canvas/canvas-workflow-text-model";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useWorkflowTextModelStore } from "@/stores/use-workflow-text-model-store";

export function WorkflowTextModelSyncHost() {
    const selection = useWorkflowTextModelStore((state) => state.selection);
    const setSyncStatus = useWorkflowTextModelStore((state) => state.setSyncStatus);
    const channels = useConfigStore((state) => state.config.channels);
    const token = useAgentStore((state) => state.token);

    useEffect(() => {
        let active = true;
        setSyncStatus("idle");
        const timer = window.setTimeout(() => {
            const config = { ...useConfigStore.getState().config, channels };
            const { payload, hint } = resolveWorkflowTextModelPayload(config, selection);
            if (!token.trim() || !payload) {
                setSyncStatus("unavailable", "", token.trim() ? hint : "本机工作台未连接");
                return;
            }
            void syncWorkflowTextModel(payload, token)
                .then((label) => {
                    if (active) setSyncStatus("synced", label);
                })
                .catch(() => {
                    if (active) setSyncStatus("failed");
                });
        }, 300);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [channels, selection, setSyncStatus, token]);

    return null;
}
