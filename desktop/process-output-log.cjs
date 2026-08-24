const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BACKUP_COUNT = 2;
const OUTPUT_STREAMS = new Set(["stdout", "stderr"]);

function createProcessOutputLog({
    directory,
    basename = "canvas-workbench",
    maxBytes = DEFAULT_MAX_BYTES,
    backupCount = DEFAULT_BACKUP_COUNT,
    fileSystem = fs,
}) {
    if (typeof directory !== "string" || !directory) throw new TypeError("directory is required");
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new TypeError("maxBytes must be positive");
    if (!Number.isInteger(backupCount) || backupCount < 0) throw new TypeError("backupCount must be non-negative");

    function filePath(stream) {
        if (!OUTPUT_STREAMS.has(stream)) throw new TypeError("stream must be stdout or stderr");
        return path.join(directory, `${basename}.${stream}.log`);
    }

    function rotate(activePath) {
        if (backupCount === 0) {
            if (fileSystem.existsSync(activePath)) fileSystem.rmSync(activePath, { force: true });
            return;
        }
        for (let index = backupCount; index >= 1; index -= 1) {
            const source = index === 1 ? activePath : `${activePath}.${index - 1}`;
            const destination = `${activePath}.${index}`;
            if (!fileSystem.existsSync(source)) continue;
            if (fileSystem.existsSync(destination)) fileSystem.rmSync(destination, { force: true });
            fileSystem.renameSync(source, destination);
        }
    }

    function write(stream, chunk) {
        try {
            const activePath = filePath(stream);
            const original = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
            const data = original.length > maxBytes ? original.subarray(original.length - maxBytes) : original;
            fileSystem.mkdirSync(directory, { recursive: true });
            const currentBytes = fileSystem.existsSync(activePath)
                ? fileSystem.statSync(activePath).size
                : 0;
            if (currentBytes + data.length > maxBytes) rotate(activePath);
            fileSystem.appendFileSync(activePath, data);
            return true;
        } catch {
            return false;
        }
    }

    return Object.freeze({ filePath, write });
}

function forwardProcessOutput({ destination, logger, stream, chunk, prefix }) {
    destination.write(`${prefix}${chunk}`);
    try {
        logger?.write(stream, chunk);
    } catch {
        // File diagnostics are optional and must never disrupt process forwarding.
    }
}

module.exports = {
    DEFAULT_BACKUP_COUNT,
    DEFAULT_MAX_BYTES,
    createProcessOutputLog,
    forwardProcessOutput,
};
