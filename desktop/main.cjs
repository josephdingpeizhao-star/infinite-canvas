const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, dialog, Menu, powerSaveBlocker, shell } = require("electron");
const { loadRenderCredentialEnv } = require("./credentials.cjs");
const { resolveReloadAction } = require("./shortcuts.cjs");

const WEB_HOST = "127.0.0.1";
const WEB_PORT = 3000;
const AGENT_PORT = 17371;
const WORKBENCH_UPLOAD_PORT = 17372;
const WORKBENCH_PORT = 17373;
const APP_ORIGIN = `http://${WEB_HOST}:${WEB_PORT}`;
const APP_URL = `${APP_ORIGIN}/canvas`;
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}`;
const WORKBENCH_URL = `http://127.0.0.1:${WORKBENCH_PORT}`;
const PYTHON_SCRIPT_BOOTSTRAP = [
    "import runpy,sys",
    "script=sys.argv[1]",
    "sys.path.insert(0,sys.argv[2])",
    "sys.argv=[script,*sys.argv[3:]]",
    "runpy.run_path(script,run_name='__main__')",
].join(";");
const SMOKE_TEST = process.argv.includes("--smoke-test");

let mainWindow = null;
let staticServer = null;
let ownedAgent = null;
let ownedWorkbench = null;
let quitting = false;
let backgroundPolicy = null;
let workbenchOutputLogging = null;

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    const { appendBackgroundSwitches, createPowerManagement } = require("./background-policy.cjs");
    backgroundPolicy = createPowerManagement(powerSaveBlocker, (message) => console.warn(message));
    appendBackgroundSwitches(app.commandLine);

    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(startDesktop).catch(showStartupFailure);
}

async function startDesktop() {
    backgroundPolicy?.start();
    app.setAppUserModelId("com.basketikun.infinitecanvas");
    workbenchOutputLogging = initializeWorkbenchOutputLogging();
    Menu.setApplicationMenu(null);

    const webRoot = path.join(__dirname, "runtime", "web");
    const agentEntry = path.join(__dirname, "runtime", "canvas-agent", "dist", "index.js");
    const workflowRoot = resolveWorkflowRoot();
    const pythonExe = workflowRoot ? resolvePythonExecutable() : null;
    assertFile(path.join(webRoot, "index.html"), "桌面画布资源不完整");
    assertFile(agentEntry, "桌面 Canvas Agent 资源不完整");
    if (workflowRoot && pythonExe) {
        assertWorkflowRuntime(workflowRoot, pythonExe);
    }

    staticServer = await startStaticServer(webRoot);
    await ensureAgent(agentEntry);
    if (workflowRoot && pythonExe) {
        const demoManifest = ensureDemoWorkspace(pythonExe, workflowRoot);
        await ensureWorkbench(pythonExe, workflowRoot, demoManifest);
    } else {
        console.warn("Full workbench runtime is not present; starting the legacy desktop shell without batch services");
    }
    mainWindow = await createWindow();

    console.log(`Infinite Canvas desktop ready: ${APP_URL}`);
    if (SMOKE_TEST) {
        await verifyDesktopConnection(mainWindow);
        console.log("Desktop smoke test passed: page, Canvas Agent, workbench and 3-category catalog are ready");
        setTimeout(() => app.quit(), 500);
    }
}

function resolveWorkflowRoot() {
    if (app.isPackaged) {
        const portableRoot = path.join(path.dirname(process.execPath), "workflow-runtime");
        return fs.existsSync(path.join(portableRoot, "canvas-bridge", "spike_canvas_push.py")) ? portableRoot : null;
    }

    const workspaceRoot = path.resolve(__dirname, "..", "..");
    const candidates = fs.readdirSync(workspaceRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(workspaceRoot, entry.name));
    const match = candidates.find((candidate) =>
        fs.existsSync(path.join(candidate, "categories", "_shared", "category-recipe.schema.json")) &&
        fs.existsSync(path.join(candidate, "canvas-bridge", "spike_canvas_push.py")),
    );
    if (!match) throw new Error("未找到品类规则和本机工作台运行文件");
    return match;
}

function resolveDataRoot() {
    return path.join(app.getPath("documents"), "无限画布工作流");
}

function initializeWorkbenchOutputLogging() {
    try {
        const { createProcessOutputLog, forwardProcessOutput } = require("./process-output-log.cjs");
        return {
            forwardProcessOutput,
            logger: createProcessOutputLog({
                directory: path.join(resolveDataRoot(), "workflow-runtime", "logs"),
            }),
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Workbench process output logging unavailable; continuing without file logs: ${detail}`);
        return null;
    }
}

function forwardWorkbenchOutput(stream, chunk, destination) {
    if (workbenchOutputLogging === null) {
        destination.write(`[canvas-workbench] ${chunk}`);
        return;
    }
    workbenchOutputLogging.forwardProcessOutput({
        destination,
        logger: workbenchOutputLogging.logger,
        stream,
        chunk,
        prefix: "[canvas-workbench] ",
    });
}

function resolvePythonExecutable() {
    const root = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, "vendor");
    return path.join(root, "python-runtime", "python.exe");
}

function resolveRenderCredentialPath() {
    const root = app.isPackaged ? path.dirname(process.execPath) : __dirname;
    return path.join(root, "render-credentials.json");
}

function assertWorkflowRuntime(workflowRoot, pythonExe) {
    assertFile(pythonExe, "独立 Python 运行环境不完整");
    assertFile(path.join(workflowRoot, "canvas-bridge", "spike_canvas_push.py"), "本机工作台服务不完整");
    assertFile(path.join(workflowRoot, "categories", "_shared", "category-recipe.schema.json"), "品类规则不完整");
    assertFile(path.join(workflowRoot, "manifests", "batch_manifest.template.json"), "批次模板不完整");
    assertFile(path.join(workflowRoot, "scripts", "build_batch_manifest.py"), "批次创建工具不完整");
}

function pythonScriptArgs(script, moduleRoot, args = []) {
    return ["-c", PYTHON_SCRIPT_BOOTSTRAP, script, moduleRoot, ...args];
}

function ensureDemoWorkspace(pythonExe, workflowRoot) {
    const workspaceRoot = path.join(app.getPath("userData"), "workbench-demo");
    const manifestPath = path.join(workspaceRoot, "manifests", "batch_manifest.json");
    if (fs.existsSync(manifestPath)) return manifestPath;

    const script = path.join(workflowRoot, "canvas-bridge", "make_demo_workspace.py");
    const result = spawnSync(
        pythonExe,
        pythonScriptArgs(script, path.dirname(script), ["--root", workspaceRoot, "--init"]),
        {
            cwd: workflowRoot,
            encoding: "utf8",
            env: {
                ...process.env,
                INFINITE_CANVAS_DATA_ROOT: resolveDataRoot(),
                PYTHONIOENCODING: "utf-8",
                PYTHONUTF8: "1",
            },
            timeout: 15000,
            windowsHide: true,
        },
    );
    if (result.error || result.status !== 0 || !fs.existsSync(manifestPath)) {
        const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
        throw new Error(`工作台初始化失败：${detail.slice(-1000)}`);
    }
    return manifestPath;
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1500,
        height: 950,
        minWidth: 1100,
        minHeight: 700,
        show: false,
        backgroundColor: "#f7f7f5",
        title: "Infinite Canvas",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
        },
    });

    window.webContents.on("before-input-event", (event, input) => {
        const action = resolveReloadAction(input);
        if (!action) return;

        event.preventDefault();
        if (action === "force-reload") {
            window.webContents.reloadIgnoringCache();
            return;
        }
        window.webContents.reload();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternalUrl(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (isAppUrl(url)) return;
        event.preventDefault();
        if (isExternalUrl(url)) void shell.openExternal(url);
    });

    return new Promise((resolve, reject) => {
        const fail = (_event, code, description, url, isMainFrame) => {
            if (!isMainFrame) return;
            reject(new Error(`画布页面加载失败 (${code}): ${description} ${url}`));
        };
        window.webContents.once("did-fail-load", fail);
        window.webContents.once("did-finish-load", () => {
            window.webContents.removeListener("did-fail-load", fail);
            window.show();
            resolve(window);
        });
        void window.loadURL(APP_URL);
    });
}

async function ensureAgent(agentEntry) {
    if (await isAgentHealthy()) return;

    ownedAgent = spawn(process.execPath, [agentEntry], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(AGENT_PORT) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    ownedAgent.stdout?.on("data", (chunk) => process.stdout.write(`[canvas-agent] ${chunk}`));
    ownedAgent.stderr?.on("data", (chunk) => process.stderr.write(`[canvas-agent] ${chunk}`));
    ownedAgent.once("exit", (code) => {
        if (!quitting && code !== 0) console.error(`Canvas Agent exited before the desktop app: ${code ?? 0}`);
        ownedAgent = null;
    });

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (await isAgentHealthy()) return;
        await delay(200);
    }
    throw new Error("内置 Canvas Agent 启动超时，请确认本机 17371 端口未被其他程序占用");
}

async function isAgentHealthy() {
    try {
        const response = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(800) });
        return response.ok;
    } catch {
        return false;
    }
}

async function ensureWorkbench(pythonExe, workflowRoot, demoManifest) {
    const credentialPath = resolveRenderCredentialPath();
    const credentialEnv = loadRenderCredentialEnv(credentialPath);
    if (fs.existsSync(credentialPath) && Object.keys(credentialEnv).length === 0) {
        console.warn(`Render credentials file is invalid: ${credentialPath}`);
    }
    const workbenchEnv = {
        ...credentialEnv,
        ...process.env,
        CODEX_DEV_ALLOW_REAL_EXECUTION: "1",
        INFINITE_CANVAS_DATA_ROOT: resolveDataRoot(),
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
    };
    if (SMOKE_TEST) {
        const renderGateVariable = "RENDER_ALLOW_REAL_EXECUTION";
        const renderGateOpen = workbenchEnv[renderGateVariable] === "1"
            && typeof workbenchEnv.OPENAI_API_KEY === "string" && Boolean(workbenchEnv.OPENAI_API_KEY.trim())
            && typeof workbenchEnv.OPENAI_BASE_URL === "string" && Boolean(workbenchEnv.OPENAI_BASE_URL.trim());
        console.log(`render gate: ${renderGateOpen ? "open" : "closed"}`);
    }
    if (await isWorkbenchReachable()) return;

    const bridgeRoot = path.join(workflowRoot, "canvas-bridge");
    const entry = path.join(bridgeRoot, "spike_canvas_push.py");
    ownedWorkbench = spawn(
        pythonExe,
        pythonScriptArgs(entry, bridgeRoot, ["--serve-canvas-workbench", demoManifest, "--interval", "2"]),
        {
            cwd: workflowRoot,
            env: workbenchEnv,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        },
    );
    ownedWorkbench.stdout?.on("data", (chunk) => forwardWorkbenchOutput("stdout", chunk, process.stdout));
    ownedWorkbench.stderr?.on("data", (chunk) => forwardWorkbenchOutput("stderr", chunk, process.stderr));
    ownedWorkbench.once("exit", (code) => {
        if (!quitting && code !== 0) console.error(`Canvas workbench exited before the desktop app: ${code ?? 0}`);
        ownedWorkbench = null;
    });

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (await isWorkbenchReachable()) return;
        await delay(250);
    }
    throw new Error(`内置工作台启动超时，请确认本机 ${WORKBENCH_UPLOAD_PORT}、${WORKBENCH_PORT} 端口未被其他程序占用`);
}

async function isWorkbenchHealthy() {
    try {
        const response = await fetch(`${WORKBENCH_URL}/workbench-health`, { signal: AbortSignal.timeout(1000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function isWorkbenchReachable() {
    try {
        const response = await fetch(`${WORKBENCH_URL}/workbench-health`, { signal: AbortSignal.timeout(1000) });
        const payload = await response.json();
        return [200, 503].includes(response.status) && payload?.workers && typeof payload.workers === "object";
    } catch {
        return false;
    }
}

async function waitForWorkbenchHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isWorkbenchHealthy()) return true;
        await delay(250);
    }
    return false;
}

async function verifyDesktopConnection(window) {
    if (!(await isAgentHealthy())) throw new Error("Canvas Agent 健康检查失败");
    const connection = await window.webContents.executeJavaScript(`({
        url: window.localStorage.getItem("canvas-agent-url"),
        hasToken: Boolean(window.localStorage.getItem("canvas-agent-token"))
    })`);
    if (connection?.url !== AGENT_URL || connection?.hasToken !== true) {
        throw new Error("画布未收到内置 Canvas Agent 的连接信息");
    }
    const catalog = await window.webContents.executeJavaScript(`(async () => {
        const token = window.localStorage.getItem("canvas-agent-token") || "";
        const response = await fetch("${WORKBENCH_URL}/batch-categories", {
            headers: { "X-Canvas-Agent-Token": token }
        });
        const payload = await response.json();
        return {
            ok: response.ok && payload?.ok === true,
            count: Array.isArray(payload?.categories) ? payload.categories.length : 0
        };
    })()`);
    if (catalog?.ok !== true || catalog?.count !== 3) {
        throw new Error(`品类目录检查失败：期望 3 类，实际 ${catalog?.count ?? 0} 类`);
    }
    if (!(await waitForWorkbenchHealthy(20000))) {
        throw new Error("工作台已启动，但画布在 20 秒内未完成连接");
    }
}

function startStaticServer(root) {
    const resolvedRoot = path.resolve(root);
    const server = http.createServer(async (request, response) => {
        if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
            response.writeHead(405).end();
            return;
        }

        try {
            const url = new URL(request.url, APP_ORIGIN);
            const requested = decodeURIComponent(url.pathname);
            const candidate = safePath(resolvedRoot, requested);
            const file = await existingFile(candidate) || path.join(resolvedRoot, "index.html");
            const body = request.method === "HEAD" ? undefined : await fs.promises.readFile(file);
            const headers = {
                "Content-Type": contentType(file),
                "Cache-Control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            };
            response.writeHead(200, headers);
            response.end(body);
        } catch (error) {
            const status = error?.code === "FORBIDDEN_PATH" ? 403 : 500;
            response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(status === 403 ? "Forbidden" : "Infinite Canvas failed to load");
        }
    });

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(WEB_PORT, WEB_HOST, () => {
            server.removeListener("error", reject);
            resolve(server);
        });
    });
}

function safePath(root, pathname) {
    const candidate = path.resolve(root, `.${pathname}`);
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) return candidate;
    const error = new Error("Path is outside the web root");
    error.code = "FORBIDDEN_PATH";
    throw error;
}

async function existingFile(candidate) {
    try {
        const info = await fs.promises.stat(candidate);
        if (info.isFile()) return candidate;
        if (info.isDirectory()) {
            const indexFile = path.join(candidate, "index.html");
            if ((await fs.promises.stat(indexFile)).isFile()) return indexFile;
        }
    } catch {
        return null;
    }
    return null;
}

function contentType(file) {
    return {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".ico": "image/x-icon",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function assertFile(file, message) {
    if (!fs.existsSync(file)) throw new Error(`${message}: ${file}`);
}

function isExternalUrl(url) {
    return /^https?:\/\//i.test(url) && !isAppUrl(url);
}

function isAppUrl(url) {
    try {
        return new URL(url).origin === APP_ORIGIN;
    } catch {
        return false;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function showStartupFailure(error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail);
    if (SMOKE_TEST) {
        process.exitCode = 1;
        app.quit();
        return;
    }
    dialog.showErrorBox("Infinite Canvas 启动失败", detail);
    app.quit();
}

function stopOwnedProcess(child) {
    if (!child?.pid) return;
    const pid = child.pid;
    if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } else {
        try {
            process.kill(pid, "SIGTERM");
        } catch {
            // The child has already exited.
        }
    }
}

app.on("before-quit", () => {
    quitting = true;
    backgroundPolicy?.stop();
    staticServer?.close();
    staticServer = null;
    const workbench = ownedWorkbench;
    const agent = ownedAgent;
    ownedWorkbench = null;
    ownedAgent = null;
    stopOwnedProcess(workbench);
    stopOwnedProcess(agent);
});

app.on("window-all-closed", () => app.quit());
