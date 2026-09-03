import {
    buildApiUrl,
    decodeChannelModel,
    encodeChannelModel,
    filterModelsByCapability,
    modelOptionLabel,
    modelOptionName,
    resolveModelChannel,
    type AiConfig,
} from "@/stores/use-config-store";
import type { WorkflowTextModelSelection } from "@/stores/use-workflow-text-model-store";

export const WORKFLOW_TEXT_MODEL_ENDPOINT = "http://127.0.0.1:17373/text-model";
export const CODEX_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export type WorkflowTextModelPayload =
    | { provider: "codex"; model: string; effort: CodexReasoningEffort }
    | { provider: "openai_compatible"; model: string; base_url: string; api_key: string; channel_name: string };

export type WorkflowTextModelOptionGroup = {
    label: string;
    options: Array<{ label: string; value: string }>;
};

export function buildWorkflowTextModelOptions(config: AiConfig): WorkflowTextModelOptionGroup[] {
    const channelOptions = config.channels.flatMap((channel) => {
        if (channel.apiFormat !== "openai") return [];
        const values = channel.models.map((model) => encodeChannelModel(channel.id, model));
        return filterModelsByCapability(values, "text").map((value) => ({
            label: modelOptionLabel(config, value),
            value,
        }));
    });
    return [
        { label: "Codex 登录账号", options: [{ label: "Codex", value: "codex" }] },
        { label: "渠道模型", options: channelOptions },
    ];
}

export function resolveWorkflowTextModelPayload(config: AiConfig, selection: WorkflowTextModelSelection): { payload: WorkflowTextModelPayload | null; hint: string } {
    if (selection.kind === "codex") {
        return { payload: { provider: "codex", model: selection.model, effort: selection.effort }, hint: "" };
    }
    const decoded = decodeChannelModel(selection.channelModel);
    const channel = resolveModelChannel(config, selection.channelModel);
    if (!decoded || channel.id !== decoded.channelId || !channel.models.includes(decoded.model)) {
        return { payload: null, hint: "该渠道或模型已不可用" };
    }
    if (channel.apiFormat !== "openai" || !channel.baseUrl.trim() || !channel.apiKey.trim()) {
        return { payload: null, hint: "该渠道缺少 Base URL 或 API Key" };
    }
    return {
        payload: {
            provider: "openai_compatible",
            model: modelOptionName(selection.channelModel),
            base_url: buildApiUrl(channel.baseUrl, ""),
            api_key: channel.apiKey,
            channel_name: channel.name,
        },
        hint: "",
    };
}

export async function syncWorkflowTextModel(payload: WorkflowTextModelPayload, token: string, fetcher: typeof fetch = globalThis.fetch): Promise<string> {
    const response = await fetcher(WORKFLOW_TEXT_MODEL_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-canvas-agent-token": token.trim(),
        },
        body: JSON.stringify(payload),
    });
    let result: Record<string, unknown> = {};
    try {
        const decoded: unknown = await response.json();
        if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) result = decoded as Record<string, unknown>;
    } catch {
        result = {};
    }
    const textModel = result.textModel as Record<string, unknown> | undefined;
    if (!response.ok || result.ok !== true || typeof textModel?.label !== "string" || !textModel.label.trim()) {
        throw new Error("识图模型同步失败");
    }
    return textModel.label;
}

export function describeWorkflowTextModelSelection(config: AiConfig, selection: WorkflowTextModelSelection) {
    return selection.kind === "codex" ? `Codex ${selection.model}（${selection.effort}）` : modelOptionLabel(config, selection.channelModel);
}
