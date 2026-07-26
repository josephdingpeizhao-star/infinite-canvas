import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Input, Modal, Spin } from "antd";

import { confirmationTextForProjectDeletion, groupProjectDeletionResults, projectDeletionConfirmationMatches, projectDeletionPreviewStatusLabel, type ProjectDeletionPreviewReceipt } from "@/lib/canvas/canvas-project-delete";
import { useCanvasProjectDelete } from "@/hooks/use-canvas-project-delete";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog({ projectIds, deleteAll = false, onDeleted, onClosed }: { projectIds?: string[]; deleteAll?: boolean; onDeleted?: (projectIds: string[]) => void; onClosed?: () => void }) {
    const storedIds = useCanvasUiStore((state) => state.deleteProjectIds);
    const setStoredIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const ids = projectIds ?? storedIds;
    const controlled = projectIds !== undefined;
    const requestKey = ids.length ? `${deleteAll ? "all" : "some"}:${[...ids].sort().join("\u0000")}` : "";
    const startedKeyRef = useRef("");

    const finish = useCallback(
        (deletedIds: string[]) => {
            removeSelectedIds(deletedIds);
            if (!controlled) setStoredIds([]);
            onDeleted?.(deletedIds);
            onClosed?.();
        },
        [controlled, onClosed, onDeleted, removeSelectedIds, setStoredIds],
    );
    const { state, begin, confirmReview, confirmTyped, setConfirmationInput, backToReview, retry, reset } = useCanvasProjectDelete({ onDeleted: finish });

    useEffect(() => {
        if (!requestKey) {
            startedKeyRef.current = "";
            reset();
            return;
        }
        if (startedKeyRef.current === requestKey) return;
        startedKeyRef.current = requestKey;
        void begin(ids, deleteAll);
    }, [begin, deleteAll, ids, requestKey, reset]);

    const requiredText = state.preview && state.plan ? confirmationTextForProjectDeletion(state.plan.deleteAll, state.preview) : null;
    const groupedResults = useMemo(() => groupProjectDeletionResults(state.execution?.batches || []), [state.execution?.batches]);
    const busy = state.phase === "previewing" || state.phase === "executing";

    const close = () => {
        if (state.phase === "executing") return;
        startedKeyRef.current = "";
        reset();
        if (!controlled) setStoredIds([]);
        onClosed?.();
    };

    return (
        <Modal title={ids.length === 1 ? "删除当前项目？" : `删除 ${ids.length} 个项目？`} open={ids.length > 0} centered closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={close} footer={dialogFooter()}>
            <div className="grid gap-4 text-sm">
                {state.phase === "previewing" || state.phase === "idle" ? (
                    <div className="flex min-h-28 items-center justify-center gap-3 opacity-70">
                        <Spin size="small" />
                        正在核对关联批次…
                    </div>
                ) : null}

                {state.preview && state.phase !== "previewing" ? (
                    <>
                        <div>
                            <div className="mb-2 font-medium">将处理的关联批次</div>
                            {state.preview.batches.length ? (
                                <div className="grid gap-2">
                                    {state.preview.batches.map((batch) => (
                                        <div key={batch.batchId} className="flex items-center justify-between gap-4 rounded-lg border border-current/10 px-3 py-2">
                                            <span className="min-w-0 truncate" title={batch.batchId}>
                                                {batch.batchId}
                                            </span>
                                            <span className="shrink-0 font-medium">{projectDeletionPreviewStatusLabel(batch.status)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg border border-current/10 px-3 py-3 opacity-70">无关联批次</div>
                            )}
                        </div>
                        <CanvasProjectDeletionWarnings preview={state.preview} />
                    </>
                ) : null}

                {state.phase === "typed_confirmation" && requiredText ? (
                    <label className="grid gap-2">
                        <span>请输入“{requiredText}”继续：</span>
                        <Input value={state.confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} autoFocus />
                    </label>
                ) : null}

                {state.phase === "executing" ? (
                    <div className="flex min-h-24 items-center justify-center gap-3 opacity-70">
                        <Spin size="small" />
                        正在按批次顺序删除；完成前会保留项目…
                    </div>
                ) : null}

                {state.execution && state.phase === "stopped" ? (
                    <div className="grid gap-3">
                        <ResultGroup title="已删除" items={groupedResults.deleted} />
                        <ResultGroup title="删除失败" items={groupedResults.failed} />
                        <ResultGroup title="尚未开始" items={groupedResults.notStarted} />
                    </div>
                ) : null}

                {state.message ? (
                    <div className={`rounded-lg border px-3 py-3 leading-6 ${state.phase === "stopped" || state.phase === "failed" ? "border-red-400/40 bg-red-500/10 text-red-500" : "border-current/10"}`} role="status" aria-live="polite">
                        {state.message}
                    </div>
                ) : null}
            </div>
        </Modal>
    );

    function dialogFooter() {
        if (state.phase === "executing") return <Button disabled>正在删除…</Button>;
        if (state.phase === "typed_confirmation") {
            return (
                <>
                    <Button onClick={backToReview}>返回</Button>
                    <Button danger type="primary" disabled={!projectDeletionConfirmationMatches(state.confirmationInput, requiredText)} onClick={confirmTyped}>
                        确认删除
                    </Button>
                </>
            );
        }
        if (state.phase === "review") {
            return (
                <>
                    <Button onClick={close}>取消</Button>
                    <Button danger type="primary" onClick={confirmReview}>
                        {requiredText ? "下一步" : "删除项目"}
                    </Button>
                </>
            );
        }
        if (state.phase === "stopped" || state.phase === "failed") {
            return (
                <>
                    <Button onClick={close}>关闭</Button>
                    <Button danger onClick={retry}>
                        重新预检
                    </Button>
                </>
            );
        }
        return <Button onClick={close}>取消</Button>;
    }
}

export function CanvasProjectDeletionWarnings({ preview }: { preview: ProjectDeletionPreviewReceipt }) {
    const requiresHeavyWarning = preview.batches.some((batch) => batch.closed || batch.delivered);
    return (
        <>
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-3 leading-6 text-red-500">后端文件与图片将一并删除，仅 Windows 回收站可手工找回。其他项目不会被删除。</div>
            {requiresHeavyWarning ? <div className="rounded-lg border border-red-500/70 bg-red-500/15 px-3 py-3 font-medium leading-6 text-red-500">清单中包含已关账或已交付批次。删除后，交付产物与账本也会一并进入 Windows 回收站。</div> : null}
        </>
    );
}

function ResultGroup({ title, items }: { title: string; items: Array<{ batchId: string; message: string }> }) {
    if (!items.length) return null;
    return (
        <div className="grid gap-1 rounded-lg border border-current/10 px-3 py-2">
            <div className="font-medium">{title}</div>
            {items.map((item) => (
                <div key={item.batchId} className="grid gap-0.5 py-1 text-xs">
                    <span>{item.batchId}</span>
                    <span className="opacity-70">{item.message}</span>
                </div>
            ))}
        </div>
    );
}
