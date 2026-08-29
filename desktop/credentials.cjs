const fs = require("node:fs");

const TEXT_CREDENTIAL_ENV = [
    ["text_provider", "CANVAS_TEXT_PROVIDER"],
    ["ark_api_key", "ARK_API_KEY"],
    ["ark_base_url", "ARK_BASE_URL"],
    ["ark_model", "ARK_MODEL"],
];

function trimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function loadRenderCredentialEnv(filePath) {
    try {
        const credentials = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const environment = {};
        const apiKey = trimmedString(credentials?.api_key);
        const baseUrl = trimmedString(credentials?.base_url);
        if (apiKey && /^https?:\/\//i.test(baseUrl)) {
            Object.assign(environment, {
                RENDER_ALLOW_REAL_EXECUTION: "1",
                OPENAI_API_KEY: apiKey,
                OPENAI_BASE_URL: baseUrl,
            });
        }
        for (const [credentialName, environmentName] of TEXT_CREDENTIAL_ENV) {
            const value = trimmedString(credentials?.[credentialName]);
            if (value) environment[environmentName] = value;
        }
        return environment;
    } catch {
        return {};
    }
}

module.exports = { loadRenderCredentialEnv };
