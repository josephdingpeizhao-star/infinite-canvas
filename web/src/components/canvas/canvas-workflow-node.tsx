import { CheckCircle2, CircleAlert, Info, LoaderCircle, Play, Workflow } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { readWorkflowDemoState, WORKFLOW_DEMO_DETAIL_COUNT, WORKFLOW_DEMO_MAIN_COUNT, WORKFLOW_DEMO_TOTAL } from "@/lib/canvas/canvas-workflow-demo";
import { COMPLETED_PRODUCTION_ACTION_LABEL, completedProductionStatusText, readProductionState } from "@/lib/canvas/canvas-workflow-production";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasWorkflowDemoStatus, CanvasWorkflowProductionStatus } from "@/types/canvas";

export function CanvasWorkflowNode({ node, connectedImageCount, production, onStart, onToggleDetails }: { node: CanvasNodeData; connectedImageCount: number; production?: { batchId: string; materialCount: number }; onStart: (nodeId: string) => void; onToggleDetails: (nodeId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const demoState = readWorkflowDemoState(node.metadata);
    const productionState = readProductionState(node.metadata);
    const state = production ? productionState : demoState;
    const running = state.status === "running";
    const queued = state.status === "queued";
    const awaitingConfirmation = !production && demoState.status === "awaiting_confirmation";
    const statusLabel = production ? productionStatusLabel(productionState.status) : workflowStatusLabel(demoState.status);
    const statusText = production ? productionStatusText(productionState.status, productionState.producedCount, productionState.message, productionState.errorMessage) : workflowStatusText(demoState.status, demoState.producedCount, connectedImageCount, demoState.errorMessage);

    return (
        <div className="flex h-full w-full cursor-move flex-col gap-3 p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: theme.toolbar.activeBg, color: theme.node.text }}>
                    <Workflow className="size-5" />
                </span>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">生图工作流</span>
                        <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                            {production ? "真实" : "演示"}
                        </span>
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                        {production ? `真实制作 · ${production.batchId}` : "零成本彩排 · 费用 0 元"}
                    </div>
                </div>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.panel, color: theme.node.muted }}>
                    {statusIcon(state.status)}
                    {statusLabel}
                </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <SummaryCell label="已连接" value={`${production?.materialCount ?? connectedImageCount} 张`} />
                <SummaryCell label="主图" value={`${WORKFLOW_DEMO_MAIN_COUNT} 张`} />
                <SummaryCell label="详情" value={`${WORKFLOW_DEMO_DETAIL_COUNT} 张`} />
            </div>

            <div className="min-h-12 rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: state.status === "failed" ? "#f87171" : theme.node.muted }}>
                {statusText}
            </div>

            <div className="mt-auto flex items-center gap-2">
                <button
                    type="button"
                    className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-55"
                    style={{ borderColor: theme.node.activeStroke, background: theme.node.activeStroke, color: theme.node.panel }}
                    disabled={running || queued || awaitingConfirmation}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onStart(node.id);
                    }}
                >
                    {running || queued ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                    {production ? productionActionLabel(productionState.status) : workflowActionLabel(demoState.status)}
                </button>
                <button
                    type="button"
                    className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border transition hover:scale-[1.03]"
                    style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}
                    aria-label="查看演示信息"
                    title="查看演示信息"
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleDetails(node.id);
                    }}
                >
                    <Info className="size-4" />
                </button>
            </div>
        </div>
    );
}

export function CanvasWorkflowNodePanel({ productionBatchId, onClose }: { productionBatchId?: string; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const fields = [
        ["品类", "保温杯演示"],
        ["高度", "24 厘米"],
        ["主图", "6 张"],
        ["详情图", "8 张"],
        ["手持", "主图 2 张 + 详情 1 张"],
    ];
    return (
        <div className="rounded-2xl border p-4 shadow-xl backdrop-blur" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-sm font-semibold">{productionBatchId ? "真实制作信息" : "演示信息"}</div>
                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                        {productionBatchId ? `当前批次：${productionBatchId}。九道工序在后台运行，不会铺到画布。` : "当前展示固定演示信息，暂不可修改。"}
                    </div>
                </div>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:opacity-100" onClick={onClose} aria-label="关闭演示信息">
                    ×
                </button>
            </div>
            <div className="mt-4 grid gap-2">
                {fields.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                        <span style={{ color: theme.node.muted }}>{label}</span>
                        <span className="font-medium">{value}</span>
                    </div>
                ))}
            </div>
            <div className="mt-3 text-[11px]" style={{ color: theme.node.muted }}>
                共 {WORKFLOW_DEMO_TOTAL} 张 · {productionBatchId ? "真实费用每次开始前单独确认" : "演示模式不产生任何费用"}
            </div>
        </div>
    );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="rounded-xl border px-2 py-2" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <div style={{ color: theme.node.muted }}>{label}</div>
            <div className="mt-0.5 font-semibold">{value}</div>
        </div>
    );
}

function workflowStatusLabel(status: CanvasWorkflowDemoStatus) {
    if (status === "awaiting_confirmation") return "待确认";
    if (status === "queued") return "排队中";
    if (status === "running") return "制作中";
    if (status === "completed") return "完成";
    if (status === "failed") return "需处理";
    return "待机";
}

function workflowStatusText(status: CanvasWorkflowDemoStatus, producedCount: number, connectedImageCount: number, errorMessage?: string) {
    if (status === "awaiting_confirmation") return "等待确认本次 0 元演示费用。";
    if (status === "queued") return "已提交，等待本机演示服务接单。";
    if (status === "running") return `正在生成第 ${Math.min(producedCount + 1, WORKFLOW_DEMO_TOTAL)}/${WORKFLOW_DEMO_TOTAL} 张，已完成 ${producedCount} 张。`;
    if (status === "completed") return `${WORKFLOW_DEMO_TOTAL} 张演示图已上桌。再次开始会保留旧图。`;
    if (status === "failed") return errorMessage || "演示没有完成，已经上桌的图片仍然保留。";
    return connectedImageCount ? `已连接 ${connectedImageCount} 张素材，可以开始演示。` : "请先把至少 1 张图片素材连到左侧输入点。";
}

function workflowActionLabel(status: CanvasWorkflowDemoStatus) {
    if (status === "running") return "演示进行中";
    if (status === "queued") return "等待接单";
    if (status === "awaiting_confirmation") return "等待确认";
    if (status === "completed") return "再次开始";
    if (status === "failed") return "重新开始";
    return "开始";
}

function statusIcon(status: CanvasWorkflowDemoStatus | CanvasWorkflowProductionStatus) {
    if (status === "running" || status === "queued") return <LoaderCircle className="size-3 animate-spin" />;
    if (status === "completed") return <CheckCircle2 className="size-3" />;
    if (status === "failed") return <CircleAlert className="size-3" />;
    return null;
}

function productionStatusLabel(status: CanvasWorkflowProductionStatus) {
    if (status === "queued") return "等待接单";
    if (status === "running") return "制作中";
    if (status === "paused") return "已暂停";
    if (status === "completed") return "已完成";
    if (status === "failed") return "需处理";
    return "待机";
}

function productionStatusText(status: CanvasWorkflowProductionStatus, producedCount: number, message?: string, errorMessage?: string) {
    if (status === "queued") return "费用已确认，等待本机工作台接单。";
    if (status === "running") return message || `正在制作，已完成 ${producedCount}/${WORKFLOW_DEMO_TOTAL} 张。`;
    if (status === "paused") return `已完成 ${producedCount}/${WORKFLOW_DEMO_TOTAL} 张。成果都已保留；再次开始会从既有路由续跑。`;
    if (status === "completed") return completedProductionStatusText(message);
    if (status === "failed") return errorMessage || "这一步没做好，机器已停下。已经完成的成果都保留了。";
    return "已连接已登记批次。点击开始后先核对真实费用，确认前不会执行。";
}

function productionActionLabel(status: CanvasWorkflowProductionStatus) {
    if (status === "queued") return "等待接单";
    if (status === "running") return "真实制作中";
    if (status === "paused") return "继续制作";
    if (status === "completed") return COMPLETED_PRODUCTION_ACTION_LABEL;
    if (status === "failed") return "重新开始";
    return "开始真实制作";
}
