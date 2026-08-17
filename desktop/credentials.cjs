const fs = require("node:fs");

function loadRenderCredentialEnv(filePath) {
    try {
        const credentials = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const apiKey = typeof credentials?.api_key === "string" ? credentials.api_key.trim() : "";
        const baseUrl = typeof credentials?.base_url === "string" ? credentials.base_url.trim() : "";
        if (!apiKey || !/^https?:\/\//i.test(baseUrl)) return {};
        return {
            RENDER_ALLOW_REAL_EXECUTION: "1",
            OPENAI_API_KEY: apiKey,
            OPENAI_BASE_URL: baseUrl,
        };
    } catch {
        return {};
    }
}

module.exports = { loadRenderCredentialEnv };
