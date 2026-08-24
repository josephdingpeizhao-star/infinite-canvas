const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
    BACKGROUND_SWITCHES,
    POWER_SAVE_BLOCKER_TYPE,
    appendBackgroundSwitches,
    createPowerManagement,
} = require("./background-policy.cjs");

const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const moduleSource = fs.readFileSync(path.join(__dirname, "background-policy.cjs"), "utf8");
const packageJson = require("./package.json");

test("background policy keeps an exact unique switch list and has no Electron dependency", () => {
    assert.deepEqual(BACKGROUND_SWITCHES, [
        "disable-background-timer-throttling",
        "disable-renderer-backgrounding",
        "disable-backgrounding-occluded-windows",
    ]);
    assert.equal(new Set(BACKGROUND_SWITCHES).size, BACKGROUND_SWITCHES.length);
    assert.doesNotMatch(moduleSource, /require\(["']electron["']\)/);
});

test("background policy appends every switch exactly once through the injected command line", () => {
    const calls = [];
    appendBackgroundSwitches({ appendSwitch: (name) => calls.push(name) });

    assert.deepEqual(calls, BACKGROUND_SWITCHES);
});

test("power blocker type prevents app suspension without preventing display sleep", () => {
    assert.equal(POWER_SAVE_BLOCKER_TYPE, "prevent-app-suspension");
    assert.notEqual(POWER_SAVE_BLOCKER_TYPE, "prevent-display-sleep");
});

test("power management start is idempotent and calls the injected blocker once", () => {
    const calls = [];
    const lifecycle = createPowerManagement({
        start(type) {
            calls.push(["start", type]);
            return 41;
        },
        isStarted(id) {
            calls.push(["isStarted", id]);
            return true;
        },
        stop(id) {
            calls.push(["stop", id]);
        },
    }, () => assert.fail("warning must not be emitted"));

    assert.equal(lifecycle.start(), 41);
    assert.equal(lifecycle.start(), 41);
    assert.deepEqual(calls, [
        ["start", POWER_SAVE_BLOCKER_TYPE],
        ["isStarted", 41],
    ]);
});

test("power management degrades an invalid blocker id with a warning and remains safely stopped", () => {
    let checked = false;
    const warnings = [];
    const lifecycle = createPowerManagement({
        start: () => undefined,
        isStarted() {
            checked = true;
            return true;
        },
        stop() {
            throw new Error("stop must not be called");
        },
    }, (message) => warnings.push(message));

    assert.equal(lifecycle.start(), null);
    assert.equal(checked, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /continuing without suspend prevention/);
    assert.equal(lifecycle.stop(), false);
});

test("power management retries after the injected blocker reports a failed start", () => {
    const startIds = [51, 52];
    const warnings = [];
    const lifecycle = createPowerManagement({
        start: () => startIds.shift(),
        isStarted: (id) => id === 52,
        stop() {},
    }, (message) => warnings.push(message));

    assert.equal(lifecycle.start(), null);
    assert.equal(lifecycle.start(), 52);
    assert.equal(warnings.length, 1);
});

test("power management startup failure warns and lets desktop startup continue", () => {
    const warnings = [];
    const lifecycle = createPowerManagement({
        start() {
            throw new Error("blocked by host policy");
        },
        isStarted() {
            throw new Error("must not be reached");
        },
        stop() {
            throw new Error("must not be reached");
        },
    }, (message) => warnings.push(message));
    let startupContinued = false;

    assert.doesNotThrow(() => {
        assert.equal(lifecycle.start(), null);
        startupContinued = true;
    });
    assert.equal(startupContinued, true);
    assert.deepEqual(warnings, [
        "Background keepalive unavailable; continuing without suspend prevention: blocked by host policy",
    ]);
    assert.equal(lifecycle.stop(), false);
});

test("power management stop is safe before any successful start", () => {
    const lifecycle = createPowerManagement({
        start() {
            throw new Error("not used");
        },
        isStarted() {
            throw new Error("not used");
        },
        stop() {
            throw new Error("not used");
        },
    });

    assert.equal(lifecycle.stop(), false);
    assert.equal(lifecycle.stop(), false);
});

test("power management stop tolerates a blocker that is no longer active", () => {
    let checks = 0;
    let stopCalls = 0;
    const lifecycle = createPowerManagement({
        start: () => 61,
        isStarted() {
            checks += 1;
            return checks === 1;
        },
        stop() {
            stopCalls += 1;
        },
    });

    assert.equal(lifecycle.start(), 61);
    assert.equal(lifecycle.stop(), false);
    assert.equal(lifecycle.stop(), false);
    assert.equal(stopCalls, 0);
});

test("power management stops an active blocker exactly once", () => {
    const stopped = [];
    const lifecycle = createPowerManagement({
        start: () => 71,
        isStarted: () => true,
        stop: (id) => stopped.push(id),
    });

    assert.equal(lifecycle.start(), 71);
    assert.equal(lifecycle.stop(), true);
    assert.equal(lifecycle.stop(), false);
    assert.deepEqual(stopped, [71]);
});

test("main disables BrowserWindow background throttling", () => {
    assert.match(
        mainSource,
        /webPreferences:\s*\{[^}]*backgroundThrottling:\s*false,[^}]*\}/,
    );
});

test("main appends background switches before Electron readiness", () => {
    const appendIndex = mainSource.indexOf("appendBackgroundSwitches(app.commandLine);");
    const readyIndex = mainSource.indexOf("app.whenReady()");

    assert.notEqual(appendIndex, -1);
    assert.notEqual(readyIndex, -1);
    assert.ok(appendIndex < readyIndex, "background switches must be appended before app.whenReady()");
});

test("main degrades power management failure without interrupting desktop startup", () => {
    const start = mainSource.indexOf("async function startDesktop()");
    const end = mainSource.indexOf("function resolveWorkflowRoot()", start);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(
        mainSource.slice(start, end),
        /backgroundPolicy\?\.start\(\);\s*app\.setAppUserModelId\(/,
    );
    assert.match(
        mainSource,
        /createPowerManagement\(powerSaveBlocker, \(message\) => console\.warn\(message\)\)/,
    );
});

test("main stops power management during before-quit cleanup", () => {
    const start = mainSource.indexOf('app.on("before-quit"');
    const end = mainSource.indexOf('app.on("window-all-closed"', start);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(mainSource.slice(start, end), /backgroundPolicy\?\.stop\(\);/);
});

test("desktop test and build manifests include the background policy module", () => {
    assert.match(packageJson.scripts.test, /(?:^|\s)background-policy\.test\.cjs(?:\s|$)/);
    assert.equal(packageJson.build.files.includes("background-policy.cjs"), true);
});
