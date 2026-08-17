export const CODEX_AUTH_POLL_INTERVAL_MS = 3_000;
export const CODEX_AUTH_POLL_LIMIT = 100;

export type CodexAuthState = { loggedIn: boolean; summary: string };
export type CodexAuthPhase = "idle" | "checking" | "ready" | "waiting" | "timed-out";

export function normalizeCodexAuthResponse(value: unknown): CodexAuthState {
    if (!value || typeof value !== "object") return { loggedIn: false, summary: "" };
    const response = value as Record<string, unknown>;
    return {
        loggedIn: response.loggedIn === true,
        summary: typeof response.summary === "string" ? response.summary.trim() : "",
    };
}

export function shouldContinuePolling({ attempts, loggedIn }: { attempts: number; loggedIn: boolean }) {
    return !loggedIn && attempts < CODEX_AUTH_POLL_LIMIT;
}

export function codexAuthStatusText({ connected, phase, auth }: { connected: boolean; phase: CodexAuthPhase; auth: CodexAuthState }) {
    if (!connected) return "先连接本机 Agent";
    if (phase === "checking") return "检测中";
    if (phase === "waiting") return "等待浏览器授权…";
    if (phase === "timed-out") return "未登录，可再试一次";
    if (auth.loggedIn) return auth.summary ? `已登录（${auth.summary}）` : "已登录";
    return "未登录";
}
