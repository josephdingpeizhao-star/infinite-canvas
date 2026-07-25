import { useEffect, useRef, useState } from "react";
import { Segmented } from "antd";
import { Eye } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { pollReadonlyAssistant, readonlyAssistantHistory, submitReadonlyAssistantQuestion, type ReadonlyAssistantSnapshot } from "@/lib/canvas/canvas-readonly-assistant";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { AgentChatComposer, AgentChatMessage, type CanvasAgentChatMessage } from "./canvas-agent-chat-ui";
import { CanvasLocalAgentPanel } from "./canvas-local-agent-panel";

type AssistantMode = "readonly" | "general";

const INTRO_MESSAGE: CanvasAgentChatMessage = {
    id: "readonly-assistant-intro",
    role: "system",
    text: "只查看已登记批次的状态、质检、失败事件和交付清单，不会执行操作。",
};

export function CanvasReadonlyAssistantPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const token = useAgentStore((state) => state.token);
    const [mode, setMode] = useState<AssistantMode>("readonly");
    const [prompt, setPrompt] = useState("");
    const [messages, setMessages] = useState<CanvasAgentChatMessage[]>([INTRO_MESSAGE]);
    const [snapshot, setSnapshot] = useState<ReadonlyAssistantSnapshot | null>(null);
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
                text: "上一条问答仍在进行，本次没有排队，请稍后再问。",
            });
            return;
        }
        const history = readonlyAssistantHistory(messages);
        busyRef.current = true;
        setBusy(true);
        setPrompt("");
        appendMessage({ role: "user", text: question });
        try {
            const started = await submitReadonlyAssistantQuestion(question, history, token);
            setSnapshot(started);
            const finished = started.status === "working" ? await pollReadonlyAssistant(started, token, { onSnapshot: setSnapshot }) : started;
            setSnapshot(null);
            if (finished.status === "completed") {
                appendMessage({ role: "assistant", text: finished.answer || finished.message });
            } else {
                appendMessage({ role: "error", text: finished.message });
            }
        } catch (error) {
            setSnapshot(null);
            appendMessage({
                role: "error",
                text: error instanceof Error ? error.message : "只读助手暂时无法回答。",
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
                        { label: "批次问答（只读）", value: "readonly" },
                        { label: "通用 Agent（原有）", value: "general" },
                    ]}
                    onChange={(value) => setMode(value as AssistantMode)}
                />
            </div>

            <div className={mode === "readonly" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
                    {messages.map((item) => (
                        <AgentChatMessage key={item.id} item={item} theme={theme} user={user} />
                    ))}
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
                        <Eye className="size-3.5" />
                        只读查看，不执行任务，不使用图片附件
                    </span>
                </div>
                <AgentChatComposer prompt={prompt} sending={busy} placeholder="例如：第三批现在什么状态？" theme={theme} onPromptChange={setPrompt} onSubmit={submit} />
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
