import { describe, expect, test } from "bun:test";

import { ACCEPTANCE_ENTRY_ENABLED } from "../src/lib/canvas/canvas-workflow-receiving";

describe("AC-01 dormant acceptance entry", () => {
    test("keeps the receiving-box entry dormant by default", () => {
        expect(ACCEPTANCE_ENTRY_ENABLED).toBe(false);
    });
});
