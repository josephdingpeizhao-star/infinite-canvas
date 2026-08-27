import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App } from "antd";

import { isSiteTool, runSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import { isAgentSseDead, nextRetryDelayMs, shouldKeepRetrying } from "@/lib/canvas/agent-connection";
import { agentStreamId, canvasAgentToolName, fetchAgentJson, normalizeAgentHistoryMessages, normalizeAgentText, upsertAgentMessage } from "@/lib/canvas/canvas-agent-client";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { useAgentStore, type AgentChatItem, type AgentPendingToolCall, type AgentThreadSummary } from "@/stores/use-agent-store";

const DEFAULT_AGENT_URL = "http://127.0.0.1:17371";

type AgentEventPayload = {
    agent?: string;
    type?: string;
    thread_id?: string;
    turnId?: string;
    turn_id?: string;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    usage?: Record<string, unknown>;
};
type AgentEventItem = { id?: string; type?: string; text?: unknown; message?: unknown; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: { message?: string } };
type AgentWorkspace = { workspacePath: string; activeThreadId?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; thread?: AgentThreadSummary; messages?: AgentChatItem[] };
type AgentConfigResponse = { ok?: boolean; url?: string; token?: string; hasToken?: boolean };

export function CanvasAgentConnectionHost() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [connectionRun, setConnectionRun] = useState(0);
    const { url, token, connected, enabled, confirmTools, canvasContext, setAgentState, setConnectionCommands, connectAgent, addEventLog: pushEventLog } = useAgentStore();
    const canvasContextRef = useRef(canvasContext);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const autoConnectRef = useRef(false);
    const wasEnabledRef = useRef(enabled);
    const connectedRef = useRef(false);
    const everConnectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const clientIdRef = useRef(typeof crypto === "undefined" ? `${Date.now()}` : crypto.randomUUID());
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const urlAgentAutoConnect = searchParams.has("agentUrl") && searchParams.has("agentToken");
    const urlAgentEndpoint = searchParams.get("agentUrl") || "";
    const urlAgentToken = searchParams.get("agentToken") || "";

    const addMessage = useCallback((item: Omit<AgentChatItem, "id">) => {
        const currentMessages = useAgentStore.getState().messages;
        const messages = upsertAgentMessage(currentMessages, item, `${Date.now()}-${Math.random()}`);
        if (messages !== currentMessages) setAgentState({ messages });
    }, [setAgentState]);

    const addEventLog = useCallback((title: string, text: unknown, raw?: unknown) => {
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), title, text: normalizeAgentText(text) || title, raw });
    }, [pushEventLog]);

    const clearAgentSession = useCallback((patch: Parameters<typeof setAgentState>[0] = {}) => {
        setAgentState({
            messages: [],
            threads: [],
            activeThreadId: "",
            workspacePath: "",
            loadingThreads: false,
            waiting: false,
            sending: false,
            pendingTool: null,
            ...patch,
        });
        pendingToolRef.current = null;
    }, [setAgentState]);

    const loadThreads = useCallback(async () => {
        if (!connectedRef.current && !useAgentStore.getState().connected) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, "/agent/codex/threads");
            const nextThreadId = data.workspace?.activeThreadId || "";
            setAgentState({
                threads: data.data || [],
                workspacePath: data.workspace?.workspacePath || "",
                activeThreadId: nextThreadId,
                messages: [],
            });
            if (nextThreadId) {
                const thread = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(nextThreadId)}`);
                setAgentState({ messages: normalizeAgentHistoryMessages(thread.messages || []) });
            }
        } catch (error) {
            addEventLog("读取历史失败", error);
        } finally {
            setAgentState({ loadingThreads: false });
        }
    }, [addEventLog, endpoint, setAgentState, token]);

    const runToolCall = useCallback(async (currentEndpoint: string, currentToken: string, payload: AgentPendingToolCall) => {
        if (isSiteTool(payload.name)) {
            try {
                setAgentState({ activity: SITE_TOOL_LABELS[payload.name], waiting: true });
                addEventLog(canvasAgentToolName(payload.name), payload, payload);
                const result = await runSiteTool(payload.name, payload.input || {}, navigate);
                await postToolResult(currentEndpoint, currentToken, clientIdRef.current, { requestId: payload.requestId, result });
                setAgentState({ activity: "工具完成", waiting: true });
                addEventLog(`${canvasAgentToolName(payload.name)}完成`, result, result);
                addMessage({ role: "tool", title: `${canvasAgentToolName(payload.name)}完成`, text: siteToolSummary(payload.name, result), detail: { requestId: payload.requestId, name: payload.name, input: payload.input, result } });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "工具执行失败";
                setAgentState({ activity: "工具失败", waiting: false });
                addMessage({ role: "tool", title: "工具失败", text: errorMessage, detail: payload });
                await postToolResult(currentEndpoint, currentToken, clientIdRef.current, { requestId: payload.requestId, error: errorMessage });
            }
            return;
        }
        try {
            const input: { ops?: CanvasAgentOp[]; path?: string } = payload.input || {};
            setAgentState({ activity: payload.name === "canvas_apply_ops" ? "执行画布操作" : payload.name === "site_navigate" ? "跳转页面" : "读取画布", waiting: true });
            addEventLog(canvasAgentToolName(payload.name), payload, payload);
            let result: unknown;
            if (payload.name === "site_navigate") {
                const path = input.path || "/";
                navigate(path);
                result = { ok: true, path };
            } else if (payload.name === "canvas_apply_ops") {
                const context = canvasContextRef.current;
                if (!context) throw new Error("当前不在画布页，请先用 site_navigate 打开画布");
                result = context.applyOps(input.ops || []);
                void postState(currentEndpoint, currentToken, clientIdRef.current, result as CanvasAgentSnapshot);
            } else {
                const snapshot = canvasContextRef.current?.snapshot;
                if (!snapshot) throw new Error("当前不在画布页，请先用 site_navigate 打开画布");
                result = snapshot;
            }
            await postToolResult(currentEndpoint, currentToken, clientIdRef.current, { requestId: payload.requestId, result });
            setAgentState({ activity: "工具完成", waiting: true });
            addEventLog(`${canvasAgentToolName(payload.name)}完成`, result, result);
            addMessage({ role: "tool", title: `${canvasAgentToolName(payload.name)}完成`, text: payload.name === "canvas_apply_ops" ? summarizeCanvasAgentOps(input.ops || []) || "画布操作" : payload.name === "site_navigate" ? `已跳转到 ${input.path || "/"}` : "已完成", detail: { requestId: payload.requestId, name: payload.name, input, result } });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "画布操作失败";
            setAgentState({ activity: "工具失败", waiting: false });
            addMessage({ role: "tool", title: "工具失败", text: errorMessage, detail: payload });
            await postToolResult(currentEndpoint, currentToken, clientIdRef.current, { requestId: payload.requestId, error: errorMessage });
        }
    }, [addEventLog, addMessage, navigate, setAgentState]);

    const handleToolCall = useCallback(async (currentEndpoint: string, currentToken: string, payload: AgentPendingToolCall) => {
        if (confirmToolsRef.current && payload.name === "canvas_apply_ops") {
            if (pendingToolRef.current) {
                await postToolResult(currentEndpoint, currentToken, clientIdRef.current, { requestId: payload.requestId, error: "仍有待确认的画布工具调用" });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload, activity: "等待确认", waiting: false });
            addEventLog("等待确认", payload, payload);
            return;
        }
        await runToolCall(currentEndpoint, currentToken, payload);
    }, [addEventLog, runToolCall, setAgentState]);

    const handleAgentEvent = useCallback((event: AgentEventPayload) => {
        if (shouldLogAgentEvent(event)) addEventLog(eventTitle(event), event, event);
        if (event.type === "thread.started" && event.thread_id) setAgentState({ activeThreadId: event.thread_id });
        const nextActivity = activityText(event);
        if (nextActivity) setAgentState({ activity: nextActivity });
        if (event.type === "turn.started") setAgentState({ waiting: true });
        if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") setAgentState({ waiting: false, sending: false });
        const item = formatAgentEvent(event);
        if (item) {
            if (item.role === "error") setAgentState({ waiting: false, sending: false });
            addMessage(item);
        }
    }, [addEventLog, addMessage, setAgentState]);

    const rejectPendingTool = useCallback(async () => {
        const pendingTool = useAgentStore.getState().pendingTool;
        if (!pendingTool) return;
        await postToolResult(endpoint, token, clientIdRef.current, { requestId: pendingTool.requestId, error: "用户取消了画布工具调用" });
        setAgentState({ activity: "已取消", waiting: false });
        addMessage({ role: "tool", title: "拒绝执行", text: canvasAgentToolName(pendingTool.name), detail: { requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input } });
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
    }, [addMessage, endpoint, setAgentState, token]);

    const approvePendingTool = useCallback(async () => {
        const pendingTool = useAgentStore.getState().pendingTool;
        if (!pendingTool) return;
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
        await runToolCall(endpoint, token, pendingTool);
    }, [endpoint, runToolCall, setAgentState, token]);

    const undoLastTool = useCallback(() => {
        const restored = canvasContextRef.current?.undoOps() || null;
        if (!restored) return;
        setAgentState({ activity: "已撤销" });
        addMessage({ role: "tool", title: "已撤销", text: "上一次工具操作", detail: restored });
        if (useAgentStore.getState().connected) void postState(endpoint, token, clientIdRef.current, restored);
    }, [addMessage, endpoint, setAgentState, token]);

    const toggleAgentConnection = useCallback(async () => {
        const current = useAgentStore.getState();
        if (current.enabled) {
            if (!current.connected && current.connectError) {
                errorLoggedRef.current = false;
                setAgentState({ connected: false, activity: "连接中", connectError: "" });
                setConnectionRun((run) => run + 1);
                return;
            }
            autoConnectRef.current = true;
            clearAgentSession({ enabled: false, connected: false, activity: "离线", connectError: "" });
            return;
        }
        const discovered = urlAgentToken ? null : await discoverAgentConfig(current.url.trim().replace(/\/$/, "") || DEFAULT_AGENT_URL);
        const nextEndpoint = (urlAgentEndpoint || discovered?.url || current.url || DEFAULT_AGENT_URL).trim().replace(/\/$/, "");
        const nextToken = (urlAgentToken || current.token.trim() || discovered?.token || "").trim();
        if (!nextEndpoint) {
            const text = "请填写本地 Agent 地址";
            setAgentState({ connectError: text });
            message.warning(text);
            return;
        }
        if (!nextToken) {
            const text = "没有发现本地 Agent，请先在 Codex 使用插件或手动启动 Canvas Agent";
            setAgentState({ connectError: text });
            message.warning(text);
            return;
        }
        try {
            const parsed = new URL(nextEndpoint);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        } catch {
            const text = "本地 Agent 地址格式不正确";
            setAgentState({ connectError: text });
            message.warning(text);
            return;
        }
        errorLoggedRef.current = false;
        localStorage.setItem("canvas-agent-url", nextEndpoint);
        localStorage.setItem("canvas-agent-token", nextToken);
        setAgentState({ url: nextEndpoint, token: nextToken, enabled: true, connected: false, activity: "连接中", connectError: "", activeTab: "setup" });
    }, [clearAgentSession, message, setAgentState, urlAgentEndpoint, urlAgentToken]);

    useEffect(() => {
        canvasContextRef.current = canvasContext;
    }, [canvasContext]);

    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);

    useEffect(() => {
        pendingToolRef.current = useAgentStore.getState().pendingTool;
        return useAgentStore.subscribe((state, previous) => {
            if (state.pendingTool !== previous.pendingTool) pendingToolRef.current = state.pendingTool;
        });
    }, []);

    useEffect(() => {
        if (!enabled || !token.trim()) return;
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const clientId = clientIdRef.current;
        let source: EventSource | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let deadCheckTimer: ReturnType<typeof setInterval> | null = null;
        let lastEventAt = Date.now();
        let retryAttempt = 0;
        let disposed = false;

        const clearRetryTimer = () => {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
        };
        const clearDeadCheckTimer = () => {
            if (deadCheckTimer) clearInterval(deadCheckTimer);
            deadCheckTimer = null;
        };
        const connect = () => {
            if (disposed || !useAgentStore.getState().enabled) return;
            clearRetryTimer();
            clearDeadCheckTimer();
            source?.close();
            setAgentState({ connected: false, activity: "连接中", connectError: "" });
            const nextSource = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
            source = nextSource;
            lastEventAt = Date.now();
            const isCurrentSource = () => !disposed && source === nextSource;
            const canHandleEvents = () => isCurrentSource() && useAgentStore.getState().enabled;
            const recordEvent = () => {
                lastEventAt = Date.now();
            };
            nextSource.addEventListener("hello", () => {
                if (!canHandleEvents()) return;
                recordEvent();
                clearRetryTimer();
                retryAttempt = 0;
                everConnectedRef.current = true;
                errorLoggedRef.current = false;
                connectedRef.current = true;
                setAgentState({ connected: true, activity: "已连接", connectError: "", messages: useAgentStore.getState().messages.filter((item) => !isConnectionErrorMessage(item)) });
                message.success("本地 Agent 已连接");
                void postState(endpoint, token, clientId, canvasContextRef.current?.snapshot || null);
            });
            nextSource.addEventListener("tool_call", (event) => {
                if (!canHandleEvents()) return;
                recordEvent();
                const data = parseEventData<AgentPendingToolCall>(event);
                if (data) void handleToolCall(endpoint, token, data);
            });
            nextSource.addEventListener("agent_event", (event) => {
                if (!canHandleEvents()) return;
                recordEvent();
                const data = parseEventData<AgentEventPayload>(event);
                if (data) handleAgentEvent(data);
            });
            nextSource.addEventListener("agent_log", (event) => {
                if (!canHandleEvents()) return;
                recordEvent();
                const text = parseEventData<{ text?: unknown }>(event)?.text;
                addEventLog("日志", text, text);
            });
            nextSource.addEventListener("agent_error", (event) => {
                if (!canHandleEvents()) return;
                recordEvent();
                const error = parseEventData<{ message?: unknown }>(event)?.message;
                setAgentState({ activity: "出错", waiting: false });
                addMessage({ role: "error", title: "错误", text: normalizeAgentText(error) });
                addEventLog("错误", error, error);
            });
            nextSource.addEventListener("agent_done", () => {
                if (!canHandleEvents()) return;
                recordEvent();
                setAgentState({ activity: "完成", waiting: false, sending: false });
                void loadThreads();
            });
            nextSource.addEventListener("ping", () => {
                if (!canHandleEvents()) { return; }
                recordEvent();
            });
            const reconnectAfterLoss = () => {
                if (!isCurrentSource()) return;
                if (!useAgentStore.getState().enabled) {
                    clearDeadCheckTimer();
                    nextSource.close();
                    source = null;
                    return;
                }
                clearDeadCheckTimer();
                const everConnected = everConnectedRef.current;
                const wasConnected = connectedRef.current;
                const text = everConnected ? "本地 Agent 连接失败或已断开" : "连接失败，请检查地址和 token";
                if (!errorLoggedRef.current || wasConnected) {
                    addEventLog(everConnected ? "连接断开" : "连接失败", { endpoint, error: text });
                    message.error(text);
                }
                errorLoggedRef.current = true;
                connectedRef.current = false;
                nextSource.close();
                source = null;
                const keepRetrying = shouldKeepRetrying({ everConnected, attempt: retryAttempt });
                clearAgentSession({ activity: keepRetrying ? "连接中" : everConnected ? "连接断开" : "连接失败", connected: false, connectError: keepRetrying ? "" : text });
                if (!keepRetrying) return;
                const delay = nextRetryDelayMs(retryAttempt);
                retryAttempt += 1;
                retryTimer = setTimeout(connect, delay);
            };
            nextSource.onerror = reconnectAfterLoss;
            deadCheckTimer = setInterval(() => {
                if (!isCurrentSource() || !isAgentSseDead(lastEventAt, Date.now())) return;
                reconnectAfterLoss();
            }, 1_000);
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible" || connectedRef.current || !useAgentStore.getState().enabled) return;
            clearRetryTimer();
            connect();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        connect();
        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearRetryTimer();
            clearDeadCheckTimer();
            source?.close();
            source = null;
            connectedRef.current = false;
        };
    }, [addEventLog, addMessage, clearAgentSession, connectionRun, enabled, endpoint, handleAgentEvent, handleToolCall, loadThreads, message, setAgentState, token]);

    useEffect(() => {
        if (connected) void loadThreads();
    }, [connected, loadThreads]);

    useEffect(() => {
        if (!connected) return;
        const timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, canvasContext?.snapshot || null), 300);
        return () => clearTimeout(timer);
    }, [canvasContext?.snapshot, connected, endpoint, token]);

    useEffect(() => {
        const commands = { toggleConnection: toggleAgentConnection, loadThreads, approvePendingTool, rejectPendingTool, undoLastTool };
        setConnectionCommands(commands);
        return () => {
            if (useAgentStore.getState().connectionCommands === commands) setConnectionCommands(null);
        };
    }, [approvePendingTool, loadThreads, rejectPendingTool, setConnectionCommands, toggleAgentConnection, undoLastTool]);

    useEffect(() => {
        if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });
    }, [confirmTools, setAgentState, urlAgentAutoConnect]);

    useEffect(() => {
        if (wasEnabledRef.current && !enabled) autoConnectRef.current = true;
        wasEnabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        if (autoConnectRef.current || enabled || connected) return;
        if (urlAgentAutoConnect) {
            autoConnectRef.current = true;
            void toggleAgentConnection();
            return;
        }
        if (!token.trim()) return;
        autoConnectRef.current = true;
        connectAgent();
    }, [connectAgent, connected, enabled, token, toggleAgentConnection, urlAgentAutoConnect]);

    return null;
}

async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }) });
    } catch {}
}

async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetch(`${endpoint}/canvas/result?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "error") return { role: "error", title: "错误", text: normalizeAgentText(item.message), detail: item };
    if ((event.type === "item.updated" || event.type === "item.completed") && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text), meta: usageText(event), streamId: agentStreamId(event.turnId || event.turn_id || "", item.id || "") };
    if (event.type === "item.completed" && isMcpToolItem(item) && isReadTool(String(item?.tool || ""))) return { role: "tool", title: `${canvasAgentToolName(String(item?.tool || ""))}完成`, text: item?.error?.message || toolSummary(item), detail: toolDetail(item) };
    const text = eventText(event);
    if (text) return { role: "assistant", title: "Codex", text, meta: usageText(event) };
    return null;
}

function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

function eventText(event: AgentEventPayload) {
    return event.type === "item.completed" && event.item?.type === "agent_message" ? stringText(event.item.text) : "";
}

function usageText(event: AgentEventPayload) {
    const usage = event.usage;
    if (!usage || typeof usage !== "object") return undefined;
    const total = numberField(usage, "total_tokens");
    const input = numberField(usage, "input_tokens");
    const output = numberField(usage, "output_tokens");
    if (total) return `${total} tok`;
    if (input || output) return `${input || 0}/${output || 0} tok`;
    return undefined;
}

function activityText(event: AgentEventPayload) {
    const name = event.type || "";
    if (name === "thread.started") return "已创建会话";
    if (name === "turn.started") return "思考中";
    if (name === "turn.completed") return "完成";
    if (name === "turn.failed" || name === "error") return "出错";
    if (name === "item.started") return isMcpToolItem(event.item) ? `调用${canvasAgentToolName(String(event.item?.tool || ""))}` : "执行步骤";
    if (name === "item.completed") return isMcpToolItem(event.item) ? "工具完成" : "更新消息";
    return "";
}

function eventTitle(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return "已创建 Codex 会话";
    if (event.type === "turn.started") return "开始处理";
    if (event.type === "turn.completed") return "本轮完成";
    if (event.type === "stream.summary") return "流式摘要";
    if (event.type === "turn.failed" || event.type === "error") return "本轮失败";
    if (event.type === "item.started" && isMcpToolItem(item)) return `调用工具：${canvasAgentToolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && isMcpToolItem(item)) return `工具完成：${canvasAgentToolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && item?.type === "agent_message") return "Codex 回复";
    return event.type || "Codex 事件";
}

function shouldLogAgentEvent(event: AgentEventPayload) {
    const itemType = event.item?.type || "";
    return !["item.updated"].includes(event.type || "") && !["reasoning"].includes(itemType) && !(event.type === "item.started" && itemType === "agent_message");
}

function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

function siteToolSummary(name: string, result: unknown) {
    const data = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (name === "canvas_list_projects") return `共 ${numberField(data, "total")} 个画布`;
    if (name === "prompts_search") return `找到 ${numberField(data, "total")} 条提示词`;
    if (name === "assets_list") return `共 ${numberField(data, "total")} 个素材`;
    if (name === "assets_add") return "已加入我的素材";
    if (name === "workbench_image_generate" || name === "workbench_video_generate") return typeof data.note === "string" ? data.note : "已在工作台执行";
    if (name === "workbench_image_get_config" || name === "workbench_video_get_config") return "已读取工作台配置";
    return "已完成";
}

function isReadTool(name: string) {
    return name === "canvas_get_state" || name === "canvas_get_selection" || name === "canvas_export_snapshot";
}

function isMcpToolItem(item?: AgentEventItem) {
    return item?.type === "mcp_tool_call";
}

function toolDetail(item?: AgentEventItem) {
    return { server: item?.server, tool: item?.tool, status: item?.status, arguments: item?.arguments, result: parseToolResult(item?.result), error: item?.error };
}

function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (Array.isArray(nodeField) || Array.isArray(connectionField)) return `读取到 ${nodes.length} 个节点，${connections.length} 条连线`;
    return "工具调用完成";
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content) ? content.map((item) => objectField(item, "text")).filter((item): item is string => typeof item === "string").join("\n") : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}
