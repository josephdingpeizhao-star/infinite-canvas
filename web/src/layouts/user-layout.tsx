import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { CanvasAgentConnectionHost } from "@/components/canvas/canvas-agent-connection-host";
import { WorkflowTextModelSyncHost } from "@/components/canvas/workflow-text-model-sync-host";
import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <CanvasAgentConnectionHost />
            <WorkflowTextModelSyncHost />
            <AgentPanel />
        </div>
    );
}
