import { describe, expect, test } from "bun:test";

import { REPAIR_PROJECTION_ENTRY_ENABLED } from "../src/lib/canvas/canvas-workflow-delivery";

describe("EX-01 dormant repair-projection entry", () => {
    test("keeps the repair-projection entry dormant by default", () => {
        expect(REPAIR_PROJECTION_ENTRY_ENABLED).toBe(false);
    });
});
