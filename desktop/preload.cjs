const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function injectCanvasAgentConnection() {
    try {
        const configFile = path.join(os.homedir(), ".infinite-canvas", "canvas-agent.json");
        const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
        if (typeof config.url === "string" && typeof config.token === "string") {
            window.localStorage.setItem("canvas-agent-url", config.url);
            window.localStorage.setItem("canvas-agent-token", config.token);
        }
    } catch {
        // The normal web connection screen remains available as a fallback.
    }
}

injectCanvasAgentConnection();
window.addEventListener("DOMContentLoaded", injectCanvasAgentConnection, { once: true });
