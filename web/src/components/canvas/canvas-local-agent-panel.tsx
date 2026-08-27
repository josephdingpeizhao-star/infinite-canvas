import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, FolderOpen, History, KeyRound, Link2, LoaderCircle, LogIn, PlugZap, Plus, RefreshCw, RotateCcw, Square, Terminal, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CODEX_AUTH_POLL_INTERVAL_MS, codexAuthStatusText, normalizeCodexAuthResponse, shouldContinuePolling, type CodexAuthPhase, type CodexAuthState } from "@/lib/agent/agent-codex-auth";
import { windowMessages } from "@/lib/agent/agent-chat-view";
import { canvasAgentToolName, fetchAgentJson, normalizeAgentHistoryMessages, normalizeAgentText, upsertAgentMessage } from "@/lib/canvas/canvas-agent-client";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentPanelTab, type AgentThreadSummary } from "@/stores/use-agent-store";
import { summarizeCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatAttachment, type CanvasAgentChatMessage } from "./canvas-agent-chat-ui";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const AGENT_CONNECT_STEPS = [
    { title: "方式一：在 Codex 中使用插件", text: "在 Codex app 安装 Infinite Canvas 插件后，通过插件启动画布，插件会自动启动本地 Agent 并带上连接信息。" },
    { title: "方式二：直接运行 Agent", text: "不使用 Codex 插件时，在终端运行下面命令，再回到网页里连接或手动填入 Local URL 和 Connect token。", command: "npx -y @basketikun/canvas-agent" },
];
const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove infinite-canvas";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove infinite-canvas";

type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };
type AgentWorkspace = { workspacePath: string; activeThreadId?: string };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; thread?: AgentThreadSummary; messages?: AgentChatItem[] };

export function CanvasLocalAgentPanel({ embedded }: { embedded?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const [showAllMessages, setShowAllMessages] = useState(false);
    const { width, url, token, connected, enabled, prompt, attachments, sending, waiting, messages, eventLogs, threads, activeThreadId, workspacePath, loadingThreads, activeTab, activity, connectError, pendingTool, canvasContext, setAgentState, addEventLog: pushEventLog, clearEventLogs, toggleAgentConnection, loadAgentThreads, approvePendingTool, rejectPendingTool, undoLastAgentTool } = useAgentStore();
    const listRef = useRef<HTMLDivElement>(null);
    const attachmentUrlsRef = useRef(new Set<string>());
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const messageWindow = useMemo(() => windowMessages(messages, showAllMessages), [messages, showAllMessages]);
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages, pendingTool, waiting]);
    useEffect(() => {
        if (loadingThreads) setShowAllMessages(false);
    }, [loadingThreads]);
    useEffect(() => {
        if (!messages.length) setShowAllMessages(false);
    }, [messages.length]);
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    const sendPrompt = async () => {
        const text = prompt.trim();
        const files = attachments;
        const requestPrompt = promptWithAttachments(text, files);
        if (!connected || !requestPrompt || sending || waiting) return;
        if (attachmentPayloadBytes(files) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: "图片过大", text: "图片附件超过 30MB，请删减后再发送。" });
            return;
        }
        setAgentState({ activity: "发送中", sending: true, waiting: true });
        addMessage({ role: "user", text: text || "发送了图片", attachments: files });
        addEventLog("用户发送", { text, attachments: files.map(({ name, type, size }) => ({ name, type, size })) });
        try {
            const res = await fetch(`${endpoint}/agent/codex/turn?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: requestPrompt, threadId: useAgentStore.getState().activeThreadId || undefined, attachments: files.map(({ name, type, dataUrl }) => ({ name, type, dataUrl })) }) });
            if (!res.ok) throw new Error("本地 Agent 拒绝了请求");
            const data = (await res.json()) as { threadId?: string };
            if (data.threadId) setAgentState({ activeThreadId: data.threadId });
            addEventLog("本地 Agent 已接收", { status: res.status });
            files.forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            setAgentState({ prompt: "", attachments: [] });
        } catch (error) {
            setAgentState({ activity: "发送失败", waiting: false });
            addMessage({ role: "error", title: "发送失败", text: error instanceof Error ? error.message : "发送失败" });
            addEventLog("发送失败", error);
        } finally {
            setAgentState({ sending: false });
        }
    };

    const stopTurn = async () => {
        if (!connected || (!sending && !waiting)) return;
        setAgentState({ activity: "停止中" });
        try {
            await fetch(`${endpoint}/agent/codex/interrupt?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" } });
            setAgentState({ activity: "已停止", sending: false, waiting: false });
            addEventLog("用户停止", {});
        } catch {
            setAgentState({ activity: "就绪", sending: false, waiting: false });
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useAgentStore.getState().attachments;
        try {
            const next = await Promise.all(images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                const dataUrl = await readDataUrl(file);
                const url = URL.createObjectURL(file);
                attachmentUrlsRef.current.add(url);
                return { id: createId(), name: file.name, type: file.type, size: file.size, url, dataUrl };
            }));
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => {
                    URL.revokeObjectURL(item.url);
                    attachmentUrlsRef.current.delete(item.url);
                });
                addMessage({ role: "error", title: "图片过大", text: "图片附件最多约 30MB。" });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: "图片读取失败", text: error instanceof Error ? error.message : "图片读取失败" });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);
        if (removed) {
            URL.revokeObjectURL(removed.url);
            attachmentUrlsRef.current.delete(removed.url);
        }
        setAgentState({ attachments: attachments.filter((item) => item.id !== id) });
    };

    const startNewThread = async () => {
        if (!connected) return;
        setShowAllMessages(false);
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, "/agent/codex/threads/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            setAgentState({ activeThreadId: data.thread?.id || data.workspace?.activeThreadId || "", messages: [], activeTab: "chat", activity: "新对话" });
            await loadAgentThreads();
        } catch (error) {
            addEventLog("新建对话失败", error);
            message.error(error instanceof Error ? error.message : "新建对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const resumeThread = async (threadId: string) => {
        if (!connected || !threadId) return;
        setShowAllMessages(false);
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            setAgentState({ activeThreadId: data.thread?.id || threadId, messages: normalizeAgentHistoryMessages(data.messages || []), activeTab: "chat", activity: "已恢复会话" });
            await loadAgentThreads();
        } catch (error) {
            addEventLog("恢复对话失败", error);
            message.error(error instanceof Error ? error.message : "恢复对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const deleteThread = async (threadId: string) => {
        if (!connected || !threadId) return;
        setAgentState({ loadingThreads: true });
        try {
            await fetchAgentJson(endpoint, token, `/agent/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            const current = useAgentStore.getState();
            if (current.activeThreadId === threadId) setShowAllMessages(false);
            setAgentState({
                threads: current.threads.filter((thread) => thread.id !== threadId),
                activeThreadId: current.activeThreadId === threadId ? "" : current.activeThreadId,
                messages: current.activeThreadId === threadId ? [] : current.messages,
            });
            message.success("记录已删除");
        } catch (error) {
            addEventLog("删除对话失败", error);
            message.error(error instanceof Error ? error.message : "删除对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThread = (thread: AgentThreadSummary) => {
        const label = thread.name || thread.preview || "未命名对话";
        modal.confirm({
            title: "删除对话记录",
            content: `确定删除「${label.length > 48 ? `${label.slice(0, 48)}...` : label}」吗？`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
            onOk: () => deleteThread(thread.id),
        });
    };

    const addMessage = (item: Omit<AgentChatItem, "id">) => {
        const currentMessages = useAgentStore.getState().messages;
        const nextMessages = upsertAgentMessage(currentMessages, item, `${Date.now()}-${Math.random()}`);
        if (nextMessages !== currentMessages) setAgentState({ messages: nextMessages });
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), title, text: normalizeAgentText(text) || title, raw });
    };

    const content = (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                items={[
                    { value: "setup", label: "连接", icon: <PlugZap className="size-3.5" /> },
                    { value: "chat", label: "对话" },
                    { value: "history", label: "历史", icon: <History className="size-3.5" />, count: threads.length },
                    { value: "log", label: "日志", icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadAgentThreads();
                }}
                right={
                    <>
                        <Button size="small" type="text" disabled={!canvasContext?.canUndo} icon={<RotateCcw className="size-3.5" />} onClick={undoLastAgentTool}>
                            撤销
                        </Button>
                    </>
                }
            />

            {activeTab === "setup" ? (
                <AgentConnectView
                    theme={theme}
                    url={url}
                    token={token}
                    enabled={enabled}
                    connected={connected}
                    activity={activity}
                    connectError={connectError}
                    onUrlChange={(url) => setAgentState({ url, connectError: "" })}
                    onTokenChange={(token) => setAgentState({ token, connectError: "" })}
                    onToggleEnabled={() => void toggleAgentConnection()}
                />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    connected={connected}
                    onRefresh={() => void loadAgentThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThread={confirmDeleteThread}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messages.length, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <>
                    <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {messageWindow.hiddenCount > 0 ? (
                            <button type="button" className="mx-auto block text-xs underline-offset-2 hover:underline" style={{ color: theme.node.muted }} onClick={() => setShowAllMessages(true)}>
                                显示更早 {messageWindow.hiddenCount} 条消息
                            </button>
                        ) : null}
                        {messageWindow.visible.map((item) => (
                            <AgentChatMessage key={item.id} item={agentMessageToChatMessage(item)} theme={theme} user={user} />
                        ))}
                        {pendingTool ? <AgentPendingToolCard summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || canvasAgentToolName(pendingTool.name)} detail={{ requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input }} theme={theme} onReject={() => void rejectPendingTool()} onApprove={() => void approvePendingTool()} /> : null}
                        {waiting && !pendingTool ? <AgentWorkingMessage theme={theme} /> : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={attachments.map(agentAttachmentToChatAttachment)}
                        disabled={!connected}
                        sending={sending || waiting}
                        placeholder="询问 Codex，或让它操作网站/画布"
                        theme={theme}
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={sendPrompt}
                        onStop={stopTurn}
                        onAddFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        left={attachments.length ? <span className="text-[11px]" style={{ color: theme.node.muted }}>{formatBytes(attachmentPayloadBytes(attachments))} / 30MB</span> : null}
                    />
                </>
            )}
        </>
    );

    return embedded ? content : null;
}

function AgentLogView({ logs, theme, context, onClear, onCopied, onCopyBlocked }: { logs: AgentEventLog[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; context: AgentLogContext; onClear: () => void; onCopied: (text: string) => void; onCopyBlocked: (text: string) => void }) {
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = "日志已复制") => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked("已选中日志，请手动复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex min-h-full flex-col gap-3">
                <div>
                    <div className="text-base font-semibold leading-6">运行日志</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented size="small" value={mode} onChange={(value) => setMode(value as "text" | "json")} options={[{ label: "排查日志", value: "text" }, { label: "原始 JSON", value: "json" }]} />
                    <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: theme.node.muted }}>{logs.length} 条</span>
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>复制</Button>
                        <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), "最近错误已复制")}>最近错误</Button>
                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>清空</Button>
                    </div>
                </div>
                <textarea
                    ref={textareaRef}
                    readOnly
                    value={content}
                    className="thin-scrollbar min-h-[360px] flex-1 resize-none rounded-lg border bg-transparent p-3 font-mono text-xs leading-5 outline-none"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    onFocus={(event) => event.currentTarget.select()}
                />
            </div>
        </div>
    );
}

function AgentConnectView({ theme, url, token, enabled, connected, activity, connectError, onUrlChange, onTokenChange, onToggleEnabled }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; url: string; token: string; enabled: boolean; connected: boolean; activity: string; connectError: string; onUrlChange: (value: string) => void; onTokenChange: (value: string) => void; onToggleEnabled: () => void }) {
    const { message } = App.useApp();
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const [codexAuth, setCodexAuth] = useState<CodexAuthState>({ loggedIn: false, summary: "" });
    const [codexAuthPhase, setCodexAuthPhase] = useState<CodexAuthPhase>("idle");
    const codexAuthRunRef = useRef(0);
    const codexAuthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connectionActive = enabled && !connectError;
    const statusText = connectError ? "连接失败" : connected ? activity : enabled ? "连接中" : "未连接";
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const codexStatusText = codexAuthStatusText({ connected, phase: codexAuthPhase, auth: codexAuth });
    const codexBusy = codexAuthPhase === "checking" || codexAuthPhase === "waiting";
    const codexStatusColor = !connected ? theme.node.muted : codexAuth.loggedIn ? "#16a34a" : codexBusy ? "#d97706" : "#dc2626";
    const stopCodexAuthWork = useCallback(() => {
        codexAuthRunRef.current += 1;
        if (codexAuthTimerRef.current) clearTimeout(codexAuthTimerRef.current);
        codexAuthTimerRef.current = null;
    }, []);
    const readCodexAuth = useCallback(async () => normalizeCodexAuthResponse(await fetchAgentJson<unknown>(endpoint, token, "/agent/codex/auth")), [endpoint, token]);
    const detectCodexAuth = useCallback(async () => {
        stopCodexAuthWork();
        if (!connected) {
            setCodexAuth({ loggedIn: false, summary: "" });
            setCodexAuthPhase("idle");
            return;
        }
        const runId = codexAuthRunRef.current;
        setCodexAuthPhase("checking");
        try {
            const auth = await readCodexAuth();
            if (codexAuthRunRef.current !== runId) return;
            setCodexAuth(auth);
        } catch {
            if (codexAuthRunRef.current !== runId) return;
            setCodexAuth({ loggedIn: false, summary: "" });
        }
        if (codexAuthRunRef.current === runId) setCodexAuthPhase("ready");
    }, [connected, readCodexAuth, stopCodexAuthWork]);
    const beginCodexLogin = async () => {
        stopCodexAuthWork();
        if (!connected) return;
        const runId = codexAuthRunRef.current;
        try {
            const result = await fetchAgentJson<{ started?: boolean; reason?: string }>(endpoint, token, "/agent/codex/login", { method: "POST" });
            if (codexAuthRunRef.current !== runId) return;
            if (result.started !== true && result.reason !== "already-running") throw new Error("官方登录未能启动，请重试");
            setCodexAuth({ loggedIn: false, summary: "" });
            setCodexAuthPhase("waiting");
            let attempts = 0;
            const poll = async () => {
                if (codexAuthRunRef.current !== runId) return;
                let auth = { loggedIn: false, summary: "" };
                try {
                    auth = await readCodexAuth();
                    if (codexAuthRunRef.current !== runId) return;
                    setCodexAuth(auth);
                } catch {
                    if (codexAuthRunRef.current !== runId) return;
                }
                attempts += 1;
                if (auth.loggedIn) {
                    setCodexAuthPhase("ready");
                    message.success("Codex 已登录");
                    return;
                }
                if (!shouldContinuePolling({ attempts, loggedIn: auth.loggedIn })) {
                    setCodexAuthPhase("timed-out");
                    return;
                }
                codexAuthTimerRef.current = setTimeout(() => void poll(), CODEX_AUTH_POLL_INTERVAL_MS);
            };
            codexAuthTimerRef.current = setTimeout(() => void poll(), CODEX_AUTH_POLL_INTERVAL_MS);
        } catch (error) {
            if (codexAuthRunRef.current !== runId) return;
            setCodexAuthPhase("ready");
            message.error(error instanceof Error ? error.message : "官方登录未能启动，请重试");
        }
    };
    useEffect(() => {
        void detectCodexAuth();
        return stopCodexAuthWork;
    }, [detectCodexAuth, stopCodexAuthWork]);
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success("命令已复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">连接本地 Agent</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        按使用场景选择一种连接方式。
                    </div>
                </div>
                <div className="space-y-2">
                    {AGENT_CONNECT_STEPS.map((step) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <div key={step.title} className="rounded-lg px-3 py-2.5">
                                <div className="text-sm font-medium leading-5">{step.title}</div>
                                <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{step.text}</div>
                                {command ? (
                                    <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                        <Tooltip title="复制命令">
                                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                        </Tooltip>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>

                <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <div className="font-medium" style={{ color: theme.node.text }}>Codex 插件提醒</div>
                    <div className="mt-1">只有安装 Codex 插件或手动添加 MCP 后，工具列表才会进入 Codex 上下文并增加 token 消耗；仅运行 `npx -y @basketikun/canvas-agent` 启动本地 Agent 不会安装 MCP。</div>
                    <div className="mt-2 grid gap-1.5">
                        {[
                            ["移除插件", AGENT_PLUGIN_REMOVE_COMMAND],
                            ["移除手动 MCP", AGENT_MCP_REMOVE_COMMAND],
                        ].map(([label, command]) => (
                            <div key={command} className="flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{label}</span>
                                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                <Tooltip title="复制命令">
                                    <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                </Tooltip>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">网页连接</span>
                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4" style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}>
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                默认自动读取 Local URL 和 Connect token，失败时再手动填写。
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={connectionActive ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {connectionActive ? "断开" : "连接"}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                本地地址
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="例如 http://127.0.0.1:17371" />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                连接 Token
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password size="large" prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="自动发现，或手动填入 Connect token" />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">Codex 账号</span>
                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4" style={{ borderColor: connected ? codexStatusColor : theme.node.stroke, color: codexStatusColor }}>
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: codexStatusColor }} />
                                    <span className="truncate">{codexStatusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {!connected ? "连接成功后会自动检测本机账号状态。" : codexAuthPhase === "waiting" ? "请在系统浏览器完成官方授权，然后回到这里等待自动确认。" : codexAuthPhase === "timed-out" ? "五分钟内未检测到授权结果，可重新发起官方登录。" : codexAuth.loggedIn ? "Codex 功能将使用本机已授权的官方账号。" : "首次使用时需要在系统浏览器完成一次官方授权。"}
                            </div>
                        </div>
                        {connected ? (
                            <Button
                                className="!h-8 !px-3"
                                type={codexAuth.loggedIn ? "default" : "primary"}
                                icon={codexBusy ? <LoaderCircle className="size-4 animate-spin" /> : codexAuth.loggedIn ? <RefreshCw className="size-4" /> : <LogIn className="size-4" />}
                                disabled={codexBusy}
                                onClick={codexAuth.loggedIn ? () => void detectCodexAuth() : () => void beginCodexLogin()}
                            >
                                {codexAuthPhase === "checking" ? "检测中" : codexAuthPhase === "waiting" ? "等待授权" : codexAuth.loggedIn ? "重新检测" : codexAuthPhase === "timed-out" ? "再试一次" : "去官方登录"}
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AgentHistoryView({ theme, threads, activeThreadId, workspacePath, loading, connected, onRefresh, onNewThread, onResumeThread, onDeleteThread }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; threads: AgentThreadSummary[]; activeThreadId: string; workspacePath: string; loading: boolean; connected: boolean; onRefresh: () => void; onNewThread: () => void; onResumeThread: (threadId: string) => void; onDeleteThread: (thread: AgentThreadSummary) => void }) {
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">工作空间</span>
                    <span className="min-w-0 truncate" title={workspacePath}>{workspacePath || "默认画布目录"}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? `${threads.length} 条历史` : connected ? "暂无历史" : "未连接"}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            刷新
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading} onClick={onNewThread}>
                            新对话
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                            <div key={thread.id} className="rounded-lg border px-2.5 py-1.5 transition" style={{ borderColor: active ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.text }}>当前</span> : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || "未命名对话"}</div>
                                        </div>
                                        <div className="truncate text-[11px] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-[10px] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt)}</span>
                                        <Button size="small" className="!h-6 !px-2" disabled={loading} onClick={() => onResumeThread(thread.id)}>
                                            进入
                                        </Button>
                                        <Tooltip title="删除记录">
                                            <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" disabled={loading} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteThread(thread)} />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {connected ? "当前工作空间还没有对话记录" : "连接本地 Agent 后显示历史记录"}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

const agentChatMessageCache = new WeakMap<AgentChatItem, CanvasAgentChatMessage>();

function agentMessageToChatMessage(item: AgentChatItem): CanvasAgentChatMessage {
    if (!item.attachments?.length) return item;
    const cached = agentChatMessageCache.get(item);
    if (cached) return cached;
    const converted = { ...item, attachments: item.attachments.map(agentAttachmentToChatAttachment) };
    agentChatMessageCache.set(item, converted);
    return converted;
}

function agentAttachmentToChatAttachment(item: AgentAttachment): CanvasAgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        "Infinite Canvas Agent 诊断日志",
        `Canvas Agent: ${context.endpoint}`,
        `连接: ${context.connected ? "在线" : context.enabled ? "连接中" : "未启用"}`,
        `状态: ${context.activity}`,
        `waiting: ${context.waiting}`,
        `sending: ${context.sending}`,
        `messages: ${context.messages}`,
        `pendingTool: ${context.pendingTool ? canvasAgentToolName(context.pendingTool) : "none"}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs.map((item, index) => {
        const detail = item.raw == null ? item.text : JSON.stringify(item.raw, null, 2);
        return [`#${index + 1} ${item.time} ${item.title}`, detail].filter(Boolean).join("\n");
    }).join("\n\n---\n\n");
    return [head, body || "暂无事件日志"].join("\n\n");
}

function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    if (!attachments.length) return text;
    const names = attachments.map((item) => item.name).join("、");
    return [text, `用户上传了 ${attachments.length} 张图片附件：${names}。`].filter(Boolean).join("\n\n");
}

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

function formatThreadTime(value?: number) {
    if (!value) return "";
    return new Date(value * 1000).toLocaleString();
}

function createId() {
    return typeof crypto === "undefined" ? `${Date.now()}-${Math.random()}` : crypto.randomUUID();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}
