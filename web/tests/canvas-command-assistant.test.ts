import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
    CLOSED_WORKFLOW_COMMANDS,
    COMMAND_ASSISTANT_ENDPOINT,
    commandAssistantTargetMode,
    isClosedWorkflowCommand,
    mergeCommandAssistantSnapshot,
    pollCommandAssistant,
    resolveBatchAssistantTurn,
    submitCommandAssistantIntent,
    type CommandAssistantSnapshot,
} from "../src/lib/canvas/canvas-command-assistant";
import { CanvasCommandDraftCard } from "../src/components/canvas/canvas-command-draft-card";
import {
    clearWorkflowCommandBridge,
    registerWorkflowCommandBridge,
    sendWorkflowCommandDraft,
    useCanvasWorkflowCommandStore,
    type WorkflowCommandTarget,
} from "../src/stores/canvas/use-canvas-workflow-command-store";
import { buildWorkflowDemoCommand, readWorkflowDemoState } from "../src/lib/canvas/canvas-workflow-demo";
import { buildProductionCommand, readProductionState } from "../src/lib/canvas/canvas-workflow-production";


function workingSnapshot(patch: Partial<CommandAssistantSnapshot> = {}): CommandAssistantSnapshot {
    return {
        ok: true,
        requestId: "draft-1",
        status: "working",
        message: "助手正在辨认你要执行的步骤…",
        startedAt: 1_000,
        updatedAt: 1_000,
        deadlineAt: 301_000,
        ...patch,
    };
}

const draft = {
    command: "retry: qc" as const,
    verb: "retry" as const,
    target: "qc" as const,
    title: "重新执行成图质检",
    description: "重新逐张检查 14 张成图的质量。",
};

const demoTarget: WorkflowCommandTarget = {
    nodeId: "demo-machine",
    title: "演示机器",
    mode: "demo",
};

const productionTarget: WorkflowCommandTarget = {
    nodeId: "real-machine",
    title: "真实机器",
    mode: "production",
    batchId: "杯子_20260722",
};

describe("canvas command assistant", () => {
    test("accepts exactly the nineteen closed workflow commands", () => {
        expect(CLOSED_WORKFLOW_COMMANDS.size).toBe(19);
        expect(isClosedWorkflowCommand("run: next")).toBe(true);
        expect(isClosedWorkflowCommand("retry: qc")).toBe(true);
        expect(isClosedWorkflowCommand("Run: qc")).toBe(false);
        expect(isClosedWorkflowCommand("run: QC")).toBe(false);
        expect(isClosedWorkflowCommand("retry: next")).toBe(false);
        expect(isClosedWorkflowCommand("run: build_batch")).toBe(false);
    });

    test("submits only the utterance to the fixed local endpoint with the canvas token", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const snapshot = await submitCommandAssistantIntent("开始做图", "canvas-token", async (input, init) => {
            calls.push({ url: String(input), init });
            return Response.json(
                workingSnapshot({
                    status: "completed",
                    intent: "command",
                    draft: { ...draft, command: "run: next", verb: "run", target: "next", title: "继续下一步" },
                }),
            );
        });
        expect(snapshot.draft?.command).toBe("run: next");
        expect(calls[0]?.url).toBe(`${COMMAND_ASSISTANT_ENDPOINT}/command-assistant/drafts`);
        expect(calls[0]?.init?.method).toBe("POST");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ utterance: "开始做图" });
    });

    test("polling has a 300 second hard stop and preserves unchanged snapshot identity", async () => {
        const original = workingSnapshot();
        expect(mergeCommandAssistantSnapshot(original, { ...original })).toBe(original);
        let now = 1_000;
        let polls = 0;
        const result = await pollCommandAssistant(original, "canvas-token", {
            now: () => now,
            pollMs: 100_000,
            maxWaitMs: 300_000,
            sleep: async (milliseconds) => {
                now += milliseconds;
            },
            fetcher: async () => {
                polls += 1;
                return Response.json(workingSnapshot({ deadlineAt: 999_999, updatedAt: now }));
            },
        });
        expect(result.status).toBe("failed");
        expect(result.message).toContain("超时");
        expect(polls).toBe(2);
        await expect(pollCommandAssistant(original, "canvas-token", { maxWaitMs: 300_001 })).rejects.toThrow("300 秒");
    });

    test("question intent calls the existing readonly question functions unchanged", async () => {
        const submitReadonly = mock(async () => ({
            ok: true as const,
            requestId: "question-1",
            status: "completed" as const,
            message: "助手已查看完成。",
            startedAt: 1,
            updatedAt: 2,
            deadlineAt: 301,
            answer: "第三批已关账。",
        }));
        const pollReadonly = mock(async (snapshot) => snapshot);
        const result = await resolveBatchAssistantTurn("第三批现在什么状态？", [], "canvas-token", {
            submitCommand: async () =>
                workingSnapshot({
                    status: "completed",
                    intent: "question",
                    route: "readonly",
                    message: "已识别为批次问题。",
                }),
            submitReadonly,
            pollReadonly,
        });
        expect(result).toEqual({ kind: "answer", text: "第三批已关账。" });
        expect(submitReadonly).toHaveBeenCalledTimes(1);
        expect(submitReadonly.mock.calls[0]).toEqual(["第三批现在什么状态？", [], "canvas-token"]);
        expect(pollReadonly).toHaveBeenCalledTimes(0);
    });

    test("command and unsupported outcomes never call the readonly assistant", async () => {
        const submitReadonly = mock(async () => {
            throw new Error("readonly must not run");
        });
        const command = await resolveBatchAssistantTurn("重跑质检", [], "canvas-token", {
            submitCommand: async () =>
                workingSnapshot({
                    status: "completed",
                    intent: "command",
                    draft,
                    message: "命令草稿已准备好。",
                }),
            submitReadonly,
        });
        expect(command).toEqual({ kind: "draft", draft });

        const unsupported = await resolveBatchAssistantTurn("帮我建个批次", [], "canvas-token", {
            submitCommand: async () =>
                workingSnapshot({
                    status: "completed",
                    intent: "unsupported",
                    message: "这个我还不会，请使用信息卡。",
                }),
            submitReadonly,
        });
        expect(unsupported).toEqual({ kind: "message", text: "这个我还不会，请使用信息卡。" });
        expect(submitReadonly).toHaveBeenCalledTimes(0);
    });

    test("the bridge invokes the exact callback registered by the machine button path", () => {
        clearWorkflowCommandBridge("test-cleanup");
        const requestWorkflowStart = mock((_nodeId: string, _command?: string) => undefined);
        registerWorkflowCommandBridge("project-1", [demoTarget], requestWorkflowStart);
        expect(sendWorkflowCommandDraft("demo-machine", "run: next")).toBe(true);
        expect(requestWorkflowStart).toHaveBeenCalledTimes(1);
        expect(requestWorkflowStart.mock.calls[0]).toEqual(["demo-machine", "run: next"]);
        expect(sendWorkflowCommandDraft("demo-machine", "run: build_batch")).toBe(false);
        expect(requestWorkflowStart).toHaveBeenCalledTimes(1);
        clearWorkflowCommandBridge("project-1");
    });

    test("bridge targets and sender references remain stable for equivalent registration", () => {
        const sender = () => undefined;
        registerWorkflowCommandBridge("project-stable", [demoTarget], sender);
        const before = useCanvasWorkflowCommandStore.getState();
        registerWorkflowCommandBridge("project-stable", [{ ...demoTarget }], sender);
        const after = useCanvasWorkflowCommandStore.getState();
        expect(after.targets).toBe(before.targets);
        expect(after.sender).toBe(before.sender);
        clearWorkflowCommandBridge("other-project");
        expect(useCanvasWorkflowCommandStore.getState().ownerId).toBe("project-stable");
        clearWorkflowCommandBridge("project-stable");
    });

    test("zero, one and many machine target modes are explicit", () => {
        expect(commandAssistantTargetMode([])).toEqual({ mode: "empty", selectedId: "" });
        expect(commandAssistantTargetMode([demoTarget])).toEqual({ mode: "single", selectedId: "demo-machine" });
        expect(commandAssistantTargetMode([demoTarget, productionTarget])).toEqual({ mode: "multiple", selectedId: "" });
    });

    test("draft card renders command, human explanation, gate reminder and zero-machine notice", () => {
        const empty = renderToStaticMarkup(createElement(CanvasCommandDraftCard, { draft, targets: [], onSend: () => false }));
        expect(empty).toContain("retry: qc");
        expect(empty).toContain("重新逐张检查");
        expect(empty).toContain("最终由机器");
        expect(empty).toContain("还没有工作流机器");

        const demo = renderToStaticMarkup(createElement(CanvasCommandDraftCard, { draft, targets: [demoTarget], onSend: () => true }));
        expect(demo).toContain("0 元演示");
        expect(demo).toContain("发出命令");
    });

    test("assistant commands pass through existing demo and real command builders only after confirmation", () => {
        const demo = buildWorkflowDemoCommand(readWorkflowDemoState(undefined), "demo-1", 1_000, "run: next");
        expect(demo.content.split("\n").at(-1)).toBe("run: next");
        const productionState = readProductionState({ workflowProduction: { status: "idle", producedCount: 0, totalCount: 5, expectedConfigIds: ["main_01", "main_02", "main_03", "detail_01", "detail_02"] } });
        const production = buildProductionCommand(productionState, "cup", "real-1", 2_000, "retry: qc");
        expect(production.content.split("\n").at(-1)).toBe("retry: qc");
        expect(() => buildProductionCommand(readProductionState(undefined), "cup", "bad-1", 3_000, "run: build_batch" as never)).toThrow("封闭命令");
    });

    test("machine buttons retain their existing default demo and production commands", () => {
        expect(buildWorkflowDemoCommand(readWorkflowDemoState(undefined), "demo-default", 1_000).content.split("\n").at(-1)).toBe("run: renders");
        const productionState = readProductionState({ workflowProduction: { status: "idle", producedCount: 0, totalCount: 5, expectedConfigIds: ["main_01", "main_02", "main_03", "detail_01", "detail_02"] } });
        expect(buildProductionCommand(productionState, "cup", "real-default", 2_000).content.split("\n").at(-1)).toBe("run: next");
    });
});
