import { Button, Modal } from "antd";
import { Clock3, Coins, Images, ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { WorkflowProductionQuote } from "@/lib/canvas/canvas-workflow-production";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasWorkflowProductionCostCard({ open, batchId, materialCount, quote, onConfirm, onCancel }: { open: boolean; batchId?: string; materialCount: number; quote?: WorkflowProductionQuote; onConfirm: () => void; onCancel: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const rows = [
        { icon: <Images className="size-4" />, label: "本次还需制作", value: `${quote?.remainingCount ?? 0} 张` },
        { icon: <Coins className="size-4" />, label: "预计金额", value: `约 $${(quote?.estimatedTotalUsd ?? 0).toFixed(2)}` },
        { icon: <Clock3 className="size-4" />, label: "预计时长", value: `约 ${quote?.estimatedMinutes ?? 0} 分钟` },
    ];
    return (
        <Modal open={open} centered width={520} title="确认真实制作费用" mask={{ closable: false }} onCancel={onCancel} footer={<div className="flex justify-end gap-2"><Button onClick={onCancel}>取消</Button><Button type="primary" danger onClick={onConfirm}>确认费用并开始</Button></div>}>
            <div className="pt-2 text-sm" style={{ color: theme.node.text }}>
                <div className="mb-3 text-xs" style={{ color: theme.node.muted }}>批次：{batchId || "待核对"} · 已连接 {materialCount} 张素材</div>
                <div className="grid gap-3 rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {rows.map((row) => <div key={row.label} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>{row.icon}</span><span style={{ color: theme.node.muted }}>{row.label}</span><span className="ml-auto font-semibold">{row.value}</span></div>)}
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.activeBg }}><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>金额和时长都是当前缺图数量的估算。确认后机器才会进入真实制作；任一步失败都会停下，不会自动重试。</span></div>
                <div className="mt-3 text-xs" style={{ color: theme.node.muted }}>取消不会写入命令、不会修改批次，也不会产生费用。</div>
            </div>
        </Modal>
    );
}
