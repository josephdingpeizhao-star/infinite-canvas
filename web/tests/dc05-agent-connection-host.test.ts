import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
const hostPath = resolve(srcRoot, "components/canvas/canvas-agent-connection-host.tsx");
const panelPath = resolve(srcRoot, "components/canvas/canvas-local-agent-panel.tsx");
const layoutPath = resolve(srcRoot, "layouts/user-layout.tsx");
const topNavPath = resolve(srcRoot, "components/layout/app-top-nav.tsx");

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

function countUnconditionalHostMounts(source: string): number {
    const uncommented = source
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    return uncommented
        .split(/\r?\n/)
        .filter((line) => /^<CanvasAgentConnectionHost\s*\/>$/.test(line.trim()))
        .length;
}

describe("DC-05 application-level canvas Agent session", () => {
    test("owns the only EventSource construction in the connection host", () => {
        const owners = sourceFiles(srcRoot)
            .map((path) => ({ path: relative(srcRoot, path).replaceAll("\\", "/"), count: readFileSync(path, "utf8").match(/new EventSource\s*\(/g)?.length || 0 }))
            .filter(({ count }) => count > 0);

        expect(owners).toEqual([{ path: "components/canvas/canvas-agent-connection-host.tsx", count: 1 }]);
    });

    test("mounts the headless host exactly once beside the panel in UserLayout", () => {
        const layout = readFileSync(layoutPath, "utf8");
        const allSources = sourceFiles(srcRoot).map((path) => readFileSync(path, "utf8")).join("\n");

        expect(layout).toContain('import { CanvasAgentConnectionHost } from "@/components/canvas/canvas-agent-connection-host";');
        expect(countUnconditionalHostMounts(layout)).toBe(1);
        expect(countUnconditionalHostMounts(allSources)).toBe(1);
        expect(layout.indexOf("<CanvasAgentConnectionHost />")).toBeLessThan(layout.indexOf("<AgentPanel />"));
        expect(readFileSync(hostPath, "utf8")).toContain("return null;");
    });

    test("keeps the panel free of connection lifecycle ownership and retired props", () => {
        const panel = readFileSync(panelPath, "utf8");

        for (const forbidden of ["new EventSource", "deadCheckTimer", "reconnectAfterLoss", "visibilitychange", "useSearchParams", "urlAgentAutoConnect", "headless", "autoConnect"]) {
            expect(panel).not.toContain(forbidden);
        }
        expect(panel).toContain("toggleAgentConnection");
        expect(panel).toContain("approvePendingTool");
        expect(panel).toContain("rejectPendingTool");
        expect(panel).toContain("undoLastAgentTool");
    });

    test("preserves URL-injected connection and token auto-connect paths", () => {
        const host = readFileSync(hostPath, "utf8");
        const topNav = readFileSync(topNavPath, "utf8");

        expect(host).toContain('searchParams.has("agentUrl") && searchParams.has("agentToken")');
        expect(host).toContain('searchParams.get("agentUrl") || ""');
        expect(host).toContain('searchParams.get("agentToken") || ""');
        expect(host).toContain("if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });");
        expect(host).toContain("if (urlAgentAutoConnect) {");
        expect(host).toContain("void toggleAgentConnection();");
        expect(topNav).not.toContain("autoConnectRef");
        expect(topNav).not.toContain("connectAgent()");
    });

    test("suppresses auto reconnect after explicit disable while allowing store-driven re-enable", () => {
        const host = readFileSync(hostPath, "utf8");
        const store = readFileSync(resolve(srcRoot, "stores/use-agent-store.ts"), "utf8");

        expect(host).toContain("if (disposed || !useAgentStore.getState().enabled) return;");
        expect(host).toContain("if (wasEnabledRef.current && !enabled) autoConnectRef.current = true;");
        expect(host).toContain("if (autoConnectRef.current || enabled || connected) return;");
        expect(store).toContain('set({ enabled: false, connected: false, activity: "离线", ...patch });');
        expect(store).toContain('set({ url: endpoint, token, enabled: true, activity: "连接中", connectError: "" });');
    });

    test("keeps toast context, manual disable clearing, and failed-connection retry semantics", () => {
        const host = readFileSync(hostPath, "utf8");
        const providers = readFileSync(resolve(srcRoot, "components/layout/app-providers.tsx"), "utf8");

        expect(providers).toContain("<App>");
        expect(host).toContain("const { message } = App.useApp();");
        expect(host).toContain('message.success("本地 Agent 已连接");');
        expect(host).toContain('message.error(text);');
        expect(host).toContain("if (!current.connected && current.connectError) {");
        expect(host).toContain("setConnectionRun((run) => run + 1);");
        expect(host).toContain('clearAgentSession({ enabled: false, connected: false, activity: "离线", connectError: "" });');
        expect(host).toContain("messages: [],");
    });
});
