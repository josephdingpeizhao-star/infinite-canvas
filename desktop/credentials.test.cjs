const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { loadRenderCredentialEnv } = require("./credentials.cjs");

function withCredentialFile(contents, callback) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "infinite-canvas-credentials-"));
    const filePath = path.join(tempRoot, "render-credentials.json");
    try {
        if (contents !== undefined) fs.writeFileSync(filePath, contents, "utf8");
        callback(filePath);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

test("valid credentials return the three render environment variables", () => {
    withCredentialFile(JSON.stringify({ api_key: " sk-test-000 ", base_url: " https://example.test/v1 " }), (filePath) => {
        assert.deepEqual(loadRenderCredentialEnv(filePath), {
            RENDER_ALLOW_REAL_EXECUTION: "1",
            OPENAI_API_KEY: "sk-test-000",
            OPENAI_BASE_URL: "https://example.test/v1",
        });
    });
});

test("a missing credential file fails closed", () => {
    withCredentialFile(undefined, (filePath) => assert.deepEqual(loadRenderCredentialEnv(filePath), {}));
});

test("malformed JSON fails closed", () => {
    withCredentialFile("{not-json", (filePath) => assert.deepEqual(loadRenderCredentialEnv(filePath), {}));
});

test("missing or empty required fields fail closed", () => {
    for (const credentials of [
        { base_url: "https://example.test/v1" },
        { api_key: "sk-test-000" },
        { api_key: " ", base_url: "https://example.test/v1" },
        { api_key: "sk-test-000", base_url: " " },
    ]) {
        withCredentialFile(JSON.stringify(credentials), (filePath) => assert.deepEqual(loadRenderCredentialEnv(filePath), {}));
    }
});

test("a non-http base URL fails closed", () => {
    withCredentialFile(JSON.stringify({ api_key: "sk-test-000", base_url: "file:///local/v1" }), (filePath) => {
        assert.deepEqual(loadRenderCredentialEnv(filePath), {});
    });
});

test("unrecognized credential fields are not returned", () => {
    withCredentialFile(JSON.stringify({ api_key: "sk-test-000", base_url: "http://127.0.0.1:9999/v1", extra: "ignored" }), (filePath) => {
        assert.deepEqual(Object.keys(loadRenderCredentialEnv(filePath)).sort(), ["OPENAI_API_KEY", "OPENAI_BASE_URL", "RENDER_ALLOW_REAL_EXECUTION"]);
    });
});
