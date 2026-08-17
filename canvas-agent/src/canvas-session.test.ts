import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, test } from "node:test";

import { CanvasSession } from "./canvas-session.js";

type ToolCall = { requestId: string; name: string; input: unknown };

class MockResponse extends EventEmitter {
    readonly writes: string[] = [];
    ended = false;

    writeHead() {
        return this;
    }

    write(chunk: string | Uint8Array) {
        this.writes.push(String(chunk));
        return true;
    }

    end() {
        if (this.ended) return this;
        this.ended = true;
        this.emit("close");
        return this;
    }

    events<T>(type: string): T[] {
        return this.writes.flatMap((chunk) => {
            if (!chunk.startsWith(`event: ${type}\n`)) return [];
            const data = chunk.split("\n").find((line) => line.startsWith("data: "));
            return data ? [JSON.parse(data.slice(6)) as T] : [];
        });
    }
}

function openClient(session: CanvasSession, clientId: string, role?: string) {
    const response = new MockResponse();
    const url = new URL("http://127.0.0.1:17371/events");
    url.searchParams.set("clientId", clientId);
    if (role) url.searchParams.set("role", role);
    session.openEvents(url, response as unknown as ServerResponse);
    return response;
}

function resolveLastCall(session: CanvasSession, response: MockResponse, result: unknown) {
    const call = response.events<ToolCall>("tool_call").at(-1);
    assert.ok(call);
    session.resolveResult({ requestId: call.requestId, result });
    return call;
}

describe("CanvasSession multi-client routing", () => {
    test("keeps each canvas state isolated when another client updates", async () => {
        const session = new CanvasSession();
        const clientA = openClient(session, "canvas-a");
        const clientB = openClient(session, "canvas-b");
        try {
            session.updateState({ projectId: "project-a", nodes: [] }, "canvas-a");
            session.updateState({ projectId: "project-b", nodes: [] }, "canvas-b");

            assert.equal(((await session.callTool("canvas_get_state", {})) as { projectId?: string }).projectId, "project-b");
            clientB.end();
            assert.equal(((await session.callTool("canvas_get_state", {})) as { projectId?: string }).projectId, "project-a");
        } finally {
            clientA.end();
            clientB.end();
        }
    });

    test("writes a canvas tool call only to the active client", async () => {
        const session = new CanvasSession();
        const clientA = openClient(session, "canvas-a");
        const clientB = openClient(session, "canvas-b");
        try {
            session.updateState({ projectId: "project-a" }, "canvas-a");
            session.updateState({ projectId: "project-b" }, "canvas-b");

            const pending = session.callTool("canvas_apply_ops", { ops: [] });
            assert.equal(clientA.events<ToolCall>("tool_call").length, 0);
            const call = resolveLastCall(session, clientB, { applied: true });

            assert.equal(call.name, "canvas_apply_ops");
            assert.deepEqual(await pending, { applied: true });
        } finally {
            clientA.end();
            clientB.end();
        }
    });

    test("promotes the newest remaining state after the active client closes", async () => {
        const session = new CanvasSession();
        const clientA = openClient(session, "canvas-a");
        const clientB = openClient(session, "canvas-b");
        const clientC = openClient(session, "canvas-c");
        try {
            session.updateState({ projectId: "project-a" }, "canvas-a");
            session.updateState({ projectId: "project-b" }, "canvas-b");
            session.updateState({ projectId: "project-c" }, "canvas-c");
            clientC.end();

            const pending = session.callTool("canvas_apply_ops", { ops: [] });
            assert.equal(clientA.events<ToolCall>("tool_call").length, 0);
            assert.equal(clientC.events<ToolCall>("tool_call").length, 0);
            resolveLastCall(session, clientB, "from-b");
            assert.equal(await pending, "from-b");
        } finally {
            clientA.end();
            clientB.end();
            clientC.end();
        }
    });

    test("broadcasts to ordinary listeners but never routes tools to listeners without state", async () => {
        const session = new CanvasSession();
        const listenerA = openClient(session, "codex-dev-a");
        const listenerB = openClient(session, "codex-dev-b");
        const canvas = openClient(session, "canvas-a");
        try {
            session.updateState({ projectId: "project-a" }, "canvas-a");
            session.emitAll("agent_progress", { status: "running" });
            assert.equal(listenerA.events("agent_progress").length, 1);
            assert.equal(listenerB.events("agent_progress").length, 1);

            const pending = session.callTool("canvas_apply_ops", { ops: [] });
            assert.equal(listenerA.events<ToolCall>("tool_call").length, 0);
            assert.equal(listenerB.events<ToolCall>("tool_call").length, 0);
            resolveLastCall(session, canvas, "canvas-result");
            assert.equal(await pending, "canvas-result");

            canvas.end();
            assert.deepEqual(session.health(), { ok: true, hasCanvas: false, clients: 2 });
            await assert.rejects(session.callTool("canvas_apply_ops", { ops: [] }), { message: "当前没有已连接画布" });
            assert.equal(listenerA.events<ToolCall>("tool_call").length, 0);
            assert.equal(listenerB.events<ToolCall>("tool_call").length, 0);
        } finally {
            listenerA.end();
            listenerB.end();
            canvas.end();
        }
    });

    test("keeps the existing canvas error for a single client without state", async () => {
        const session = new CanvasSession();
        const client = openClient(session, "canvas-a");
        try {
            session.updateState({ projectId: "ignored" });
            assert.deepEqual(session.health(), { ok: true, hasCanvas: false, clients: 1 });
            await assert.rejects(session.callTool("canvas_apply_ops", { ops: [] }), { message: "当前没有已连接画布" });
            assert.equal(client.events<ToolCall>("tool_call").length, 0);
        } finally {
            client.end();
        }
    });

    test("keeps the single-client state, dispatch, and result round trip", async () => {
        const session = new CanvasSession();
        const client = openClient(session, "canvas-a");
        try {
            session.updateState({ projectId: "project-a", selectedNodeIds: ["node-a"] }, "canvas-a");
            const pending = session.callTool("canvas_apply_ops", { ops: [{ type: "select_nodes", ids: ["node-a"] }] });
            const call = resolveLastCall(session, client, { selected: ["node-a"] });

            assert.deepEqual(call.input, { ops: [{ type: "select_nodes", ids: ["node-a"] }] });
            assert.deepEqual(await pending, { selected: ["node-a"] });
        } finally {
            client.end();
        }
    });

    test("replaces a duplicate client connection while preserving its state and active role", async () => {
        const session = new CanvasSession();
        const oldResponse = openClient(session, "canvas-a");
        session.updateState({ projectId: "project-a", nodes: [] }, "canvas-a");
        const newResponse = openClient(session, "canvas-a");
        try {
            assert.equal(oldResponse.ended, true);
            assert.deepEqual(session.health(), { ok: true, hasCanvas: true, clients: 1 });
            assert.equal(((await session.callTool("canvas_get_state", {})) as { projectId?: string }).projectId, "project-a");

            const pending = session.callTool("canvas_apply_ops", { ops: [] });
            assert.equal(oldResponse.events<ToolCall>("tool_call").length, 0);
            resolveLastCall(session, newResponse, "new-connection");
            assert.equal(await pending, "new-connection");
        } finally {
            oldResponse.end();
            newResponse.end();
        }
    });

    test("excludes role=status connections from routing, broadcasts, and client count", async () => {
        const session = new CanvasSession();
        const status = openClient(session, "status-a", "status");
        try {
            assert.deepEqual(session.health(), { ok: true, hasCanvas: false, clients: 0 });
            session.emitAll("agent_progress", { status: "running" });
            assert.equal(status.events("agent_progress").length, 0);
            await assert.rejects(session.callTool("canvas_apply_ops", { ops: [] }), { message: "当前没有已连接画布" });
            assert.equal(status.events<ToolCall>("tool_call").length, 0);
        } finally {
            status.end();
        }
    });

    test("uses the webpage error and state-qualified route for site tools", async () => {
        const session = new CanvasSession();
        const listener = openClient(session, "codex-dev-a");
        const canvas = openClient(session, "canvas-a");
        try {
            await assert.rejects(session.callTool("site_navigate", { path: "/canvas" }), { message: "当前没有已连接网页" });
            assert.equal(listener.events<ToolCall>("tool_call").length, 0);
            assert.equal(canvas.events<ToolCall>("tool_call").length, 0);

            session.updateState({ projectId: "project-a" }, "canvas-a");
            const pending = session.callTool("site_navigate", { path: "/canvas" });
            assert.equal(listener.events<ToolCall>("tool_call").length, 0);
            resolveLastCall(session, canvas, { navigated: true });
            assert.deepEqual(await pending, { navigated: true });
        } finally {
            listener.end();
            canvas.end();
        }
    });
});
