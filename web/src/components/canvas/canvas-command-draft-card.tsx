import { useEffect, useMemo, useState } from "react";
import { Button } from "antd";
import { CircleDollarSign, Command, Send, ShieldCheck, Workflow } from "lucide-react";

import {
    commandAssistantTargetMode,
    type CommandAssistantDraft,
} from "@/lib/canvas/canvas-command-assistant";
import type { WorkflowCommandTarget } from "@/stores/canvas/use-canvas-workflow-command-store";


export function CanvasCommandDraftCard({
    draft,
    targets,
    onSend,
}: {
    draft: CommandAssistantDraft;
    targets: WorkflowCommandTarget[];
    onSend: (
        nodeId: string,
        command: CommandAssistantDraft["command"],
    ) => boolean;
}) {
    const targetMode = useMemo(() => commandAssistantTargetMode(targets), [targets]);
    const [selectedId, setSelectedId] = useState(targetMode.selectedId);
    const [sent, setSent] = useState(false);
    const selected = targets.find((target) => target.nodeId === selectedId);

    useEffect(() => {
        setSelectedId(targetMode.selectedId);
        setSent(false);
    }, [targetMode.mode, targetMode.selectedId, targets]);

    const send = () => {
        if (!selectedId || sent) return;
        setSent(onSend(selectedId, draft.command));
    };

    return (
        <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-amber-500/25 text-amber-600">
                <Command className="size-4" />
            </span>
            <div className="min-w-0 flex-1 rounded-xl border border-amber-500/25 bg-amber-500/[0.025] p-4 text-left">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">命令草稿</span>
                    <span className="rounded-full border border-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                        尚未执行
                    </span>
                </div>

                <div className="mt-3 rounded-lg border border-black/10 px-3 py-2 dark:border-white/10">
                    <div className="text-[11px] opacity-55">命令原文</div>
                    <code className="mt-1 block break-all text-sm font-semibold text-amber-700 dark:text-amber-400">
                        {draft.command}
                    </code>
                </div>

                <div className="mt-3 text-sm leading-6">
                    <div className="font-medium">{draft.title}</div>
                    <div className="opacity-70">{draft.description}</div>
                </div>

                <div className="mt-3 flex items-start gap-2 text-xs leading-5 opacity-75">
                    <CircleDollarSign className="mt-0.5 size-3.5 shrink-0" />
                    <span>{costCopy(selected, targetMode.mode)}</span>
                </div>
                <div className="mt-2 flex items-start gap-2 text-xs leading-5 opacity-75">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                    <span>这只是草稿，最终由机器当前状态和既有门禁决定是否放行。</span>
                </div>

                <div className="mt-4">
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium opacity-70">
                        <Workflow className="size-3.5" />
                        目标机器
                    </label>
                    {targetMode.mode === "empty" ? (
                        <div className="rounded-lg border border-dashed border-amber-500/30 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
                            画布上还没有工作流机器，请先从底部工具栏添加“工作流”。
                        </div>
                    ) : targetMode.mode === "multiple" ? (
                        <select
                            aria-label="选择目标机器"
                            value={selectedId}
                            className="h-9 w-full rounded-lg border border-black/15 bg-transparent px-2 text-sm outline-none dark:border-white/15"
                            onChange={(event) => {
                                setSelectedId(event.target.value);
                                setSent(false);
                            }}
                        >
                            <option value="">请选择目标机器</option>
                            {targets.map((target) => (
                                <option key={target.nodeId} value={target.nodeId}>
                                    {targetLabel(target)}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <div className="rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                            {targetLabel(targets[0])}
                        </div>
                    )}
                </div>

                {selected?.mode === "error" && selected.message ? (
                    <div className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">
                        {selected.message} 发出后仍由机器现有入口提示，不会绕过检查。
                    </div>
                ) : null}

                <Button
                    type="primary"
                    className="mt-4 w-full"
                    icon={<Send className="size-4" />}
                    disabled={!selectedId || sent}
                    onClick={send}
                >
                    {sent ? "已交给机器，请确认费用卡" : "发出命令"}
                </Button>
            </div>
        </div>
    );
}

function targetLabel(target: WorkflowCommandTarget) {
    if (target.mode === "production") {
        return `${target.title} · 真实批次 ${target.batchId || "待核对"}`;
    }
    if (target.mode === "demo") return `${target.title} · 0 元演示`;
    return `${target.title} · 连线需要核对`;
}

function costCopy(
    target: WorkflowCommandTarget | undefined,
    mode: "empty" | "single" | "multiple",
) {
    if (mode === "empty") return "没有目标机器，不会执行或产生费用。";
    if (!target) return "选择机器后才可发出；当前没有执行或费用。";
    if (target.mode === "demo") {
        return "0 元演示；发出后仍会显示现有 0 元确认卡。";
    }
    if (target.mode === "production") {
        return "发出后先显示机器现有费用卡；只有再次确认才可能执行或收费。";
    }
    return "机器连线需要核对；发出后会由现有入口停止并提示。";
}
