import { useEffect, useRef, useState } from "react";
import { Segmented } from "antd";
import { ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { readonlyAssistantHistory, type ReadonlyAssistantSnapshot } from "@/lib/canvas/canvas-readonly-assistant";
import {
    resolveBatchAssistantTurn,
    type CommandAssistantDraft,
    type CommandAssistantSnapshot,
} from "@/lib/canvas/canvas-command-assistant";
import { useAgentStore } from "@/stores/use-agent-store";
import {
    sendWorkflowCommandDraft,
    useCanvasWorkflowCommandStore,
} from "@/stores/canvas/use-canvas-workflow-command-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { AgentChatComposer, AgentChatMessage, type CanvasAgentChatMessage } from "./canvas-agent-chat-ui";
import { CanvasCommandDraftCard } from "./canvas-command-draft-card";
import { CanvasLocalAgentPanel } from "./canvas-local-agent-panel";

type AssistantMode = "readonly" | "general";

const INTRO_MESSAGE: CanvasAgentChatMessage = {
    id: "readonly-assistant-intro",
    role: "system",
    text: "可查看已登记批次，也可把说人话的操作要求整理成命令草稿；草稿不会自动执行。",
};

export function CanvasReadonlyAssistantPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const token = useAgentStore((state) => state.token);
    const workflowTargets = useCanvasWorkflowCommandStore((state) => state.targets);
    const [mode, setMode] = useState<AssistantMode>("readonly");
    const [prompt, setPrompt] = useState("");
    const [messages, setMessages] = useState<CanvasAgentChatMessage[]>([INTRO_MESSAGE]);
    const [snapshot, setSnapshot] = useState<
        CommandAssistantSnapshot | ReadonlyAssistantSnapshot | null
    >(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages, snapshot]);

    const appendMessage = (item: Omit<CanvasAgentChatMessage, "id">) => {
        setMessages((current) => [...current, { ...item, id: createMessageId() }]);
    };

    const submit = async () => {
        const question = prompt.trim();
        if (!question) return;
        if (busyRef.current) {
            appendMessage({
                role: "error",
                text: "上一条请求仍在进行，本次没有排队，请稍后再试。",
            });
            return;
        }
        const history = readonlyAssistantHistory(messages);
        busyRef.current = true;
        setBusy(true);
        setPrompt("");
        appendMessage({ role: "user", text: question });
        try {
            const result = await resolveBatchAssistantTurn(question, history, token, {
                onCommandSnapshot: (value) => setSnapshot(value),
                onReadonlySnapshot: (value) => setSnapshot(value),
            });
            setSnapshot(null);
            if (result.kind === "draft") {
                appendMessage({
                    role: "tool",
                    text: "命令草稿已准备好。",
                    detail: { kind: "command_draft", draft: result.draft },
                });
            } else if (result.kind === "answer" || result.kind === "message") {
                appendMessage({ role: "assistant", text: result.text });
            } else appendMessage({ role: "error", text: result.text });
        } catch (error) {
            setSnapshot(null);
            appendMessage({
                role: "error",
                text: error instanceof Error ? error.message : "批次助手暂时无法处理。",
            });
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <Segmented
                    block
                    size="small"
                    value={mode}
                    options={[
                        { label: "批次助手", value: "readonly" },
                        { label: "通用 Agent（原有）", value: "general" },
                    ]}
                    onChange={(value) => setMode(value as AssistantMode)}
                />
            </div>

            <div className={mode === "readonly" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
                    {messages.map((item) => {
                        const draft = messageDraft(item);
                        return draft ? (
                            <CanvasCommandDraftCard
                                key={item.id}
                                draft={draft}
                                targets={workflowTargets}
                                onSend={sendWorkflowCommandDraft}
                            />
                        ) : (
                            <AgentChatMessage key={item.id} item={item} theme={theme} user={user} />
                        );
                    })}
                    {snapshot?.status === "working" ? (
                        <AgentChatMessage
                            item={{
                                id: snapshot.requestId,
                                role: "assistant",
                                text: snapshot.message,
                                streamId: snapshot.requestId,
                            }}
                            theme={theme}
                            user={user}
                        />
                    ) : null}
                </div>
                <div className="px-4 pb-1 text-xs" style={{ color: theme.node.muted }}>
                    <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5" />
                        问答仍为只读；命令只生成草稿，发出后仍需费用确认
                    </span>
                </div>
                <AgentChatComposer prompt={prompt} sending={busy} placeholder="例如：开始做图，或第三批现在什么状态？" theme={theme} onPromptChange={setPrompt} onSubmit={submit} />
            </div>

            <div className={mode === "general" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <CanvasLocalAgentPanel embedded />
            </div>
        </div>
    );
}

function createMessageId() {
    return typeof crypto === "undefined" ? `${Date.now()}-${Math.random()}` : crypto.randomUUID();
}

function messageDraft(item: CanvasAgentChatMessage): CommandAssistantDraft | null {
    if (!item.detail || typeof item.detail !== "object") return null;
    const detail = item.detail as Record<string, unknown>;
    if (detail.kind !== "command_draft" || !detail.draft || typeof detail.draft !== "object") {
        return null;
    }
    return detail.draft as CommandAssistantDraft;
}
