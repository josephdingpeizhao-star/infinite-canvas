import { Button, Modal } from "antd";
import { Clock3, Coins, Images, ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { WORKFLOW_DEMO_TOTAL } from "@/lib/canvas/canvas-workflow-demo";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasWorkflowCostCard({ open, connectedImageCount, onConfirm, onCancel }: { open: boolean; connectedImageCount: number; onConfirm: () => void; onCancel: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const rows = [
        { icon: <Images className="size-4" />, label: "本次张数", value: `${WORKFLOW_DEMO_TOTAL} 张` },
        { icon: <Coins className="size-4" />, label: "演示费用", value: "0 元" },
        { icon: <Clock3 className="size-4" />, label: "预计时长", value: "约 30 秒" },
    ];
    return (
        <Modal
            open={open}
            centered
            width={520}
            title="开始演示前确认"
            mask={{ closable: false }}
            onCancel={onCancel}
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onCancel}>取消</Button>
                    <Button type="primary" onClick={onConfirm}>
                        确认开始
                    </Button>
                </div>
            }
        >
            <div className="pt-2 text-sm" style={{ color: theme.node.text }}>
                <div className="rounded-2xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <div className="grid gap-3">
                        {rows.map((row) => (
                            <div key={row.label} className="flex items-center gap-3">
                                <span className="grid size-8 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                                    {row.icon}
                                </span>
                                <span style={{ color: theme.node.muted }}>{row.label}</span>
                                <span className="ml-auto font-semibold">{row.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.activeBg }}>
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                    <span>所有图片都由当前网页直接绘制，只用于演示，不会产生任何费用，也不会把素材发送到外部服务。</span>
                </div>
                <div className="mt-3 text-xs" style={{ color: theme.node.muted }}>
                    已连接 {connectedImageCount} 张图片素材。取消后不会生成任何内容。
                </div>
            </div>
        </Modal>
    );
}
