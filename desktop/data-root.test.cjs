const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const mainPath = path.join(__dirname, "main.cjs");
const mainSource = fs.readFileSync(mainPath, "utf8");

function loadMain({ fetchResponses = [], credentialEnv = {} } = {}) {
    const paths = {
        documents: path.join("Z:\\", "Redirected Documents"),
        userData: path.join("Q:\\", "Canvas User Data"),
    };
    const calls = { appPaths: [], spawn: [], spawnSync: [] };
    let manifestExists = false;
    let fetchIndex = 0;
    const app = {
        isPackaged: false,
        getPath(name) {
            calls.appPaths.push(name);
            return paths[name];
        },
        on() {},
        quit() {},
        requestSingleInstanceLock() {
            return false;
        },
    };
    const child = {
        once() {},
        stderr: { on() {} },
        stdout: { on() {} },
    };
    const fsMock = {
        ...fs,
        existsSync(candidate) {
            return candidate.endsWith(path.join("manifests", "batch_manifest.json"))
                ? manifestExists
                : false;
        },
    };
    const spawnSync = (...args) => {
        calls.spawnSync.push(args);
        manifestExists = true;
        return { status: 0, stderr: "", stdout: "" };
    };
    const spawn = (...args) => {
        calls.spawn.push(args);
        return child;
    };
    const processMock = {
        argv: [],
        env: { EXISTING_ENV: "preserved" },
        execPath: path.join("C:\\", "Program Files", "Infinite Canvas", "Infinite Canvas.exe"),
        platform: "win32",
        stderr: { write() {} },
        stdout: { write() {} },
    };
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request === "node:child_process") return { spawn, spawnSync };
        if (request === "node:fs") return fsMock;
        if (request === "node:http") return { createServer() { throw new Error("not used in this test"); } };
        if (request === "node:path") return path;
        if (request === "electron") {
            return {
                app,
                BrowserWindow: class {},
                dialog: { showErrorBox() {} },
                Menu: { setApplicationMenu() {} },
                shell: { openExternal() {} },
            };
        }
        if (request === "./credentials.cjs") return { loadRenderCredentialEnv: () => credentialEnv };
        if (request === "./shortcuts.cjs") return { resolveReloadAction: () => null };
        throw new Error(`Unexpected require: ${request}`);
    };
    const source = `${mainSource}\nmodule.exports = { resolveDataRoot, ensureDemoWorkspace, ensureWorkbench };`;
    const wrapper = vm.runInNewContext(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, {
        AbortSignal,
        URL,
        console: { error() {}, log() {}, warn() {} },
        fetch: async () => fetchResponses[fetchIndex++] || { status: 500, async json() { return {}; } },
        process: processMock,
        setTimeout,
    });
    wrapper(module.exports, localRequire, module, mainPath, __dirname);
    return { calls, exports: module.exports, paths, processMock };
}

test("resolveDataRoot uses Electron Documents and appends the brand folder", () => {
    const harness = loadMain();
    harness.paths.documents = path.join("R:\\", "Redirected", "文档库");

    assert.equal(
        harness.exports.resolveDataRoot(),
        path.join(harness.paths.documents, "无限画布工作流"),
    );
    assert.deepEqual(harness.calls.appPaths, ["documents"]);
});

test("ensureDemoWorkspace injects the absolute data root and preserves the existing environment", () => {
    const harness = loadMain();
    const pythonExe = path.join("C:\\", "portable-python", "python.exe");
    const workflowRoot = path.join("D:\\", "portable", "workflow-runtime");

    harness.exports.ensureDemoWorkspace(pythonExe, workflowRoot);

    assert.equal(harness.calls.spawnSync.length, 1);
    const options = harness.calls.spawnSync[0][2];
    assert.equal(options.cwd, workflowRoot);
    assert.equal(options.env.EXISTING_ENV, "preserved");
    assert.equal(options.env.INFINITE_CANVAS_DATA_ROOT, path.join(harness.paths.documents, "无限画布工作流"));
    assert.equal(path.isAbsolute(options.env.INFINITE_CANVAS_DATA_ROOT), true);
    assert.equal(options.env.PYTHONIOENCODING, "utf-8");
    assert.equal(options.env.PYTHONUTF8, "1");
});

test("ensureWorkbench injects the data root while preserving credentials and UTF-8 settings", async () => {
    const credentialEnv = {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://example.test/v1",
        RENDER_ALLOW_REAL_EXECUTION: "1",
    };
    const harness = loadMain({
        credentialEnv,
        fetchResponses: [
            { status: 500, async json() { return {}; } },
            { status: 503, async json() { return { workers: {} }; } },
        ],
    });
    const workflowRoot = path.join("D:\\", "portable", "workflow-runtime");

    await harness.exports.ensureWorkbench(
        path.join("C:\\", "portable-python", "python.exe"),
        workflowRoot,
        path.join(harness.paths.userData, "workbench-demo", "manifests", "batch_manifest.json"),
    );

    assert.equal(harness.calls.spawn.length, 1);
    const options = harness.calls.spawn[0][2];
    assert.equal(options.cwd, workflowRoot);
    assert.equal(options.env.EXISTING_ENV, "preserved");
    assert.equal(options.env.CODEX_DEV_ALLOW_REAL_EXECUTION, "1");
    assert.equal(options.env.INFINITE_CANVAS_DATA_ROOT, path.join(harness.paths.documents, "无限画布工作流"));
    assert.equal(path.isAbsolute(options.env.INFINITE_CANVAS_DATA_ROOT), true);
    assert.equal(options.env.PYTHONIOENCODING, "utf-8");
    assert.equal(options.env.PYTHONUTF8, "1");
    for (const [name, value] of Object.entries(credentialEnv)) {
        assert.equal(options.env[name], value);
    }
});

test("desktop startup no longer creates a program-side batch workspace", () => {
    assert.doesNotMatch(mainSource, /\bensureBatchWorkspace\b/);
    assert.doesNotMatch(mainSource, /path\.join\(path\.dirname\(workflowRoot\),\s*["']杯类["']\)/);
});
