import { Switch } from "antd";
import { CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { BATCH_INTAKE_DETAIL_COUNT, BATCH_INTAKE_HANDHELD_DETAIL_COUNT, BATCH_INTAKE_HANDHELD_MAIN_COUNT, BATCH_INTAKE_MAIN_COUNT, BATCH_INTAKE_TOTAL, readBatchIntakeState } from "@/lib/canvas/canvas-batch-intake";
import { batchRegistrationButtonLabel, styleSupplementButtonLabel } from "@/lib/canvas/canvas-intake-role-visibility";
import { readStyleReferenceState } from "@/lib/canvas/canvas-style-reference-intake";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasBatchIntakeMetadata, CanvasNodeData } from "@/types/canvas";

type EditableFacts = Pick<CanvasBatchIntakeMetadata, "productType" | "productHeightCm" | "allowClearWater" | "prohibitPouringAndHeating" | "skipMissingDAngle">;

export function CanvasBatchInfoNode({
    node,
    connectedOriginalCount,
    connectedStyleReferenceCount,
    connectedOriginalFileNames,
    connectedStyleReferenceFileNames,
    onChange,
    onRegister,
    onSupplementStyle,
}: {
    node: CanvasNodeData;
    connectedOriginalCount: number;
    connectedStyleReferenceCount: number;
    connectedOriginalFileNames: string[];
    connectedStyleReferenceFileNames: string[];
    onChange: (nodeId: string, patch: Partial<EditableFacts>) => void;
    onRegister: (nodeId: string) => void;
    onSupplementStyle: (nodeId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const state = readBatchIntakeState(node.metadata);
    const editable = state.status === "draft" || state.status === "failed";
    const busy = state.status === "queued" || state.status === "upload_ready" || state.status === "uploading";
    const completed = state.status === "completed";
    const integrityBlocked = state.status === "integrity_blocked";
    const batchId = state.receipt?.batchId || state.batchId;
    const imageCount = state.receipt?.imageCount ?? state.receivedCount ?? state.expectedCount ?? connectedOriginalCount;
    const styleState = readStyleReferenceState(node.metadata);
    const styleBusy = styleState.status === "queued" || styleState.status === "upload_ready" || styleState.status === "uploading";
    const styleBlocked = styleState.status === "integrity_blocked";

    return (
        <div className="flex h-full w-full cursor-move flex-col gap-3 overflow-y-auto p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: theme.toolbar.activeBg, color: theme.node.text }}>
                    <ClipboardList className="size-5" />
                </span>
                <div className="min-w-0">
                    <div className="text-sm font-semibold">批次信息卡</div>
                    <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                        只登记批次 · 不生图 · 不收费
                    </div>
                </div>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.panel, color: statusColor(state.status, theme.node.muted) }}>
                    {statusIcon(state.status)}
                    {statusLabel(state.status)}
                </span>
            </div>

            {completed ? (
                <div className="grid gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: theme.node.activeStroke, background: theme.node.panel }}>
                    <ReceiptRow label="批次号" value={batchId || "登记完成"} />
                    <ReceiptRow label="接收原图" value={`${imageCount} 张`} />
                    <ReceiptRow label="品类" value={state.productType} />
                    <ReceiptRow label="高度" value={`${state.productHeightCm} 厘米`} />
                    <ReceiptRow label="清水场景" value={state.allowClearWater ? "允许" : "不允许"} />
                    <ReceiptRow label="倾倒与加热" value={state.prohibitPouringAndHeating ? "禁止" : "不禁止"} />
                    <ReceiptRow label="缺少 D 角度" value={state.skipMissingDAngle ? "不补拍" : "需要补拍"} />
                    <ReceiptRow label="固定张数" value="主图 6 + 详情 8" />
                    <ReceiptRow label="固定手持" value="主图 2 + 详情 1" />
                    <div className="mt-1 border-t pt-2" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center justify-between gap-3"><span style={{ color: theme.node.muted }}>风格参考</span><span className="font-medium">已连 {connectedStyleReferenceCount} 张</span></div>
                        <div className="mt-1 text-[11px] leading-5" style={{ color: styleState.status === "failed" || styleBlocked ? "#f87171" : theme.node.muted }}>{styleReferenceText(styleState.status, styleState.receipt?.fileCount, styleState.errorMessage)}</div>
                        <IntakeFileList label="即将补登的风格参考图" names={connectedStyleReferenceFileNames} emptyText="尚未连接风格参考图" />
                        <button
                            type="button"
                            className="mt-2 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-55"
                            style={{ borderColor: styleBlocked ? "#ef4444" : theme.node.activeStroke, background: styleBlocked ? "transparent" : theme.node.activeStroke, color: styleBlocked ? "#f87171" : theme.node.panel }}
                            disabled={styleBusy || styleBlocked}
                            onMouseDown={stopEvent}
                            onPointerDown={stopEvent}
                            onClick={(event) => { event.stopPropagation(); onSupplementStyle(node.id); }}
                        >
                            {styleBusy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                            {styleSupplementButtonLabel(connectedStyleReferenceCount, styleBusy, styleBlocked)}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                        <SummaryCell label="已连原图" value={`${connectedOriginalCount} 张`} />
                        <SummaryCell label="主图" value={`${BATCH_INTAKE_MAIN_COUNT} 张`} />
                        <SummaryCell label="详情" value={`${BATCH_INTAKE_DETAIL_COUNT} 张`} />
                    </div>

                    <div className="grid gap-2">
                        <label className="grid gap-1 text-[11px]" style={{ color: theme.node.muted }} onMouseDown={stopEvent} onPointerDown={stopEvent}>
                            产品品类
                            <input
                                className="h-9 cursor-text rounded-lg border bg-transparent px-3 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.panel }}
                                value={state.productType}
                                disabled={!editable}
                                placeholder="例如：餐具"
                                onChange={(event) => onChange(node.id, { productType: event.target.value })}
                            />
                        </label>
                        <label className="grid gap-1 text-[11px]" style={{ color: theme.node.muted }} onMouseDown={stopEvent} onPointerDown={stopEvent}>
                            产品高度（厘米，正整数）
                            <input
                                type="number"
                                min={1}
                                step={1}
                                className="h-9 cursor-text rounded-lg border bg-transparent px-3 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.panel }}
                                value={state.productHeightCm ?? ""}
                                disabled={!editable}
                                placeholder="例如：25"
                                onChange={(event) => onChange(node.id, { productHeightCm: event.target.value === "" ? undefined : Number(event.target.value) })}
                            />
                        </label>
                    </div>

                    <div className="grid gap-1.5 rounded-xl border p-2.5 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                        <FactSwitch label="允许清水场景" checked={state.allowClearWater} disabled={!editable} onChange={(allowClearWater) => onChange(node.id, { allowClearWater })} />
                        <FactSwitch label="禁止倾倒与加热" checked={state.prohibitPouringAndHeating} disabled={!editable} onChange={(prohibitPouringAndHeating) => onChange(node.id, { prohibitPouringAndHeating })} />
                        <FactSwitch label="缺少 D 角度时不补拍" checked={state.skipMissingDAngle} disabled={!editable} onChange={(skipMissingDAngle) => onChange(node.id, { skipMissingDAngle })} />
                    </div>

                    <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                        <span>共 {BATCH_INTAKE_TOTAL} 张</span>
                        <span>
                            手持：主 {BATCH_INTAKE_HANDHELD_MAIN_COUNT} + 详情 {BATCH_INTAKE_HANDHELD_DETAIL_COUNT}
                        </span>
                    </div>
                </>
            )}

            <div
                className="min-h-11 rounded-xl border px-3 py-2 text-[11px] leading-5"
                style={{ borderColor: integrityBlocked ? "#ef4444" : theme.node.stroke, background: theme.node.panel, color: state.status === "failed" || integrityBlocked ? "#f87171" : theme.node.muted }}
            >
                {statusText(state, connectedOriginalCount)}
            </div>

            {!completed ? (
                <div className="mt-auto grid gap-2">
                    <IntakeFileList label="即将登记的产品原图" names={connectedOriginalFileNames} emptyText="尚未连接产品原图" />
                    <button
                        type="button"
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: integrityBlocked ? "#ef4444" : theme.node.activeStroke, background: integrityBlocked ? "transparent" : theme.node.activeStroke, color: integrityBlocked ? "#f87171" : theme.node.panel }}
                        disabled={busy || integrityBlocked}
                        onMouseDown={stopEvent}
                        onPointerDown={stopEvent}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRegister(node.id);
                        }}
                    >
                        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                        {batchRegistrationButtonLabel(connectedOriginalCount, busy, integrityBlocked)}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function FactSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between gap-3" onMouseDown={stopEvent} onPointerDown={stopEvent}>
            <span>{label}</span>
            <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
        </label>
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

function ReceiptRow({ label, value }: { label: string; value: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="flex items-center justify-between gap-3">
            <span style={{ color: theme.node.muted }}>{label}</span>
            <span className="text-right font-medium">{value}</span>
        </div>
    );
}

function IntakeFileList({ label, names, emptyText }: { label: string; names: string[]; emptyText: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="grid gap-1 rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <span style={{ color: theme.node.muted }}>{label}</span>
            {names.length ? names.map((name, index) => <span key={`${name}-${index}`} className="truncate" title={name}>{name}</span>) : <span style={{ color: theme.node.muted }}>{emptyText}</span>}
        </div>
    );
}

function statusLabel(status: CanvasBatchIntakeMetadata["status"]) {
    if (status === "queued") return "等待接单";
    if (status === "upload_ready") return "准备接收";
    if (status === "uploading") return "接收原图";
    if (status === "completed") return "登记完成";
    if (status === "failed") return "需处理";
    if (status === "integrity_blocked") return "硬停止";
    return "待填写";
}

function statusText(state: CanvasBatchIntakeMetadata, connectedOriginalCount: number) {
    if (state.status === "queued") return "登记命令已提交，等待本机画布工作台服务接单。";
    if (state.status === "upload_ready") return "本机服务已接单，正在核对浏览器存储与磁盘原图。";
    if (state.status === "uploading") return `正在无损接收原图，已确认 ${state.receivedCount || 0}/${state.expectedCount || connectedOriginalCount} 张。`;
    if (state.status === "completed") return "批次已登记。可先补登风格参考，再从已连接的工作流机器开始真实制作。";
    if (state.status === "integrity_blocked") return state.errorMessage || "原图 SHA-256 不一致，已立即硬停止。不会重试，也不会降低无损标准。";
    if (state.status === "failed") return state.errorMessage || "本次没有登记成功，未自动重试。请处理提示后重新登记。";
    return connectedOriginalCount ? `已连接 ${connectedOriginalCount} 张磁盘原图；填写完成后可登记。` : "请把信息卡和至少 1 张磁盘原图连接到同一台工作流机器。";
}

function styleReferenceText(status: ReturnType<typeof readStyleReferenceState>["status"], fileCount?: number, errorMessage?: string) {
    if (status === "queued") return "补登命令已提交，等待本机服务接单。";
    if (status === "upload_ready" || status === "uploading") return "正在逐字节核对并补登，不会重写原图和旧凭证。";
    if (status === "completed") return `已补登 ${fileCount || 0} 张，并生成独立回执。`;
    if (status === "integrity_blocked") return errorMessage || "文件不一致，已硬停止且不会自动重试。";
    if (status === "failed") return errorMessage || "本次补登已停止，不会自动重试。";
    return "把磁盘风格图直接连到信息卡后再点补登。";
}

function statusIcon(status: CanvasBatchIntakeMetadata["status"]) {
    if (status === "queued" || status === "upload_ready" || status === "uploading") return <LoaderCircle className="size-3 animate-spin" />;
    if (status === "completed") return <CheckCircle2 className="size-3" />;
    if (status === "failed" || status === "integrity_blocked") return <CircleAlert className="size-3" />;
    return null;
}

function statusColor(status: CanvasBatchIntakeMetadata["status"], fallback: string) {
    if (status === "failed" || status === "integrity_blocked") return "#f87171";
    return fallback;
}

function stopEvent(event: { stopPropagation: () => void }) {
    event.stopPropagation();
}
