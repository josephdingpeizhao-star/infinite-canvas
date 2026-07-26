import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import { localForageStorage } from "../src/lib/localforage-storage";
import {
    CLOSED_BATCH_CONFIRMATION_TEXT,
    DELETE_ALL_CONFIRMATION_TEXT,
    PROJECT_DELETION_MAX_BATCHES,
    PROJECT_DELETION_MAX_REQUEST_ID_LENGTH,
    PROJECT_DELETION_PREVIEW_URL,
    PROJECT_DELETION_EXECUTE_URL,
    buildProjectDeletionPlan,
    commitFrontendProjectDeletion,
    confirmationTextForProjectDeletion,
    groupProjectDeletionResults,
    previewProjectDeletion,
    projectDeletionConfirmationMatches,
    submitProjectDeletionExecution,
    type ProjectDeletionExecuteReceipt,
    type ProjectDeletionPreviewReceipt,
} from "../src/lib/canvas/canvas-project-delete";
import { CanvasBatchInfoNode } from "../src/components/canvas/canvas-batch-info-node";
import { CanvasProjectDeletionWarnings } from "../src/components/canvas/canvas-delete-projects-dialog";
import { claimCanvasProjectDeletionExecution } from "../src/hooks/use-canvas-project-delete";
import { removeCanvasProjects, useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const BATCH_A = "杯子_20260726";
const BATCH_B = "水壶_20260727";

function batchCard(id: string, batchId = BATCH_A, status: "completed" | "queued" | "failed" = "completed"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.BatchInfo,
        title: "批次信息卡",
        position: { x: 0, y: 0 },
        width: 440,
        height: 540,
        metadata: {
            batchIntake: {
                status,
                productType: "杯子",
                productHeightCm: 12,
                allowClearWater: true,
                prohibitPouringAndHeating: true,
                skipMissingDAngle: true,
                mainImageCount: 6,
                detailImageCount: 8,
                handheldMainCount: 2,
                handheldDetailCount: 1,
                receipt: status === "completed" ? { batchId, imageCount: 2, facts: {} as never } : undefined,
            },
        },
    };
}

function project(id: string, nodes: CanvasNodeData[]): CanvasProject {
    return {
        id,
        title: id,
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function previewReceipt(patch: Partial<ProjectDeletionPreviewReceipt> = {}): ProjectDeletionPreviewReceipt {
    return {
        ok: true,
        requestId: "delete-request-001",
        batches: [
            {
                batchId: BATCH_A,
                status: "in_production",
                closed: false,
                delivered: false,
                recycled: false,
                requiresTypedConfirmation: false,
            },
        ],
        ...patch,
    };
}

function executeReceipt(patch: Partial<ProjectDeletionExecuteReceipt> = {}): ProjectDeletionExecuteReceipt {
    return {
        ok: true,
        requestId: "delete-request-001",
        status: "completed",
        batches: [{ batchId: BATCH_A, status: "deleted", message: "批次已送入 Windows 回收站。" }],
        ...patch,
    };
}

function backendStyleRequestId(batchCount: number) {
    const parts = Array.from({ length: batchCount }, (_, index) => index.toString(16).padStart(64, "0"));
    return `pd1.${parts.join(".")}`;
}

describe("DL-01 project deletion", () => {
    test("collects only completed information-card receipts, de-duplicates, sorts, and preserves every input reference", () => {
        const first = project("target", [batchCard("card-b", BATCH_B), batchCard("card-a", BATCH_A), batchCard("duplicate", BATCH_A)]);
        const projects = [first];
        const nodes = first.nodes;

        const result = buildProjectDeletionPlan(projects, ["target"], false);

        expect(result).toEqual({ ok: true, projectIds: ["target"], batchIds: [BATCH_A, BATCH_B], deleteAll: false });
        expect(projects[0]).toBe(first);
        expect(first.nodes).toBe(nodes);
        expect(first.nodes[0]).toBe(nodes[0]);
    });

    test("does not infer a deletion batch after the information card was removed", () => {
        const output: CanvasNodeData = {
            id: "output",
            type: CanvasNodeType.Image,
            title: "正式图",
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: {
                workflowProduction: { status: "completed", producedCount: 14, totalCount: 14, batchId: BATCH_A },
                workflowProductionOutput: { workflowNodeId: "machine", batchId: BATCH_A, configId: "main_01", index: 1, sha256: "a".repeat(64), downloadUrl: "http://127.0.0.1:17373/output", byteCount: 1 },
            },
        };

        expect(buildProjectDeletionPlan([project("target", [output])], ["target"], false)).toEqual({
            ok: true,
            projectIds: ["target"],
            batchIds: [],
            deleteAll: false,
        });
    });

    test("fails closed for in-progress registration, damaged completed cards, and unsafe batch ids", () => {
        const queued = batchCard("queued", BATCH_A, "queued");
        const damaged = batchCard("damaged");
        damaged.metadata!.batchIntake!.receipt = undefined;
        const unsafe = batchCard("unsafe", "../cup");

        expect(buildProjectDeletionPlan([project("queued-project", [queued])], ["queued-project"], false)).toMatchObject({ ok: false });
        expect(buildProjectDeletionPlan([project("damaged-project", [damaged])], ["damaged-project"], false)).toMatchObject({ ok: false });
        expect(buildProjectDeletionPlan([project("unsafe-project", [unsafe])], ["unsafe-project"], false)).toMatchObject({ ok: false });
    });

    test("rejects batch ids over 120 characters and more than 100 batches before any preview request", async () => {
        const tooLong = "批".repeat(121);
        const tooManyIds = Array.from({ length: PROJECT_DELETION_MAX_BATCHES + 1 }, (_, index) => `批次_${String(index).padStart(3, "0")}`);
        const tooManyProject = project(
            "too-many",
            tooManyIds.map((batchId, index) => batchCard(`card-${index}`, batchId)),
        );
        let previewCalls = 0;
        const fetcher = async () => {
            previewCalls += 1;
            return new Response();
        };

        expect(buildProjectDeletionPlan([project("too-long", [batchCard("long", tooLong)])], ["too-long"], false)).toMatchObject({ ok: false });
        expect(buildProjectDeletionPlan([tooManyProject], ["too-many"], false)).toMatchObject({ ok: false, message: expect.stringContaining("100") });
        await expect(previewProjectDeletion([tooLong], "token", fetcher)).rejects.toThrow("无法安全识别");
        await expect(previewProjectDeletion(tooManyIds, "token", fetcher)).rejects.toThrow("100");
        expect(previewCalls).toBe(0);
    });

    test("a known batch reference in any surviving project blocks the whole deletion without changing either project", () => {
        const target = project("target", [batchCard("card")]);
        const survivorNode: CanvasNodeData = {
            id: "receiving",
            type: CanvasNodeType.Group,
            title: "收货框",
            position: { x: 0, y: 0 },
            width: 200,
            height: 200,
            metadata: { workflowReceivingBox: { status: "closed", batchId: BATCH_A, workflowNodeId: "machine", selectionCount: 14 } },
        };
        const survivor = project("survivor", [survivorNode]);

        const result = buildProjectDeletionPlan([target, survivor], ["target"], false);

        expect(result).toMatchObject({ ok: false });
        if (!result.ok) expect(result.message).toContain("其他项目");
        expect(target.nodes[0]).toBe(target.nodes[0]);
        expect(survivor.nodes[0]).toBe(survivorNode);
    });

    test("front-end project removal preserves every surviving project reference and returns the original array for a no-op", () => {
        const target = project("target", [batchCard("card")]);
        const survivor = project("survivor", []);
        const projects = [target, survivor];

        const next = removeCanvasProjects(projects, ["target"]);

        expect(next).not.toBe(projects);
        expect(next).toEqual([survivor]);
        expect(next[0]).toBe(survivor);
        expect(removeCanvasProjects(projects, ["missing"])).toBe(projects);
        expect(removeCanvasProjects(projects, [])).toBe(projects);
    });

    test("the real store action flushes the pending 400ms save before resolving and preserves surviving project references", async () => {
        const originalSetItem = localForageStorage.setItem;
        const writes: Array<{ name: string; value: string }> = [];
        localForageStorage.setItem = async (name, value) => {
            writes.push({ name, value });
        };
        const target = project("target", [batchCard("card")]);
        const survivor = project("survivor", []);

        try {
            useCanvasStore.setState({ projects: [target, survivor] });
            await useCanvasStore.getState().deleteProjects(["target"]);

            expect(useCanvasStore.getState().projects).toEqual([survivor]);
            expect(useCanvasStore.getState().projects[0]).toBe(survivor);
            expect(writes).toHaveLength(1);
            expect((JSON.parse(writes[0]!.value) as { state: { projects: CanvasProject[] } }).state.projects.map((item) => item.id)).toEqual(["survivor"]);

            await useCanvasStore.getState().deleteProjects(["survivor"]);
        } finally {
            localForageStorage.setItem = originalSetItem;
        }
    });

    test("a persistence failure restores the real store before rejecting and flushes the restored project list", async () => {
        const originalSetItem = localForageStorage.setItem;
        const writes: string[] = [];
        let failNextWrite = true;
        localForageStorage.setItem = async (_name, value) => {
            writes.push(value);
            if (failNextWrite) {
                failNextWrite = false;
                throw new Error("simulated persistence failure");
            }
        };
        const target = project("target", [batchCard("card")]);
        const survivor = project("survivor", []);

        try {
            useCanvasStore.setState({ projects: [target, survivor] });
            await expect(useCanvasStore.getState().deleteProjects(["target"])).rejects.toThrow("没有安全保存");

            expect(useCanvasStore.getState().projects).toEqual([target, survivor]);
            expect(useCanvasStore.getState().projects[0]).toBe(target);
            expect(useCanvasStore.getState().projects[1]).toBe(survivor);
            expect(writes).toHaveLength(2);
            expect((JSON.parse(writes[1]!) as { state: { projects: CanvasProject[] } }).state.projects.map((item) => item.id)).toEqual(["target", "survivor"]);

            await useCanvasStore.getState().deleteProjects(["target", "survivor"]);
        } finally {
            localForageStorage.setItem = originalSetItem;
        }
    });

    test("ordinary edits keep the 400ms persistence delay before and after an immediate project-deletion flush", async () => {
        const originalSetItem = localForageStorage.setItem;
        const originalSetTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        const writes: string[] = [];
        const timers = new Map<number, { callback: () => void; delay: number }>();
        let nextTimerId = 1;
        const target = project("target", [batchCard("card")]);
        const survivor = project("survivor", []);
        const setup = project("setup", []);

        localForageStorage.setItem = async (_name, value) => {
            writes.push(value);
        };

        try {
            useCanvasStore.setState({ projects: [target, survivor, setup] });
            await useCanvasStore.getState().deleteProjects(["setup"]);
            writes.length = 0;

            globalThis.setTimeout = ((callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
                const timerId = nextTimerId++;
                timers.set(timerId, { callback: () => callback(...args), delay: Number(delay) });
                return timerId as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout;
            globalThis.clearTimeout = ((timerId: ReturnType<typeof setTimeout>) => {
                timers.delete(Number(timerId));
            }) as typeof clearTimeout;

            const runOnlyTimer = async () => {
                expect(timers.size).toBe(1);
                const [timerId, timer] = [...timers.entries()][0]!;
                timers.delete(timerId);
                timer.callback();
                for (let index = 0; index < 8; index += 1) await Promise.resolve();
            };

            useCanvasStore.getState().renameProject("survivor", "第一次普通编辑");
            expect(writes).toHaveLength(0);
            expect([...timers.values()].map((timer) => timer.delay)).toEqual([400]);
            await runOnlyTimer();
            expect(writes).toHaveLength(1);

            writes.length = 0;
            await useCanvasStore.getState().deleteProjects(["target"]);
            expect(writes).toHaveLength(1);
            expect(timers.size).toBe(0);

            writes.length = 0;
            useCanvasStore.getState().renameProject("survivor", "删除后的普通编辑");
            expect(writes).toHaveLength(0);
            expect([...timers.values()].map((timer) => timer.delay)).toEqual([400]);
            await runOnlyTimer();
            expect(writes).toHaveLength(1);
        } finally {
            const remainingIds = useCanvasStore.getState().projects.map((item) => item.id);
            if (remainingIds.length) await useCanvasStore.getState().deleteProjects(remainingIds);
            globalThis.setTimeout = originalSetTimeout;
            globalThis.clearTimeout = originalClearTimeout;
            localForageStorage.setItem = originalSetItem;
        }
    });

    test("preview uses only the fixed loopback route, existing token, and sorted batch list", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const receipt = previewReceipt({
            batches: [
                { batchId: BATCH_A, status: "in_production", closed: false, delivered: false, recycled: false, requiresTypedConfirmation: false },
                { batchId: BATCH_B, status: "closed", closed: true, delivered: false, recycled: false, requiresTypedConfirmation: true },
            ],
        });

        const result = await previewProjectDeletion([BATCH_A, BATCH_B], " canvas-token ", async (input, init) => {
            calls.push({ url: String(input), init });
            return Response.json(receipt);
        });

        expect(result).toEqual(receipt);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(PROJECT_DELETION_PREVIEW_URL);
        expect(calls[0]?.init?.method).toBe("POST");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ batchIds: [BATCH_A, BATCH_B] });
        expect(String(calls[0]?.init?.body)).not.toContain("path");
    });

    test("an empty project still has a review plan and makes zero preview requests", async () => {
        let calls = 0;
        const result = await previewProjectDeletion([], "canvas-token", async () => {
            calls += 1;
            return new Response();
        });

        expect(result).toEqual({ ok: true, requestId: "", batches: [] });
        expect(calls).toBe(0);
    });

    test("preview rejects extra fields and exposes only an exact known rejection message", async () => {
        await expect(previewProjectDeletion([BATCH_A], "token", async () => Response.json({ ...previewReceipt(), workspacePath: "private" }))).rejects.toThrow("可信");

        const message = "这个批次无法安全核对，项目没有删除。";
        await expect(previewProjectDeletion([BATCH_A], "token", async () => Response.json({ ok: false, error: "project_deletion_rejected", batchId: BATCH_A, message }, { status: 409 }))).rejects.toThrow(message);
    });

    test("preview rejects lifecycle statuses whose closed, delivered, or recycled flags contradict them", async () => {
        const contradictory: ProjectDeletionPreviewReceipt["batches"] = [
            { batchId: BATCH_A, status: "in_production", closed: true, delivered: false, recycled: false, requiresTypedConfirmation: true },
            { batchId: BATCH_A, status: "closed", closed: false, delivered: false, recycled: false, requiresTypedConfirmation: false },
            { batchId: BATCH_A, status: "delivered", closed: true, delivered: false, recycled: false, requiresTypedConfirmation: true },
            { batchId: BATCH_A, status: "recycled", closed: false, delivered: false, recycled: false, requiresTypedConfirmation: false },
        ];

        for (const batch of contradictory) {
            await expect(previewProjectDeletion([BATCH_A], "token", async () => Response.json(previewReceipt({ batches: [batch] })))).rejects.toThrow("可信");
        }
    });

    test("backend-style request ids for three and one hundred batches survive strict preview and execute validation", async () => {
        for (const batchCount of [3, PROJECT_DELETION_MAX_BATCHES]) {
            const batchIds = Array.from({ length: batchCount }, (_, index) => `批次_${String(index).padStart(3, "0")}`);
            const requestId = backendStyleRequestId(batchCount);
            const previewPayload: ProjectDeletionPreviewReceipt = {
                ok: true,
                requestId,
                batches: batchIds.map((batchId) => ({
                    batchId,
                    status: "in_production",
                    closed: false,
                    delivered: false,
                    recycled: false,
                    requiresTypedConfirmation: false,
                })),
            };
            const executePayload: ProjectDeletionExecuteReceipt = {
                ok: true,
                requestId,
                status: "completed",
                batches: batchIds.map((batchId) => ({ batchId, status: "deleted", message: "批次已送入 Windows 回收站。" })),
            };
            const executeBodies: unknown[] = [];

            const preview = await previewProjectDeletion(batchIds, "token", async () => Response.json(previewPayload));
            const execution = await submitProjectDeletionExecution(requestId, batchIds, "token", async (_input, init) => {
                executeBodies.push(JSON.parse(String(init?.body)));
                return Response.json(executePayload);
            });

            expect(requestId).toHaveLength(3 + batchCount * 65);
            expect(preview).toEqual(previewPayload);
            expect(execution).toEqual(executePayload);
            expect(executeBodies).toEqual([{ requestId, batchIds }]);
        }
    });

    test("request ids accept 8192 characters but reject 8193 before any execute request", async () => {
        const boundaryRequestId = "r".repeat(PROJECT_DELETION_MAX_REQUEST_ID_LENGTH);
        const tooLongRequestId = `${boundaryRequestId}x`;
        let executeCalls = 0;

        const boundaryExecution = await submitProjectDeletionExecution(boundaryRequestId, [BATCH_A], "token", async () => {
            executeCalls += 1;
            return Response.json(executeReceipt({ requestId: boundaryRequestId }));
        });
        expect(boundaryExecution.requestId).toBe(boundaryRequestId);
        expect(executeCalls).toBe(1);

        await expect(previewProjectDeletion([BATCH_A], "token", async () => Response.json(previewReceipt({ requestId: tooLongRequestId })))).rejects.toThrow("可信");
        executeCalls = 0;
        await expect(
            submitProjectDeletionExecution(tooLongRequestId, [BATCH_A], "token", async () => {
                executeCalls += 1;
                return Response.json(executeReceipt({ requestId: tooLongRequestId }));
            }),
        ).rejects.toThrow("尚未就绪");
        expect(executeCalls).toBe(0);
    });

    test("typed confirmation is required only for closed or delivered batches, while delete-all always uses its exact phrase", () => {
        const ordinary = previewReceipt();
        const closed = previewReceipt({
            batches: [{ batchId: BATCH_A, status: "recycled", closed: true, delivered: true, recycled: true, requiresTypedConfirmation: true }],
        });

        expect(confirmationTextForProjectDeletion(false, ordinary)).toBeNull();
        expect(confirmationTextForProjectDeletion(false, closed)).toBe(CLOSED_BATCH_CONFIRMATION_TEXT);
        expect(confirmationTextForProjectDeletion(true, ordinary)).toBe(DELETE_ALL_CONFIRMATION_TEXT);
        expect(confirmationTextForProjectDeletion(true, closed)).toBe(DELETE_ALL_CONFIRMATION_TEXT);
        expect(projectDeletionConfirmationMatches("确认删除已关账批次", CLOSED_BATCH_CONFIRMATION_TEXT)).toBe(true);
        expect(projectDeletionConfirmationMatches(" 确认删除已关账批次 ", CLOSED_BATCH_CONFIRMATION_TEXT)).toBe(false);
        expect(projectDeletionConfirmationMatches("删除全部", DELETE_ALL_CONFIRMATION_TEXT)).toBe(true);
        expect(projectDeletionConfirmationMatches("确认删除已关账批次", DELETE_ALL_CONFIRMATION_TEXT)).toBe(false);

        const ordinaryHtml = renderToStaticMarkup(createElement(CanvasProjectDeletionWarnings, { preview: ordinary }));
        const closedHtml = renderToStaticMarkup(createElement(CanvasProjectDeletionWarnings, { preview: closed }));
        expect(ordinaryHtml).not.toContain("清单中包含已关账或已交付批次");
        expect(closedHtml).toContain("清单中包含已关账或已交付批次");
        expect(closedHtml).toContain("交付产物与账本也会一并进入 Windows 回收站");
    });

    test("the synchronous execution gate accepts only one of two immediate confirmation attempts", () => {
        const gate = { current: false };
        const execute = mock(() => undefined);

        if (claimCanvasProjectDeletionExecution(gate)) execute();
        if (claimCanvasProjectDeletionExecution(gate)) execute();

        expect(execute).toHaveBeenCalledTimes(1);
        expect(gate.current).toBe(true);
        gate.current = false;
        expect(claimCanvasProjectDeletionExecution(gate)).toBe(true);
    });

    test("execute sends the exact preview request id and batch list to the fixed route", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const receipt = executeReceipt();
        const result = await submitProjectDeletionExecution("delete-request-001", [BATCH_A], "token", async (input, init) => {
            calls.push({ url: String(input), init });
            return Response.json(receipt);
        });

        expect(result).toEqual(receipt);
        expect(calls[0]?.url).toBe(PROJECT_DELETION_EXECUTE_URL);
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ requestId: "delete-request-001", batchIds: [BATCH_A] });
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("token");

        await expect(submitProjectDeletionExecution("delete-request-001", [BATCH_A], "token", async () => Response.json({ ...receipt, workspacePath: "private" }))).rejects.toThrow("可信");
        await expect(submitProjectDeletionExecution("delete-request-001", [BATCH_A], "token", async () => Response.json({ ...receipt, requestId: "wrong-request" }))).rejects.toThrow("可信");
    });

    test("a stopped execution groups deleted, failed, and not-started batches and never deletes the front-end project", async () => {
        const stopped: ProjectDeletionExecuteReceipt = {
            ok: false,
            requestId: "delete-request-001",
            status: "stopped",
            batches: [
                { batchId: BATCH_A, status: "deleted", message: "已删除。" },
                { batchId: BATCH_B, status: "failed", message: "批次正在使用，项目没有删除。" },
                { batchId: "杯子_20260728", status: "not_started", message: "尚未开始。" },
            ],
        };
        const remove = mock(async (_ids: string[]) => undefined);
        const cleanup = mock(() => undefined);

        expect(groupProjectDeletionResults(stopped.batches)).toEqual({
            deleted: [stopped.batches[0]],
            failed: [stopped.batches[1]],
            notStarted: [stopped.batches[2]],
        });
        expect(await commitFrontendProjectDeletion(stopped, ["target"], remove, cleanup)).toBe(false);
        expect(remove).toHaveBeenCalledTimes(0);
        expect(cleanup).toHaveBeenCalledTimes(0);
    });

    test("only a complete deleted or already-deleted receipt persists front-end removal before cache cleanup", async () => {
        const trace: string[] = [];
        const receipt = executeReceipt({
            batches: [{ batchId: BATCH_A, status: "already_deleted", message: "此前已删除，本次安全跳过。" }],
        });

        const committed = await commitFrontendProjectDeletion(
            receipt,
            ["target"],
            async (ids) => {
                trace.push(`persist:${ids.join(",")}`);
            },
            () => {
                trace.push("cleanup");
            },
        );

        expect(committed).toBe(true);
        expect(trace).toEqual(["persist:target", "cleanup"]);
    });

    test("the completed information card still renders normally without the RC-01 recycle action", () => {
        const html = renderToStaticMarkup(
            createElement(CanvasBatchInfoNode, {
                node: batchCard("card"),
                connectedOriginalCount: 2,
                connectedStyleReferenceCount: 0,
                connectedOriginalFileNames: ["a.png", "b.png"],
                connectedStyleReferenceFileNames: [],
                onChange: () => undefined,
                onRegister: () => undefined,
                onSupplementStyle: () => undefined,
            }),
        );

        expect(html).toContain("批次号");
        expect(html).toContain(BATCH_A);
        expect(html).not.toContain("移入回收站");
    });

    test("all four entry points use the shared flow and the current-project menu has the approved wording", () => {
        const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
        const librarySource = readFileSync(new URL("../src/pages/canvas/index.tsx", import.meta.url), "utf8");
        const dialogSource = readFileSync(new URL("../src/components/canvas/canvas-delete-projects-dialog.tsx", import.meta.url), "utf8");

        expect(projectSource).toContain('label: "删除当前项目"');
        expect(projectSource).toContain("<CanvasDeleteProjectsDialog");
        expect(projectSource).not.toContain("deleteProjects([projectId])");
        expect(librarySource).toContain("deleteAllRequested");
        expect(librarySource).toContain("<CanvasDeleteProjectsDialog");
        expect(dialogSource).toContain("useCanvasProjectDelete");
    });
});
