import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { startupBannerLines } from "./http-server.js";

const config = {
    url: "http://127.0.0.1:17371",
    token: "test-connect-token",
};

const sharedBannerLines = [
    "Infinite Canvas Agent",
    `Local URL: ${config.url}`,
    "Codex MCP is not installed by this command.",
    "Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp",
    "Remove manually added MCP: codex mcp remove infinite-canvas",
];

describe("canvas-agent startup banner", () => {
    test("redirected output never contains the connect token", () => {
        const lines = startupBannerLines(config, false);

        assert.deepEqual(lines, sharedBannerLines);
        assert.equal(lines.join("\n").includes(config.token), false);
    });

    test("interactive output includes the connect token and keeps every shared line", () => {
        const lines = startupBannerLines(config, true);

        assert.deepEqual(lines, [
            ...sharedBannerLines.slice(0, 2),
            `Connect token: ${config.token}`,
            ...sharedBannerLines.slice(2),
        ]);
        for (const line of sharedBannerLines) assert.equal(lines.includes(line), true);
    });
});
