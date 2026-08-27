import { isSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import type { AgentChatItem } from "@/stores/use-agent-store";

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new Error(data.error || data.msg || "本地 Agent 请求失败");
    return data;
}

export function normalizeAgentHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .map((item, index) => ({
            ...item,
            id: item.id || `history-${index}`,
            text: normalizeAgentText(item.text),
        }))
        .filter((item) => item.text);
}

export function normalizeAgentText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

export function mergeAgentText(prev: string, next: string) {
    if (!next || prev === next || prev.endsWith(next)) return prev;
    if (next.startsWith(prev)) return next;
    return `${prev}${next}`;
}

export function agentStreamId(turnId: string, itemId: string) {
    if (!turnId) return itemId;
    const prefix = `${turnId}:`;
    return itemId.startsWith(prefix) ? itemId : `${prefix}${itemId}`;
}

export function upsertAgentMessage(messages: AgentChatItem[], item: Omit<AgentChatItem, "id">, id: string) {
    const text = normalizeAgentText(item.text);
    if (!text && !item.attachments?.length) return messages;
    const next = { ...item, id, text };
    if (next.streamId) {
        const index = messages.findIndex((current) => current.streamId === next.streamId);
        if (index >= 0) {
            return messages.map((current, currentIndex) => currentIndex === index ? { ...current, ...next, id: current.id, text: next.text } : current);
        }
        return [...messages.slice(-120), next];
    }
    const last = messages.at(-1);
    if (last?.role === "assistant" && next.role === "assistant" && last.title === next.title) {
        const merged = mergeAgentText(last.text, next.text);
        if (merged === last.text) return messages;
        return [...messages.slice(0, -1), { ...last, text: merged, meta: next.meta || last.meta }];
    }
    return [...messages.slice(-120), next];
}

export function canvasAgentToolName(name: string) {
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_node") return "创建节点";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_text_nodes") return "批量创建文本";
    if (name === "canvas_create_config_node") return "创建生成配置";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_update_node") return "更新节点";
    if (name === "canvas_update_node_text") return "更新文本";
    if (name === "canvas_move_nodes") return "移动节点";
    if (name === "canvas_resize_node") return "调整节点尺寸";
    if (name === "canvas_delete_nodes") return "删除节点";
    if (name === "canvas_connect_nodes") return "连接节点";
    if (name === "canvas_select_nodes") return "选择节点";
    if (name === "canvas_set_viewport") return "调整视口";
    if (name === "canvas_run_generation") return "触发生成";
    if (name === "site_navigate") return "网站跳转";
    if (isSiteTool(name)) return SITE_TOOL_LABELS[name];
    return name;
}
