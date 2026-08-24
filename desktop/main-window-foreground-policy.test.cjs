const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");

test("main window never restores or raises itself after startup", () => {
    const forbiddenTokens = [
        "second-instance",
        ".restore(",
        ".focus(",
        "flashFrame",
        "moveTop",
        "setAlwaysOnTop",
    ];

    for (const token of forbiddenTokens) {
        assert.equal(mainSource.includes(token), false, `main.cjs must not contain ${token}`);
    }
});

test("main keeps the single-instance lock that prevents port-conflict double starts", () => {
    assert.match(mainSource, /app\.requestSingleInstanceLock\(\)/);
});
