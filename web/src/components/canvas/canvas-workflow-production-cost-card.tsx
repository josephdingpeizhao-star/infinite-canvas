import { Button, Modal } from "antd";
import { BrainCircuit, Clock3, Images, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { productionConfirmationCopy, type WorkflowProductionQuote } from "@/lib/canvas/canvas-workflow-production";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasWorkflowProductionCostCard({ open, batchId, materialCount, quote, onConfirm, onCancel }: { open: boolean; batchId?: string; materialCount: number; quote?: WorkflowProductionQuote; onConfirm: () => void; onCancel: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copy = productionConfirmationCopy(quote);
    const rowIcons = {
        remaining: <Images className="size-4" />,
        textModel: <BrainCircuit className="size-4" />,
        quality: <SlidersHorizontal className="size-4" />,
        duration: <Clock3 className="size-4" />,
    };
    return (
        <Modal open={open} centered width={520} title={copy.title} mask={{ closable: false }} onCancel={onCancel} footer={<div className="flex justify-end gap-2"><Button onClick={onCancel}>取消</Button><Button type="primary" danger onClick={onConfirm}>{copy.buttonLabel}</Button></div>}>
            <div className="pt-2 text-sm" style={{ color: theme.node.text }}>
                <div className="mb-3 text-xs" style={{ color: theme.node.muted }}>批次：{batchId || "待核对"} · 已连接 {materialCount} 张素材</div>
                <div className="grid gap-3 rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {copy.rows.map((row) => <div key={row.key} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>{rowIcons[row.key]}</span><span style={{ color: theme.node.muted }}>{row.label}</span><span className="ml-auto font-semibold">{row.value}</span></div>)}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.activeBg }}><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>{copy.notice}</span></div>
                <div className="mt-3 text-xs" style={{ color: theme.node.muted }}>{copy.footnote}</div>
            </div>
        </Modal>
    );
}
