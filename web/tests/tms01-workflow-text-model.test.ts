import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    buildWorkflowTextModelOptions,
    CODEX_REASONING_EFFORTS,
    describeWorkflowTextModelSelection,
    resolveWorkflowTextModelPayload,
    syncWorkflowTextModel,
    WORKFLOW_TEXT_MODEL_ENDPOINT,
    type WorkflowTextModelPayload,
} from "@/lib/canvas/canvas-workflow-text-model";
import { fetchProductionQuote, productionConfirmationCopy } from "@/lib/canvas/canvas-workflow-production";
import { defaultConfig, migrateConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import {
    DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION,
    migrateWorkflowTextModelStore,
} from "@/stores/use-workflow-text-model-store";

const appConfigSource = readFileSync(new URL("../src/components/layout/app-config-modal.tsx", import.meta.url), "utf8");
const userLayoutSource = readFileSync(new URL("../src/layouts/user-layout.tsx", import.meta.url), "utf8");
const syncHostSource = readFileSync(new URL("../src/components/canvas/workflow-text-model-sync-host.tsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../src/stores/use-workflow-text-model-store.ts", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const canvasAgentPackage = JSON.parse(readFileSync(new URL("../../canvas-agent/package.json", import.meta.url), "utf8"));
const desktopPackage = JSON.parse(readFileSync(new URL("../../desktop/package.json", import.meta.url), "utf8"));

const openaiChannel: ModelChannel = {
    id: "dashscope",
    name: "千问渠道",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    apiKey: "secret-key",
    apiFormat: "openai",
    models: ["qwen3-vl-plus", "gpt-image-2", "grok-imagine-video", "qwen-audio"],
};
const geminiChannel: ModelChannel = {
    id: "gemini",
    name: "Gemini 渠道",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "gemini-key",
    apiFormat: "gemini",
    models: ["gemini-2.5-pro"],
};

function configWith(...channels: ModelChannel[]): AiConfig {
    return { ...defaultConfig, channels };
}

describe("TMS-01 workflow text model", () => {
    test("uses Sol medium for both new-install defaults", () => {
        expect(DEFAULT_WORKFLOW_TEXT_MODEL_SELECTION).toEqual({ kind: "codex", model: "gpt-5.6-sol", effort: "medium" });
        expect(defaultConfig.channels.find((channel) => channel.id === "default")?.models).toContain("gpt-5.6-sol");
        expect(defaultConfig.channels.find((channel) => channel.id === "default")?.models).not.toContain("gpt-5.5");
        expect(defaultConfig.textModel).toBe("default::gpt-5.6-sol");
        expect(defaultConfig.models).toContain("default::gpt-5.6-sol");
        expect(defaultConfig.textModels).toEqual(["default::gpt-5.6-sol"]);
    });

    test("migrates only the old persisted workflow Codex default and remains idempotent", () => {
        const oldCodex = {
            selection: { kind: "codex", model: "gpt-5.5", effort: "high" },
            syncState: "synced",
            syncedLabel: "old label",
            syncHint: "keep hint",
        };
        const migrated = migrateWorkflowTextModelStore(oldCodex, 0) as typeof oldCodex;
        expect(migrated).toEqual({ ...oldCodex, selection: { kind: "codex", model: "gpt-5.6-sol", effort: "high" } });
        expect(migrateWorkflowTextModelStore(migrated, 0)).toEqual(migrated);

        const channel = { selection: { kind: "channel", channelModel: "dashscope::qwen3-vl-plus" }, syncState: "synced" };
        expect(migrateWorkflowTextModelStore(channel, 0)).toEqual(channel);
        const customCodex = { selection: { kind: "codex", model: "gpt-5.4", effort: "medium" } };
        expect(migrateWorkflowTextModelStore(customCodex, 0)).toEqual(customCodex);
    });

    test("migrates only built-in default-channel GPT-5.5 references and preserves custom channels", () => {
        const customChannel: ModelChannel = {
            id: "custom",
            name: "自定义 GPT-5.5 渠道",
            baseUrl: "https://custom.example.test/v1",
            apiKey: "preserve-key-marker",
            apiFormat: "openai",
            models: ["alpha", "gpt-5.5", "omega"],
        };
        const oldState = {
            config: {
                ...defaultConfig,
                channels: [
                    {
                        id: "default",
                        name: "默认渠道",
                        baseUrl: "https://api.openai.com",
                        apiKey: "default-key-marker",
                        apiFormat: "openai" as const,
                        models: ["gpt-image-2", "gpt-5.5", "gpt-4o-mini-tts"],
                    },
                    customChannel,
                ],
                textModel: "default::gpt-5.5",
                models: ["default::gpt-image-2", "default::gpt-5.5", "custom::gpt-5.5"],
                textModels: ["default::gpt-5.5", "custom::gpt-5.5"],
            },
            webdav: { marker: "unchanged" },
        };

        const migrated = migrateConfigStore(oldState, 0) as typeof oldState;
        expect(migrated.config.channels[0]).toEqual({
            ...oldState.config.channels[0],
            models: ["gpt-image-2", "gpt-5.6-sol", "gpt-4o-mini-tts"],
        });
        expect(migrated.config.channels[1]).toEqual(customChannel);
        expect(migrated.config.textModel).toBe("default::gpt-5.6-sol");
        expect(migrated.config.models).toEqual(["default::gpt-image-2", "default::gpt-5.6-sol", "custom::gpt-5.5"]);
        expect(migrated.config.textModels).toEqual(["default::gpt-5.6-sol", "custom::gpt-5.5"]);
        expect(migrated.webdav).toEqual(oldState.webdav);
        expect(migrateConfigStore(migrated, 0)).toEqual(migrated);

        const customSelection = { ...oldState, config: { ...oldState.config, textModel: "custom::gpt-5.5" } };
        const customSelectionMigrated = migrateConfigStore(customSelection, 0) as typeof customSelection;
        expect(customSelectionMigrated.config.textModel).toBe("custom::gpt-5.5");
    });

    test("wires both persist migrations and pins both embedded Codex clients", () => {
        expect(storeSource).toContain("version: 1");
        expect(storeSource).toContain("migrate: migrateWorkflowTextModelStore");
        expect(configStoreSource).toContain("version: 1");
        expect(configStoreSource).toContain("migrate: migrateConfigStore");
        expect(canvasAgentPackage.dependencies["@openai/codex"]).toBe("0.153.0");
        expect(desktopPackage.dependencies["@openai/codex"]).toBe("0.153.0");
    });

    test("keeps Codex available and only includes text models from OpenAI-compatible channels", () => {
        const groups = buildWorkflowTextModelOptions(configWith(openaiChannel, geminiChannel));
        expect(groups).toEqual([
            { label: "Codex 登录账号", options: [{ label: "Codex", value: "codex" }] },
            { label: "渠道模型", options: [{ label: "qwen3-vl-plus（千问渠道）", value: "dashscope::qwen3-vl-plus" }] },
        ]);
        expect(JSON.stringify(groups)).not.toContain("gpt-image-2");
        expect(JSON.stringify(groups)).not.toContain("gemini-2.5-pro");
        expect([...CODEX_REASONING_EFFORTS]).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
    });

    test("resolves the Codex payload and label", () => {
        const config = configWith(openaiChannel);
        const selection = { kind: "codex", model: "gpt-5.6-sol", effort: "xhigh" } as const;
        expect(resolveWorkflowTextModelPayload(config, selection)).toEqual({
            payload: { provider: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
            hint: "",
        });
        expect(describeWorkflowTextModelSelection(config, selection)).toBe("Codex gpt-5.6-sol（xhigh）");
    });

    test("resolves an OpenAI-compatible channel and normalizes its API base URL", () => {
        const config = configWith(openaiChannel);
        const selection = { kind: "channel", channelModel: "dashscope::qwen3-vl-plus" } as const;
        expect(resolveWorkflowTextModelPayload(config, selection)).toEqual({
            payload: {
                provider: "openai_compatible",
                model: "qwen3-vl-plus",
                base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                api_key: "secret-key",
                channel_name: "千问渠道",
            },
            hint: "",
        });
        expect(describeWorkflowTextModelSelection(config, selection)).toBe("qwen3-vl-plus（千问渠道）");
    });

    test("rejects missing channel connection fields and Gemini channels before syncing", () => {
        const missing = { ...openaiChannel, baseUrl: "" };
        expect(resolveWorkflowTextModelPayload(configWith(missing), { kind: "channel", channelModel: "dashscope::qwen3-vl-plus" })).toEqual({
            payload: null,
            hint: "该渠道缺少 Base URL 或 API Key",
        });
        expect(resolveWorkflowTextModelPayload(configWith(geminiChannel), { kind: "channel", channelModel: "gemini::gemini-2.5-pro" })).toEqual({
            payload: null,
            hint: "该渠道缺少 Base URL 或 API Key",
        });
        expect(resolveWorkflowTextModelPayload(configWith(openaiChannel), { kind: "channel", channelModel: "deleted::qwen3-vl-plus" })).toEqual({
            payload: null,
            hint: "该渠道或模型已不可用",
        });
    });

    test("posts the selection with the canvas token and returns the backend label", async () => {
        const payload: WorkflowTextModelPayload = { provider: "codex", model: "gpt-5.5", effort: "medium" };
        const calls: Array<{ input: string; init?: RequestInit }> = [];
        const label = await syncWorkflowTextModel(payload, " canvas-token ", async (input, init) => {
            calls.push({ input: String(input), init });
            return new Response(JSON.stringify({ ok: true, textModel: { provider: "codex", model: "gpt-5.5", effort: "medium", label: "Codex gpt-5.5（medium）" } }), { status: 200 });
        });
        expect(label).toBe("Codex gpt-5.5（medium）");
        expect(calls).toHaveLength(1);
        expect(calls[0]?.input).toBe(WORKFLOW_TEXT_MODEL_ENDPOINT);
        expect(calls[0]?.init?.method).toBe("POST");
        expect(new Headers(calls[0]?.init?.headers).get("x-canvas-agent-token")).toBe("canvas-token");
        expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(payload);
    });

    test("uses a fixed key-free error for failed and malformed sync responses", async () => {
        const payload: WorkflowTextModelPayload = { provider: "openai_compatible", model: "qwen3-vl-plus", base_url: "https://example.com/v1", api_key: "never-echo-this", channel_name: "千问" };
        let error: unknown;
        try {
            await syncWorkflowTextModel(payload, "token", async () => new Response(JSON.stringify({ ok: false, message: "never-echo-this" }), { status: 400 }));
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("识图模型同步失败");
        expect((error as Error).message).not.toContain(payload.api_key);
        for (const body of ["{}", "null"]) {
            await expect(
                syncWorkflowTextModel({ provider: "codex", model: "gpt-5.5", effort: "medium" }, "token", async () => new Response(body, { status: 200 })),
            ).rejects.toThrow("识图模型同步失败");
        }
    });

    test("requires a non-empty quote label and places it after the remaining count", async () => {
        const response = {
            ok: true,
            batchId: "cup",
            totalCount: 2,
            expectedConfigIds: ["main_01", "detail_01"],
            readyCount: 0,
            remainingCount: 2,
            textModelLabel: "Codex gpt-5.5（medium）",
            renderQuality: "auto",
            estimatedMinutes: 8,
        };
        const quote = await fetchProductionQuote("cup", "token", async () => new Response(JSON.stringify(response), { status: 200 }));
        expect(quote.textModelLabel).toBe("Codex gpt-5.5（medium）");
        expect(productionConfirmationCopy(quote).rows.slice(0, 2)).toEqual([
            { key: "remaining", label: "本次还需制作", value: "2 张" },
            { key: "textModel", label: "识图模型", value: "Codex gpt-5.5（medium）" },
        ]);
        await expect(
            fetchProductionQuote("cup", "token", async () => new Response(JSON.stringify({ ...response, textModelLabel: "" }), { status: 200 })),
        ).rejects.toThrow("本机真实制作服务没有返回可信的制作估算，本次没有开始。");
    });

    test("persists only the selection and anchors both application-level hosts", () => {
        expect(storeSource).toContain('name: "infinite-canvas:workflow_text_model"');
        expect(storeSource).toContain("partialize: (state) => ({ selection: state.selection })");
        expect(appConfigSource.match(/WorkflowTextModelConfig/g)).toHaveLength(2);
        expect(appConfigSource.indexOf("<WorkflowTextModelConfig />")).toBeGreaterThan(appConfigSource.indexOf("xl:grid-cols-4"));
        expect(userLayoutSource.match(/CanvasAgentConnectionHost/g)).toHaveLength(2);
        expect(userLayoutSource.match(/WorkflowTextModelSyncHost/g)).toHaveLength(2);
        expect(userLayoutSource.indexOf("<WorkflowTextModelSyncHost />")).toBeGreaterThan(userLayoutSource.indexOf("<CanvasAgentConnectionHost />"));
        expect(userLayoutSource.indexOf("<WorkflowTextModelSyncHost />")).toBeLessThan(userLayoutSource.indexOf("<AgentPanel />"));
        expect(syncHostSource).not.toContain("new EventSource(");
    });
});
