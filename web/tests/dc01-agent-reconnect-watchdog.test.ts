import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { AGENT_SSE_DEAD_AFTER_MS, isAgentSseDead } from "../src/lib/canvas/agent-connection";
import {
    expireProductionState,
    isProductionStartBlocked,
    WORKFLOW_PRODUCTION_CONNECTION_INTERRUPTED_MESSAGE,
} from "../src/lib/canvas/canvas-workflow-production";
import type { CanvasWorkflowProductionMetadata } from "../src/types/canvas";

describe("DC-01 canvas agent dead-link detection", () => {
    test("uses the fixed three-heartbeat deadline with an exclusive boundary", () => {
        expect(AGENT_SSE_DEAD_AFTER_MS).toBe(45_000);
        expect(isAgentSseDead(1_000, 45_999)).toBe(false);
        expect(isAgentSseDead(1_000, 46_000)).toBe(false);
        expect(isAgentSseDead(1_000, 46_001)).toBe(true);
    });

    test("wires ping and every accepted SSE event into the existing reconnect path", () => {
        const source = readFileSync(new URL("../src/components/canvas/canvas-local-agent-panel.tsx", import.meta.url), "utf8");
        expect(source).toContain('nextSource.addEventListener("ping", () => {');
        expect(source.match(/recordEvent\(\);/g)).toHaveLength(7);
        expect(source).toContain("if (!isCurrentSource() || !isAgentSseDead(lastEventAt, Date.now())) return;");
        expect(source).toContain("nextSource.onerror = reconnectAfterLoss;");
        expect(source).toContain("reconnectAfterLoss();");
    });
});

describe("DC-01 production watchdog truthfulness", () => {
    const running: CanvasWorkflowProductionMetadata = {
        status: "running",
        producedCount: 2,
        updatedAt: 1_000,
        message: "正在制作",
    };

    test("keeps an expired running card locked while the page is disconnected", () => {
        const result = expireProductionState(running, 1_321_000, false);

        expect(result).toEqual({
            ...running,
            updatedAt: 1_321_000,
            message: WORKFLOW_PRODUCTION_CONNECTION_INTERRUPTED_MESSAGE,
        });
        expect(result.message).toBe("与本机工作台的连接已中断，正在自动重连；制作可能仍在后台进行，成果都会保留。");
        expect(isProductionStartBlocked(result)).toBe(true);
    });

    test("keeps the existing service-failure result when connected or when connection state is omitted", () => {
        const expected = {
            ...running,
            status: "failed",
            updatedAt: 1_321_000,
            errorMessage: "本机真实制作服务已中断，已经完成的成果都保留了。",
        };

        expect(expireProductionState(running, 1_321_000, true)).toEqual(expected);
        expect(expireProductionState(running, 1_321_000)).toEqual(expected);
    });

    test("does not change the eight-second acknowledgement timeout when disconnected", () => {
        const queued: CanvasWorkflowProductionMetadata = {
            status: "queued",
            producedCount: 0,
            requestedAt: 1_000,
        };

        expect(expireProductionState(queued, 9_000, false)).toEqual({
            ...queued,
            status: "failed",
            updatedAt: 9_000,
            errorMessage: "本机工作台没有及时接单，本次没有开始。",
        });
    });

    test("reads connection state without subscribing or rebuilding the watchdog interval", () => {
        const source = readFileSync(new URL("../src/pages/canvas/use-canvas-workflow-production.ts", import.meta.url), "utf8");
        expect(source).toContain("expireProductionState(state, now, useAgentStore.getState().connected);");
        expect(source).toContain("}, 1_000);");
        expect(source).toContain("}, [setNodes]);");
    });
});
