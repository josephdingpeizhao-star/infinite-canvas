import express, { type NextFunction, type Request, type Response } from "express";

import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, codexReasoningEffort, interruptCodexTurn, listCodexThreads, readCodexThread, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import { runLoginStatus, startLogin } from "./codex-auth.js";
import { isolatedCodexContinueRoute, isolatedCodexTurnRoute } from "./codex-isolated.js";
import type { AgentAttachment } from "./types.js";

export function startupBannerLines(config: Pick<CanvasAgentConfig, "url" | "token">, interactive: boolean) {
    const lines = [
        "Infinite Canvas Agent",
        `Local URL: ${config.url}`,
        "Codex MCP is not installed by this command.",
        "Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp",
        "Remove manually added MCP: codex mcp remove infinite-canvas",
    ];
    if (interactive) lines.splice(2, 0, `Connect token: ${config.token}`);
    return lines;
}

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => session.emitAll(type, payload);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => session.openEvents(requestUrl(req, config), res));
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        session.resolveResult(req.body);
        res.json({ ok: true });
    });
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/agent/codex/auth", route(async (_req, res) => res.json({ ok: true, ...(await runLoginStatus()) })));
    app.post("/agent/codex/login", (_req, res) => res.json(startLogin(emit)));
    app.get("/agent/codex/workspace", (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (req, res) => {
        const requestedModel = typeof req.body?.model === "string" ? req.body.model.trim() : "";
        let requestedEffort;
        try {
            requestedEffort = codexReasoningEffort(req.body?.effort);
        } catch {
            res.status(400).json({ ok: false, error: "invalid Codex reasoning effort" });
            return;
        }
        const workspace = ensureSiteWorkspace(config);
        const thread = await startCodexThread(emit, workspace.workspacePath, requestedModel || undefined, requestedEffort);
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        updateSiteWorkspace(config, { activeThreadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId }, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
        updateSiteWorkspace(config, { activeThreadId: threadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId: threadId }, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        if (workspace.activeThreadId === threadId) updateSiteWorkspace(config, { activeThreadId: undefined });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/isolated/turn", route(async (req, res) => {
        const result = await isolatedCodexTurnRoute(req.body, ensureSiteWorkspace(config).workspacePath, emit);
        res.status(result.status).json(result.body);
    }));
    app.post("/agent/codex/isolated/continue", route(async (req, res) => {
        const result = await isolatedCodexContinueRoute(req.body, ensureSiteWorkspace(config).workspacePath, emit);
        res.status(result.status).json(result.body);
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const requestedModel = typeof req.body?.model === "string" ? req.body.model.trim() : "";
        let requestedEffort;
        try {
            requestedEffort = codexReasoningEffort(req.body?.effort);
        } catch {
            res.status(400).json({ ok: false, error: "invalid Codex reasoning effort" });
            return;
        }
        const workspace = ensureSiteWorkspace(config);
        let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
        if (!threadId) {
            const thread = await startCodexThread(emit, workspace.workspacePath, requestedModel || undefined, requestedEffort);
            threadId = String((thread as Record<string, unknown>).id || "");
            updateSiteWorkspace(config, { activeThreadId: threadId });
        } else if (threadId !== workspace.activeThreadId) {
            await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
            updateSiteWorkspace(config, { activeThreadId: threadId });
        }
        void runCodexTurn(withAgentPrompt(String(req.body?.prompt || "")), emit, attachments, { threadId, cwd: workspace.workspacePath, model: requestedModel || undefined, effort: requestedEffort });
        res.json({ ok: true, threadId });
    }));
    app.post("/agent/codex/interrupt", (_req, res) => {
        const ok = interruptCodexTurn();
        res.json({ ok });
    });
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ ok: false, error: error.message }));

    app.listen(port, "127.0.0.1", () => {
        for (const line of startupBannerLines(config, Boolean(process.stdout.isTTY))) console.log(line);
    });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}
