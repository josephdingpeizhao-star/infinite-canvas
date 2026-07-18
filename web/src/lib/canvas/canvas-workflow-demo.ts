import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkflowDemoMetadata, type Position } from "@/types/canvas";

export const WORKFLOW_DEMO_TOTAL = 14;
export const WORKFLOW_DEMO_MAIN_COUNT = 6;
export const WORKFLOW_DEMO_DETAIL_COUNT = 8;

const WORKFLOW_DEMO_DELAYS = [1500, 1750, 2000, 2250, 2500] as const;
const WORKFLOW_DEMO_STATUSES = new Set(["idle", "awaiting_confirmation", "queued", "running", "completed", "failed"]);

export const WORKFLOW_DEMO_ACK_TIMEOUT_MS = 8000;
export const WORKFLOW_DEMO_PROGRESS_TIMEOUT_MS = 12000;

export type WorkflowDemoFrame = {
    id: string;
    runId: string;
    index: number;
    kind: "main" | "detail";
    ordinal: number;
    label: string;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
    offsetX: number;
    offsetY: number;
};

type TimerApi = {
    setTimeout: (callback: () => void, delay: number) => unknown;
    clearTimeout: (handle: unknown) => void;
};

type WorkflowDemoSequenceOptions = {
    runId: string;
    timer?: TimerApi;
    onFrame: (frame: WorkflowDemoFrame) => void;
    onComplete: () => void;
    onError: (error: unknown) => void;
};

const mainOffsets = [
    [0, -120],
    [0, 120],
    [205, -235],
    [205, 235],
    [410, -350],
    [410, 350],
] as const;

const detailOffsets = [
    [635, -430],
    [635, -150],
    [635, 150],
    [635, 430],
    [830, -570],
    [830, -285],
    [830, 285],
    [830, 570],
] as const;

export function usesCustomNodeContent(type: CanvasNodeType) {
    return type === CanvasNodeType.Config || type === CanvasNodeType.Workflow;
}

export function readWorkflowDemoState(metadata?: CanvasNodeMetadata): CanvasWorkflowDemoMetadata {
    const value = metadata?.workflowDemo;
    const status = value && WORKFLOW_DEMO_STATUSES.has(value.status) ? value.status : "idle";
    return {
        status,
        producedCount: clampInteger(value?.producedCount, 0, WORKFLOW_DEMO_TOTAL),
        completedRuns: clampInteger(value?.completedRuns, 0, Number.MAX_SAFE_INTEGER),
        runId: typeof value?.runId === "string" && value.runId ? value.runId : undefined,
        errorMessage: typeof value?.errorMessage === "string" && value.errorMessage ? value.errorMessage : undefined,
        requestedAt: finiteTimestamp(value?.requestedAt),
        updatedAt: finiteTimestamp(value?.updatedAt),
    };
}

export function buildWorkflowDemoCommand(state: CanvasWorkflowDemoMetadata, requestId: string, now: number) {
    const retry = state.completedRuns > 0 || state.producedCount > 0;
    return {
        content: `# workflow-demo\n# request-id: ${requestId}\n# requested-at: ${now}\n${retry ? "retry" : "run"}: renders`,
        state: {
            ...state,
            status: "queued" as const,
            producedCount: 0,
            runId: requestId,
            errorMessage: undefined,
            requestedAt: now,
            updatedAt: now,
        },
    };
}

export function expireWorkflowDemoState(state: CanvasWorkflowDemoMetadata, now: number): CanvasWorkflowDemoMetadata {
    if (state.status === "queued" && state.requestedAt !== undefined && now - state.requestedAt >= WORKFLOW_DEMO_ACK_TIMEOUT_MS) {
        return {
            ...state,
            status: "failed",
            updatedAt: now,
            errorMessage: "本机演示服务没有响应，请重新启动画布服务后再试。",
        };
    }
    if (state.status === "running" && state.updatedAt !== undefined && now - state.updatedAt >= WORKFLOW_DEMO_PROGRESS_TIMEOUT_MS) {
        return {
            ...state,
            status: "failed",
            updatedAt: now,
            errorMessage: "本机演示服务已中断，已经完成的图片仍然保留。",
        };
    }
    return state;
}

export function connectedWorkflowImageIds(workflowNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(
        new Set(
            connections
                .filter((connection) => connection.toNodeId === workflowNodeId)
                .map((connection) => nodesById.get(connection.fromNodeId))
                .filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Image && Boolean(node.metadata?.content))
                .map((node) => node.id),
        ),
    );
}

export function buildWorkflowDemoFrames(runId: string): WorkflowDemoFrame[] {
    return Array.from({ length: WORKFLOW_DEMO_TOTAL }, (_, index) => {
        const isMain = index < WORKFLOW_DEMO_MAIN_COUNT;
        const ordinal = isMain ? index + 1 : index - WORKFLOW_DEMO_MAIN_COUNT + 1;
        const [offsetX, offsetY] = (isMain ? mainOffsets[index] : detailOffsets[index - WORKFLOW_DEMO_MAIN_COUNT])!;
        return {
            id: `workflow-demo-${runId}-${String(index + 1).padStart(2, "0")}`,
            runId,
            index: index + 1,
            kind: isMain ? "main" : "detail",
            ordinal,
            label: `演示 · ${isMain ? "主图" : "详情"} ${ordinal}`,
            width: isMain ? 176 : 168,
            height: isMain ? 176 : 224,
            naturalWidth: 720,
            naturalHeight: isMain ? 720 : 960,
            offsetX,
            offsetY,
        };
    });
}

export function workflowDemoDelayMs(index: number) {
    return WORKFLOW_DEMO_DELAYS[Math.abs(Math.trunc(index)) % WORKFLOW_DEMO_DELAYS.length];
}

export function rectanglesOverlap(first: Pick<CanvasNodeData, "position" | "width" | "height">, second: Pick<CanvasNodeData, "position" | "width" | "height">, gap = 0) {
    return !(
        first.position.x + first.width + gap <= second.position.x - gap ||
        second.position.x + second.width + gap <= first.position.x - gap ||
        first.position.y + first.height + gap <= second.position.y - gap ||
        second.position.y + second.height + gap <= first.position.y - gap
    );
}

export function findWorkflowDemoOutputPosition(workflowNode: CanvasNodeData, existingNodes: CanvasNodeData[], frame: WorkflowDemoFrame): Position {
    const centerY = workflowNode.position.y + workflowNode.height / 2;
    const base = {
        x: workflowNode.position.x + workflowNode.width + 140 + frame.offsetX,
        y: centerY + frame.offsetY - frame.height / 2,
    };
    const verticalLanes = [-3, -2, -1, 1, 2, 3];
    for (let attempt = 0; attempt < 241; attempt++) {
        const column = attempt === 0 ? 0 : Math.ceil(attempt / verticalLanes.length);
        const lane = attempt === 0 ? 0 : verticalLanes[(attempt - 1) % verticalLanes.length]!;
        const candidate = {
            position: {
                x: base.x + column * (frame.width + 64),
                y: base.y + lane * (frame.height + 52),
            },
            width: frame.width,
            height: frame.height,
        };
        if (!existingNodes.some((node) => rectanglesOverlap(candidate, node, 20))) return candidate.position;
    }
    return { x: base.x + 80 * (frame.width + 64), y: base.y };
}

export function createWorkflowDemoPlaceholder(frame: WorkflowDemoFrame) {
    const canvas = document.createElement("canvas");
    canvas.width = frame.naturalWidth;
    canvas.height = frame.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法绘制演示图片");

    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, frame.kind === "main" ? "#dbeafe" : "#ede9fe");
    gradient.addColorStop(1, frame.kind === "main" ? "#f8fafc" : "#faf5ff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(47,128,255,.35)";
    context.lineWidth = 8;
    context.setLineDash([20, 14]);
    context.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);
    context.setLineDash([]);
    context.fillStyle = "#2563eb";
    context.font = "600 34px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("本地演示占位图", canvas.width / 2, canvas.height / 2 - 42);
    context.fillStyle = "#1f2937";
    context.font = "700 54px system-ui, sans-serif";
    context.fillText(frame.label, canvas.width / 2, canvas.height / 2 + 36);
    context.fillStyle = "#64748b";
    context.font = "400 26px system-ui, sans-serif";
    context.fillText("本地演示 · 不产生费用", canvas.width / 2, canvas.height / 2 + 92);
    return canvas.toDataURL("image/png");
}

export function startWorkflowDemoSequence({ runId, timer, onFrame, onComplete, onError }: WorkflowDemoSequenceOptions) {
    const runtimeTimer: TimerApi =
        timer ||
        ({
            setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
            clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
        } as TimerApi);
    const frames = buildWorkflowDemoFrames(runId);
    let active = true;
    let cursor = 0;
    let handle: unknown;

    const scheduleNext = () => {
        handle = runtimeTimer.setTimeout(() => {
            if (!active) return;
            try {
                onFrame(frames[cursor]!);
                cursor += 1;
                if (cursor >= frames.length) {
                    active = false;
                    onComplete();
                    return;
                }
                scheduleNext();
            } catch (error) {
                active = false;
                onError(error);
            }
        }, workflowDemoDelayMs(cursor));
    };

    scheduleNext();
    return {
        cancel() {
            if (!active) return;
            active = false;
            if (handle !== undefined) runtimeTimer.clearTimeout(handle);
        },
    };
}

export function resetInterruptedWorkflowDemos(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.Workflow) return node;
        const state = readWorkflowDemoState(node.metadata);
        if (state.status === "awaiting_confirmation") {
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    workflowDemo: {
                        ...state,
                        status: state.completedRuns > 0 ? ("completed" as const) : ("idle" as const),
                        producedCount: state.completedRuns > 0 ? WORKFLOW_DEMO_TOTAL : 0,
                        runId: undefined,
                        errorMessage: undefined,
                    },
                },
            };
        }
        if (state.status !== "running") return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                workflowDemo: {
                    ...state,
                    status: "failed" as const,
                    errorMessage: "页面刷新后演示已停止，已经上桌的图片仍然保留。",
                },
            },
        };
    });
}

function clampInteger(value: unknown, minimum: number, maximum: number) {
    const number = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : minimum;
    return Math.min(maximum, Math.max(minimum, number));
}

function finiteTimestamp(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
