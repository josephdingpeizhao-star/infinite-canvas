import { useState } from "react";
import { CheckCircle2, CircleAlert, ClipboardList, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";

import { CanvasBatchAdvancedOptions } from "@/components/canvas/canvas-batch-advanced-options";
import { canvasThemes } from "@/lib/canvas-theme";
import { BATCH_CATEGORY_UNAVAILABLE_MESSAGE, detailHandheldLimitMessage, handheldCountMaximum, readBatchIntakeState } from "@/lib/canvas/canvas-batch-intake";
import { batchRegistrationButtonLabel, styleRemovalButtonLabel, styleSupplementButtonLabel } from "@/lib/canvas/canvas-intake-role-visibility";
import { readStyleReferenceRemovalState, readStyleReferenceState } from "@/lib/canvas/canvas-style-reference-intake";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasBatchCategoryCatalog, CanvasBatchCategoryMetadata, CanvasBatchDimensionKey, CanvasBatchIntakeMetadata, CanvasNodeData } from "@/types/canvas";

type EditableFacts = Pick<
    CanvasBatchIntakeMetadata,
    "category" | "productLengthCm" | "productWidthCm" | "productHeightCm" | "mainImageCount" | "detailImageCount" | "handheldMainCount" | "handheldDetailCount" | "prohibitPouringAndHeating" | "skipMissingDAngle"
>;

export function CanvasBatchInfoNode({
    node,
    connectedOriginalCount,
    connectedStyleReferenceCount,
    connectedOriginalFileNames,
    connectedStyleReferenceFileNames,
    categoryCatalog,
    categoryCatalogStatus,
    onChange,
    onRegister,
    onSupplementStyle,
    onRemoveStyle,
}: {
    node: CanvasNodeData;
    connectedOriginalCount: number;
    connectedStyleReferenceCount: number;
    connectedOriginalFileNames: string[];
    connectedStyleReferenceFileNames: string[];
    categoryCatalog?: CanvasBatchCategoryCatalog;
    categoryCatalogStatus: "loading" | "ready" | "error";
    onChange: (nodeId: string, patch: Partial<EditableFacts>) => void;
    onRegister: (nodeId: string) => void;
    onSupplementStyle: (nodeId: string) => void;
    onRemoveStyle?: (nodeId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const state = readBatchIntakeState(node.metadata);
    const [advancedExpanded, setAdvancedExpanded] = useState(false);
    const category = categoryCatalog?.categories.find((item) => item.key === state.category);
    const editable = (state.status === "draft" || state.status === "failed") && categoryCatalogStatus === "ready";
    const busy = state.status === "queued" || state.status === "upload_ready" || state.status === "uploading";
    const completed = state.status === "completed";
    const integrityBlocked = state.status === "integrity_blocked";
    const batchId = state.receipt?.batchId || state.batchId;
    const imageCount = state.receipt?.imageCount ?? state.receivedCount ?? state.expectedCount ?? connectedOriginalCount;
    const styleState = readStyleReferenceState(node.metadata);
    const styleBusy = styleState.status === "queued" || styleState.status === "upload_ready" || styleState.status === "uploading";
    const removalState = readStyleReferenceRemovalState(node.metadata);
    const removalBusy = removalState.status === "queued";
    const styleActionBusy = styleBusy || removalBusy;
    const hasRegisteredStyle = (styleState.receipt?.fileCount || 0) > 0 && removalState.status !== "completed";
    const styleBlocked = styleState.status === "integrity_blocked";
    const countError = category ? imageCountError(state, category) : undefined;
    const totalCount =
        category && validImageCount(state.mainImageCount, category.form.image_counts.main) && validImageCount(state.detailImageCount, category.form.image_counts.detail)
            ? state.mainImageCount + state.detailImageCount
            : undefined;

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
                    <ReceiptRow label="品类" value={category?.display_name || state.category || "品类信息暂不可用"} />
                    {category ? category.form.dimensions.fields.filter((field) => dimensionValue(state, field.key) !== undefined).map((field) => (
                        <ReceiptRow key={field.key} label={field.label} value={`${dimensionValue(state, field.key)} ${field.unit}`} />
                    )) : null}
                    <ReceiptRow label="本批张数" value={`主图 ${state.mainImageCount ?? "—"} + 详情 ${state.detailImageCount ?? "—"}`} />
                    <ReceiptRow label="手持数量" value={`主图 ${state.handheldMainCount ?? "—"} + 详情 ${state.handheldDetailCount ?? "—"}`} />
                    {category ? category.form.advanced_options.map((option) => (
                        <ReceiptRow key={option.field} label={option.label} value={advancedValue(state, option.field) ? "开" : "关"} />
                    )) : null}
                    <div className="mt-1 border-t pt-2" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center justify-between gap-3"><span style={{ color: theme.node.muted }}>风格参考</span><span className="font-medium">已连 {connectedStyleReferenceCount} 张</span></div>
                        <div className="mt-1 text-[11px] leading-5" style={{ color: styleState.status === "failed" || removalState.status === "failed" || styleBlocked ? "#f87171" : theme.node.muted }}>{styleReferenceText(styleState.status, styleState.receipt?.fileCount, styleState.errorMessage, removalState.status, removalState.errorMessage)}</div>
                        <IntakeFileList label="即将补登的风格参考图" names={connectedStyleReferenceFileNames} emptyText="尚未连接风格参考图" />
                        <button
                            type="button"
                            className="mt-2 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-55"
                            style={{ borderColor: styleBlocked ? "#ef4444" : theme.node.activeStroke, background: styleBlocked ? "transparent" : theme.node.activeStroke, color: styleBlocked ? "#f87171" : theme.node.panel }}
                            disabled={styleActionBusy || styleBlocked}
                            onMouseDown={stopEvent}
                            onPointerDown={stopEvent}
                            onClick={(event) => { event.stopPropagation(); onSupplementStyle(node.id); }}
                        >
                            {styleBusy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                            {styleSupplementButtonLabel(connectedStyleReferenceCount, styleBusy, styleBlocked)}
                        </button>
                        {hasRegisteredStyle ? (
                            <button
                                type="button"
                                className="mt-2 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-55"
                                style={{ borderColor: "#ef4444", background: "transparent", color: "#f87171" }}
                                disabled={styleActionBusy || !onRemoveStyle}
                                onMouseDown={stopEvent}
                                onPointerDown={stopEvent}
                                onClick={(event) => { event.stopPropagation(); onRemoveStyle?.(node.id); }}
                            >
                                {removalBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                                {styleRemovalButtonLabel(removalBusy)}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                        <SummaryCell label="已连原图" value={`${connectedOriginalCount} 张`} />
                        <ImageCountField
                            label="主图"
                            value={state.mainImageCount}
                            minimum={category?.form.image_counts.main.minimum}
                            maximum={category?.form.image_counts.main.maximum}
                            disabled={!editable || !category}
                            onChange={(mainImageCount) => onChange(node.id, { mainImageCount })}
                        />
                        <ImageCountField
                            label="详情"
                            value={state.detailImageCount}
                            minimum={category?.form.image_counts.detail.minimum}
                            maximum={category?.form.image_counts.detail.maximum}
                            disabled={!editable || !category}
                            onChange={(detailImageCount) => onChange(node.id, { detailImageCount })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <label className="grid gap-1 text-[11px]" style={{ color: theme.node.muted }} onMouseDown={stopEvent} onPointerDown={stopEvent}>
                            产品品类
                            <select
                                className="h-9 cursor-pointer rounded-lg border px-3 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.panel }}
                                value={category?.key || ""}
                                disabled={!editable}
                                onChange={(event) => onChange(node.id, { category: event.target.value })}
                            >
                                <option value="" disabled>{categoryCatalogStatus === "loading" ? "正在读取品类…" : "请选择产品品类"}</option>
                                {(categoryCatalog?.categories || []).map((item) => <option key={item.key} value={item.key}>{item.display_name}</option>)}
                            </select>
                        </label>
                        {category ? (
                            <div className="grid grid-cols-3 gap-2">
                                {category.form.dimensions.fields.map((field) => (
                                    <NumberField
                                        key={field.key}
                                        label={`${field.label}${category.form.dimensions.required.includes(field.key) ? " *" : ""}`}
                                        value={dimensionValue(state, field.key)}
                                        minimum={field.minimum}
                                        maximum={field.maximum}
                                        unit={field.unit}
                                        disabled={!editable}
                                        onChange={(value) => onChange(node.id, { [dimensionStateKey(field.key)]: value })}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>

                    {category ? (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <NumberField
                                    label="主图手持"
                                    value={state.handheldMainCount}
                                    minimum={category.form.handheld.main.minimum}
                                    maximum={validImageCount(state.mainImageCount, category.form.image_counts.main) ? state.mainImageCount : category.form.image_counts.main.maximum}
                                    disabled={!editable}
                                    onChange={(handheldMainCount) => onChange(node.id, { handheldMainCount })}
                                />
                                <NumberField
                                    label="详情图手持"
                                    value={state.handheldDetailCount}
                                    minimum={category.form.handheld.detail.minimum}
                                    maximum={handheldCountMaximum("detail", validImageCount(state.detailImageCount, category.form.image_counts.detail) ? state.detailImageCount : category.form.image_counts.detail.maximum)}
                                    disabled={!editable}
                                    onChange={(handheldDetailCount) => onChange(node.id, { handheldDetailCount })}
                                />
                            </div>
                            <CanvasBatchAdvancedOptions
                                category={category}
                                state={state}
                                editable={editable}
                                expanded={advancedExpanded}
                                onExpandedChange={setAdvancedExpanded}
                                onChange={(patch) => onChange(node.id, patch)}
                            />
                        </>
                    ) : null}

                    <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-[11px]" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                        <span>共 {totalCount ?? "—"} 张</span>
                        <span>
                            手持：主 {state.handheldMainCount ?? "—"} + 详情 {state.handheldDetailCount ?? "—"}
                        </span>
                    </div>
                    <div className="grid gap-2 rounded-xl border px-3 py-2 text-[11px] opacity-65" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>
                        <div className="flex items-center justify-between gap-3">
                            <span>风格参考</span>
                            <span className="font-medium">已连 {connectedStyleReferenceCount} 张</span>
                        </div>
                        <IntakeFileList label="已连接的风格参考图" names={connectedStyleReferenceFileNames} emptyText="尚未连接风格参考图" />
                        <button
                            type="button"
                            className="inline-flex min-h-9 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold opacity-55"
                            style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.muted }}
                            disabled
                        >
                            <ShieldCheck className="size-4" />
                            登记完成后可补登
                        </button>
                        <div>先登记产品原图；批次登记完成后这里才能补登风格参考图（每批 1 张）。</div>
                    </div>
                </>
            )}

            <div
                className="min-h-11 rounded-xl border px-3 py-2 text-[11px] leading-5"
                style={{ borderColor: integrityBlocked ? "#ef4444" : theme.node.stroke, background: theme.node.panel, color: state.status === "failed" || integrityBlocked ? "#f87171" : theme.node.muted }}
            >
                {categoryCatalogStatus === "loading" && !completed ? "正在读取已安装的产品品类…" : categoryCatalogStatus === "error" && !completed ? BATCH_CATEGORY_UNAVAILABLE_MESSAGE : countError || statusText(state, connectedOriginalCount)}
            </div>

            {!completed ? (
                <div className="mt-auto grid gap-2">
                    <IntakeFileList label="即将登记的产品原图" names={connectedOriginalFileNames} emptyText="尚未连接产品原图" />
                    <button
                        type="button"
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: integrityBlocked ? "#ef4444" : theme.node.activeStroke, background: integrityBlocked ? "transparent" : theme.node.activeStroke, color: integrityBlocked ? "#f87171" : theme.node.panel }}
                        disabled={busy || integrityBlocked || categoryCatalogStatus !== "ready" || !category}
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

function NumberField({
    label,
    value,
    minimum,
    maximum,
    unit,
    disabled,
    onChange,
}: {
    label: string;
    value?: number;
    minimum: number;
    maximum: number;
    unit?: string;
    disabled: boolean;
    onChange: (value: number | undefined) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <label className="grid min-w-0 gap-1 text-[11px]" style={{ color: theme.node.muted }} onMouseDown={stopEvent} onPointerDown={stopEvent}>
            <span className="truncate" title={label}>{label}</span>
            <span className="relative">
                <input
                    type="number"
                    min={minimum}
                    max={maximum}
                    step={1}
                    className="h-9 w-full cursor-text rounded-lg border bg-transparent px-2.5 pr-7 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.node.panel }}
                    value={value ?? ""}
                    disabled={disabled}
                    placeholder={`${minimum}–${maximum}`}
                    onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
                />
                {unit ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: theme.node.muted }}>{unit}</span> : null}
            </span>
        </label>
    );
}

function ImageCountField({
    label,
    value,
    minimum,
    maximum,
    disabled,
    onChange,
}: {
    label: string;
    value?: number;
    minimum?: number;
    maximum?: number;
    disabled: boolean;
    onChange: (value: number | undefined) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <label className="grid gap-1 rounded-xl border px-2 py-2" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }} onMouseDown={stopEvent} onPointerDown={stopEvent}>
            <span>{label}</span>
            <span className="relative">
                <input
                    aria-label={`${label}张数`}
                    type="number"
                    min={minimum}
                    max={maximum}
                    step={1}
                    className="h-6 w-full cursor-text rounded-md border bg-transparent px-1.5 pr-5 text-center text-xs font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    value={value ?? ""}
                    disabled={disabled}
                    placeholder={minimum !== undefined && maximum !== undefined ? `${minimum}–${maximum}` : "—"}
                    onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
                />
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]">张</span>
            </span>
        </label>
    );
}

function dimensionStateKey(key: CanvasBatchDimensionKey): "productLengthCm" | "productWidthCm" | "productHeightCm" {
    if (key === "length_cm") return "productLengthCm";
    if (key === "width_cm") return "productWidthCm";
    return "productHeightCm";
}

function dimensionValue(state: CanvasBatchIntakeMetadata, key: CanvasBatchDimensionKey) {
    return state[dimensionStateKey(key)];
}

function imageCountError(state: CanvasBatchIntakeMetadata, category: CanvasBatchCategoryMetadata) {
    for (const [label, value, bounds] of [
        ["主图张数", state.mainImageCount, category.form.image_counts.main],
        ["详情图张数", state.detailImageCount, category.form.image_counts.detail],
    ] as const) {
        if (!Number.isInteger(value) || value! < bounds.minimum || value! > bounds.maximum) return `${label}必须填写 ${bounds.minimum}–${bounds.maximum} 的整数。`;
    }
    if (Number.isInteger(state.handheldMainCount) && state.handheldMainCount! > state.mainImageCount!) return `主图手持不能超过本批 ${state.mainImageCount} 张；请先把主图手持改小。`;
    if (Number.isInteger(state.handheldDetailCount) && state.handheldDetailCount! > handheldCountMaximum("detail", state.detailImageCount!)) return detailHandheldLimitMessage(state.detailImageCount!);
    return undefined;
}

function validImageCount(value: number | undefined, bounds: { minimum: number; maximum: number }): value is number {
    return Number.isInteger(value) && value! >= bounds.minimum && value! <= bounds.maximum;
}

function advancedValue(state: CanvasBatchIntakeMetadata, field: CanvasBatchCategoryMetadata["form"]["advanced_options"][number]["field"]) {
    if (field === "forbid_pouring_and_heating") return Boolean(state.prohibitPouringAndHeating);
    return Boolean(state.skipMissingDAngle);
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

function styleReferenceText(
    status: ReturnType<typeof readStyleReferenceState>["status"],
    fileCount?: number,
    errorMessage?: string,
    removalStatus?: ReturnType<typeof readStyleReferenceRemovalState>["status"],
    removalErrorMessage?: string,
) {
    if (removalStatus === "queued") return "移除命令已提交，等待本机服务确认。";
    if (removalStatus === "completed") return "已移除，可重新补登";
    if (removalStatus === "failed") return removalErrorMessage || "本次移除已停止，不会自动重试。";
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
