import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import {
    buildWorkflowDemoFrames,
    connectedWorkflowImageIds,
    findWorkflowDemoOutputPosition,
    readWorkflowDemoState,
    rectanglesOverlap,
    resetInterruptedWorkflowDemos,
    startWorkflowDemoSequence,
    usesCustomNodeContent,
    workflowDemoDelayMs,
} from "../src/lib/canvas/canvas-workflow-demo";

function node(id: string, type: CanvasNodeType, x: number, y: number, width = 180, height = 180, content?: string): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x, y },
        width,
        height,
        metadata: content ? { content } : undefined,
    };
}

describe("workflow demo node", () => {
    test("uses the dedicated content branch without changing ordinary node branches", () => {
        expect(usesCustomNodeContent(CanvasNodeType.Workflow)).toBe(true);
        expect(usesCustomNodeContent(CanvasNodeType.Config)).toBe(true);
        expect(usesCustomNodeContent(CanvasNodeType.Image)).toBe(false);
    });

    test("survives JSON persistence and tolerates missing or invalid demo fields", () => {
        const serialized = JSON.parse(
            JSON.stringify({
                workflowDemo: {
                    status: "completed",
                    producedCount: 99,
                    completedRuns: -2,
                    runId: "run-1",
                },
            }),
        );
        expect(readWorkflowDemoState(serialized)).toEqual({
            status: "completed",
            producedCount: 14,
            completedRuns: 0,
            runId: "run-1",
            errorMessage: undefined,
        });
        expect(readWorkflowDemoState({ workflowDemo: { status: "unknown" } as never }).status).toBe("idle");
        expect(readWorkflowDemoState(undefined).producedCount).toBe(0);
    });

    test("counts only unique inbound image assets with content", () => {
        const workflow = node("machine", CanvasNodeType.Workflow, 0, 0, 420, 300);
        const image = node("image", CanvasNodeType.Image, -300, 0, 180, 180, "data:image/png;base64,AA==");
        const emptyImage = node("empty", CanvasNodeType.Image, -300, 220);
        const text = node("text", CanvasNodeType.Text, -300, 440, 180, 180, "说明");
        const output = node("output", CanvasNodeType.Image, 600, 0, 180, 180, "data:image/png;base64,AA==");
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: image.id, toNodeId: workflow.id },
            { id: "b", fromNodeId: image.id, toNodeId: workflow.id },
            { id: "c", fromNodeId: emptyImage.id, toNodeId: workflow.id },
            { id: "d", fromNodeId: text.id, toNodeId: workflow.id },
            { id: "e", fromNodeId: workflow.id, toNodeId: output.id },
        ];
        expect(connectedWorkflowImageIds(workflow.id, [workflow, image, emptyImage, text, output], connections)).toEqual([image.id]);
    });

    test("plans exactly six main images and eight detail images with bounded delays", () => {
        const frames = buildWorkflowDemoFrames("run-1");
        expect(frames).toHaveLength(14);
        expect(frames.slice(0, 6).map((frame) => frame.label)).toEqual(["演示 · 主图 1", "演示 · 主图 2", "演示 · 主图 3", "演示 · 主图 4", "演示 · 主图 5", "演示 · 主图 6"]);
        expect(frames.slice(6).map((frame) => frame.label)).toEqual(["演示 · 详情 1", "演示 · 详情 2", "演示 · 详情 3", "演示 · 详情 4", "演示 · 详情 5", "演示 · 详情 6", "演示 · 详情 7", "演示 · 详情 8"]);
        expect(new Set(frames.map((frame) => frame.id)).size).toBe(14);
        frames.forEach((_, index) => expect(workflowDemoDelayMs(index)).toBeGreaterThanOrEqual(1500));
        frames.forEach((_, index) => expect(workflowDemoDelayMs(index)).toBeLessThanOrEqual(2500));
    });

    test("places the full fan to the right without covering the machine or existing nodes", () => {
        const machine = node("machine", CanvasNodeType.Workflow, 0, 0, 420, 300);
        const userNode = node("user", CanvasNodeType.Image, 540, -120, 240, 240, "data:image/png;base64,AA==");
        const placed: CanvasNodeData[] = [machine, userNode];
        for (const frame of buildWorkflowDemoFrames("run-layout")) {
            const position = findWorkflowDemoOutputPosition(machine, placed, frame);
            const next = node(frame.id, CanvasNodeType.Image, position.x, position.y, frame.width, frame.height, "data:image/png;base64,AA==");
            expect(next.position.x).toBeGreaterThan(machine.position.x + machine.width);
            placed.forEach((existing) => expect(rectanglesOverlap(next, existing, 20)).toBe(false));
            placed.push(next);
        }
        expect(placed).toHaveLength(16);
    });

    test("streams no more than fourteen frames and cancellation clears the next timer", () => {
        type Task = { callback: () => void; delay: number; canceled: boolean };
        const tasks: Task[] = [];
        const seen: string[] = [];
        let completed = 0;
        const timer = {
            setTimeout(callback: () => void, delay: number) {
                const task = { callback, delay, canceled: false };
                tasks.push(task);
                return task;
            },
            clearTimeout(task: Task) {
                task.canceled = true;
            },
        };
        startWorkflowDemoSequence({
            runId: "run-stream",
            timer,
            onFrame: (frame) => seen.push(frame.id),
            onComplete: () => completed++,
            onError: (error) => {
                throw error;
            },
        });
        while (tasks.some((task) => !task.canceled)) {
            const task = tasks.find((candidate) => !candidate.canceled)!;
            task.canceled = true;
            expect(task.delay).toBeGreaterThanOrEqual(1500);
            expect(task.delay).toBeLessThanOrEqual(2500);
            task.callback();
        }
        expect(seen).toHaveLength(14);
        expect(completed).toBe(1);

        const canceledTasks: Task[] = [];
        const canceledSeen: string[] = [];
        const sequence = startWorkflowDemoSequence({
            runId: "run-cancel",
            timer: {
                setTimeout(callback, delay) {
                    const task = { callback, delay, canceled: false };
                    canceledTasks.push(task);
                    return task;
                },
                clearTimeout(task) {
                    task.canceled = true;
                },
            },
            onFrame: (frame) => canceledSeen.push(frame.id),
            onComplete: () => completed++,
            onError: (error) => {
                throw error;
            },
        });
        sequence.cancel();
        expect(canceledTasks[0]?.canceled).toBe(true);
        canceledTasks[0]?.callback();
        expect(canceledSeen).toEqual([]);
    });

    test("turns an interrupted local run into a visible failure while preserving progress", () => {
        const running = node("running", CanvasNodeType.Workflow, 0, 0, 420, 300);
        running.metadata = { workflowDemo: { status: "running", producedCount: 5, completedRuns: 0, runId: "run-1" } };
        const awaitingFirstRun = node("awaiting-first", CanvasNodeType.Workflow, 0, 320, 420, 300);
        awaitingFirstRun.metadata = { workflowDemo: { status: "awaiting_confirmation", producedCount: 0, completedRuns: 0 } };
        const awaitingRerun = node("awaiting-rerun", CanvasNodeType.Workflow, 0, 640, 420, 300);
        awaitingRerun.metadata = { workflowDemo: { status: "awaiting_confirmation", producedCount: 14, completedRuns: 1 } };
        const completedNode = node("completed", CanvasNodeType.Workflow, 0, 400, 420, 300);
        completedNode.metadata = { workflowDemo: { status: "completed", producedCount: 14, completedRuns: 1 } };
        const restored = resetInterruptedWorkflowDemos([running, awaitingFirstRun, awaitingRerun, completedNode]);
        expect(readWorkflowDemoState(restored[0].metadata)).toMatchObject({ status: "failed", producedCount: 5 });
        expect(readWorkflowDemoState(restored[1].metadata)).toMatchObject({ status: "idle", producedCount: 0, errorMessage: undefined });
        expect(readWorkflowDemoState(restored[2].metadata)).toMatchObject({ status: "completed", producedCount: 14, errorMessage: undefined });
        expect(readWorkflowDemoState(restored[3].metadata)).toMatchObject({ status: "completed", producedCount: 14 });
    });
});
