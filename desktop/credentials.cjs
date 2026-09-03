const fs = require("node:fs");

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
        return environment;
    } catch {
        return {};
    }
}

module.exports = { loadRenderCredentialEnv };
