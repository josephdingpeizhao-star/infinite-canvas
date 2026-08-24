const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
    DEFAULT_BACKUP_COUNT,
    DEFAULT_MAX_BYTES,
    createProcessOutputLog,
    forwardProcessOutput,
} = require("./process-output-log.cjs");

const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const moduleSource = fs.readFileSync(path.join(__dirname, "process-output-log.cjs"), "utf8");
const packageJson = require("./package.json");

test("process output logger writes stdout and stderr into separate files", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-output-log-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const logger = createProcessOutputLog({ directory });

    assert.equal(logger.write("stdout", Buffer.from("hello stdout\n")), true);
    assert.equal(logger.write("stderr", Buffer.from("hello stderr\n")), true);
    assert.equal(fs.readFileSync(logger.filePath("stdout"), "utf8"), "hello stdout\n");
    assert.equal(fs.readFileSync(logger.filePath("stderr"), "utf8"), "hello stderr\n");
});

test("process output logger rotates before a stream exceeds its byte limit", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-output-rotate-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const logger = createProcessOutputLog({
        directory,
        basename: "rotation",
        maxBytes: 5,
        backupCount: 2,
    });

    assert.equal(logger.write("stdout", "1234"), true);
    assert.equal(logger.write("stdout", "5678"), true);
    assert.equal(logger.write("stdout", "abcde"), true);
    const activePath = logger.filePath("stdout");
    assert.equal(fs.readFileSync(activePath, "utf8"), "abcde");
    assert.equal(fs.readFileSync(`${activePath}.1`, "utf8"), "5678");
    assert.equal(fs.readFileSync(`${activePath}.2`, "utf8"), "1234");
    for (const candidate of [activePath, `${activePath}.1`, `${activePath}.2`]) {
        assert.ok(fs.statSync(candidate).size <= 5);
    }
});

test("a single oversized chunk keeps only its bounded tail", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-output-tail-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const logger = createProcessOutputLog({ directory, maxBytes: 5, backupCount: 0 });

    assert.equal(logger.write("stderr", "123456789"), true);
    assert.equal(fs.readFileSync(logger.filePath("stderr"), "utf8"), "56789");
    assert.equal(fs.statSync(logger.filePath("stderr")).size, 5);
});

test("injected file-system failure returns false instead of throwing", () => {
    const calls = [];
    const logger = createProcessOutputLog({
        directory: path.join("Z:\\", "diagnostics"),
        fileSystem: {
            mkdirSync(...args) {
                calls.push(["mkdirSync", ...args]);
            },
            existsSync() {
                calls.push(["existsSync"]);
                return false;
            },
            appendFileSync() {
                calls.push(["appendFileSync"]);
                throw new Error("disk unavailable");
            },
        },
    });

    assert.equal(logger.write("stdout", Buffer.from("payload")), false);
    assert.deepEqual(calls.map(([name]) => name), ["mkdirSync", "existsSync", "appendFileSync"]);
});

test("forwarding survives an injected logger exception and preserves the existing prefix", () => {
    const forwarded = [];
    const logged = [];

    assert.doesNotThrow(() => forwardProcessOutput({
        destination: { write: (value) => forwarded.push(value) },
        logger: {
            write(stream, chunk) {
                logged.push([stream, chunk]);
                throw new Error("logger failure");
            },
        },
        stream: "stderr",
        chunk: Buffer.from("boom\n"),
        prefix: "[canvas-workbench] ",
    }));

    assert.deepEqual(forwarded, ["[canvas-workbench] boom\n"]);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "stderr");
    assert.equal(logged[0][1].toString("utf8"), "boom\n");
});

test("module is Electron-free and defaults to a bounded two-backup policy", () => {
    assert.doesNotMatch(moduleSource, /require\(["']electron["']\)/);
    assert.equal(DEFAULT_MAX_BYTES, 5 * 1024 * 1024);
    assert.equal(DEFAULT_BACKUP_COUNT, 2);
});

test("main wires both workbench streams to the data-root logger", () => {
    assert.match(
        mainSource,
        /workbenchOutputLogging\s*=\s*initializeWorkbenchOutputLogging\(\);/,
    );
    assert.match(
        mainSource,
        /directory:\s*path\.join\(resolveDataRoot\(\),\s*"workflow-runtime",\s*"logs"\)/,
    );
    assert.match(
        mainSource,
        /workbenchOutputLogging\.forwardProcessOutput\(\{[\s\S]*?logger:\s*workbenchOutputLogging\.logger,[\s\S]*?stream,[\s\S]*?chunk,/,
    );
    assert.match(
        mainSource,
        /ownedWorkbench\.stdout\?\.on\("data", \(chunk\) => forwardWorkbenchOutput\("stdout", chunk, process\.stdout\)\);/,
    );
    assert.match(
        mainSource,
        /ownedWorkbench\.stderr\?\.on\("data", \(chunk\) => forwardWorkbenchOutput\("stderr", chunk, process\.stderr\)\);/,
    );
});

test("desktop test and build manifests include the process output logger", () => {
    assert.match(packageJson.scripts.test, /(?:^|\s)process-output-log\.test\.cjs(?:\s|$)/);
    assert.equal(packageJson.build.files.includes("process-output-log.cjs"), true);
});
