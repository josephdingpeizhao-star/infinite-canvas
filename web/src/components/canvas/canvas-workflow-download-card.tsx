import { Button, Modal } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasWorkflowDownloadCard({ open, batchId, imageCount, onDownloadZip, onDownloadIndividually, onCancel }: { open: boolean; batchId?: string; imageCount: number; onDownloadZip: () => void; onDownloadIndividually: () => void; onCancel: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <Modal open={open} centered width={480} title="选择下载方式" onCancel={onCancel} footer={<div className="flex justify-end gap-2"><Button onClick={onCancel}>取消</Button><Button onClick={onDownloadIndividually}>逐张下载</Button><Button type="primary" onClick={onDownloadZip}>打包为 ZIP 下载</Button></div>}>
            <div className="pt-2 text-sm" style={{ color: theme.node.text }}>
                <div className="rounded-xl border px-3 py-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <div>批次：{batchId || "待核对"}</div>
                    <div className="mt-1" style={{ color: theme.node.muted }}>本次下载 {imageCount} 张图片</div>
                </div>
                <div className="mt-3 text-xs" style={{ color: theme.node.muted }}>逐张下载时浏览器可能询问是否允许下载多个文件</div>
            </div>
        </Modal>
    );
}
