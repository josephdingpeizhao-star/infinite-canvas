import { Form, Input, Select } from "antd";

import { buildWorkflowTextModelOptions, CODEX_REASONING_EFFORTS, describeWorkflowTextModelSelection, type CodexReasoningEffort } from "@/lib/canvas/canvas-workflow-text-model";
import { useConfigStore } from "@/stores/use-config-store";
import { DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION, useWorkflowTextModelStore } from "@/stores/use-workflow-text-model-store";

export function WorkflowTextModelConfig() {
    const config = useConfigStore((state) => state.config);
    const selection = useWorkflowTextModelStore((state) => state.selection);
    const syncState = useWorkflowTextModelStore((state) => state.syncState);
    const syncedLabel = useWorkflowTextModelStore((state) => state.syncedLabel);
    const syncHint = useWorkflowTextModelStore((state) => state.syncHint);
    const setSelection = useWorkflowTextModelStore((state) => state.setSelection);
    const selectionLabel = describeWorkflowTextModelSelection(config, selection);
    const statusText =
        syncState === "synced"
            ? `已同步到本机工作台：${syncedLabel || selectionLabel}`
            : syncState === "failed"
              ? "同步失败，请检查本机工作台后重试"
              : `未同步：${syncHint || "本机工作台未连接"}`;
    const statusClass = syncState === "synced" ? "text-emerald-600 dark:text-emerald-400" : syncState === "failed" ? "text-red-600 dark:text-red-400" : "text-stone-500 dark:text-stone-400";

    return (
        <section className="mt-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="text-sm font-semibold">识图与提示词生成模型</div>
            <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">用于批次工作流的图片识别与生图提示词生成；建批时记录，一批只用同一模型。</div>
            <div className={`mt-4 grid gap-4 ${selection.kind === "codex" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                <Form.Item label="使用模型" extra={`当前选择：${selectionLabel}`} className="mb-0">
                    <Select
                        showSearch
                        value={selection.kind === "codex" ? "codex" : selection.channelModel}
                        options={buildWorkflowTextModelOptions(config)}
                        onChange={(value: string) => setSelection(value === "codex" ? (selection.kind === "codex" ? selection : DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION) : { kind: "channel", channelModel: value })}
                    />
                </Form.Item>
                {selection.kind === "codex" ? (
                    <>
                        <Form.Item label="Codex 型号" className="mb-0">
                            <Input value={selection.model} maxLength={128} spellCheck={false} onChange={(event) => setSelection({ ...selection, model: event.target.value })} />
                        </Form.Item>
                        <Form.Item label="推理档位" className="mb-0">
                            <Select value={selection.effort} options={CODEX_REASONING_EFFORTS.map((effort) => ({ label: effort, value: effort }))} onChange={(effort: CodexReasoningEffort) => setSelection({ ...selection, effort })} />
                        </Form.Item>
                    </>
                ) : null}
            </div>
            <div className={`mt-3 text-xs leading-5 ${statusClass}`}>{statusText}</div>
        </section>
    );
}
