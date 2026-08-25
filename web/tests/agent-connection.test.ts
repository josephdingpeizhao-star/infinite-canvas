import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { nextRetryDelayMs, shouldKeepRetrying } from "../src/lib/canvas/agent-connection";

describe("canvas agent connection retry policy", () => {
    test("uses the exact exponential delay sequence and caps at fifteen seconds", () => {
        expect([0, 1, 2, 3, 4, 5, 20].map(nextRetryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
    });

    test("keeps retrying forever after this page session has connected once", () => {
        expect([0, 3, 100].every((attempt) => shouldKeepRetrying({ everConnected: true, attempt }))).toBe(true);
    });

    test("stops a cold connection after three retries and permits a reset attempt", () => {
        expect([0, 1, 2].map((attempt) => shouldKeepRetrying({ everConnected: false, attempt }))).toEqual([true, true, true]);
        expect(shouldKeepRetrying({ everConnected: false, attempt: 3 })).toBe(false);
        expect(shouldKeepRetrying({ everConnected: false, attempt: 0 })).toBe(true);
    });

    test("guards late events after disconnect while preserving page-session connection history", () => {
        const source = readFileSync(new URL("../src/components/canvas/canvas-agent-connection-host.tsx", import.meta.url), "utf8");
        expect(source).toContain("const canHandleEvents = () => isCurrentSource() && useAgentStore.getState().enabled;");
        expect(source.match(/if \(!canHandleEvents\(\)\) return;/g)).toHaveLength(6);
        expect(source).toMatch(/if \(!isCurrentSource\(\)\) return;\r?\n\s+if \(!useAgentStore\.getState\(\)\.enabled\) \{/);
        expect(source).toContain("everConnectedRef.current = true;");
        expect(source).toContain("const everConnected = everConnectedRef.current;");
    });
});
