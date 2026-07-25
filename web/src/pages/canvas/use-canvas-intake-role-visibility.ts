import { useEffect, type Dispatch, type SetStateAction } from "react";

import {
    applyIntakeRoleBadgesToNodes,
    intakeRoleBadgesNeedApplication,
} from "@/lib/canvas/canvas-intake-role-visibility";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";


export function useCanvasIntakeRoleVisibility({
    nodes,
    connections,
    setNodes,
}: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
}) {
    useEffect(() => {
        if (!intakeRoleBadgesNeedApplication(nodes, connections)) return;
        setNodes((items) => applyIntakeRoleBadgesToNodes(items, connections));
    }, [connections, nodes, setNodes]);
}
