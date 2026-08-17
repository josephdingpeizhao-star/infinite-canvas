import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = path.resolve(desktopRoot, "..");
const runtimeRoot = path.resolve(desktopRoot, "runtime");

if (!runtimeRoot.startsWith(`${desktopRoot}${path.sep}`)) {
    throw new Error(`Refusing to replace runtime outside desktop: ${runtimeRoot}`);
}

const webSource = path.join(projectRoot, "web", "dist");
const agentSource = path.join(projectRoot, "canvas-agent", "dist");
const agentPackageSource = path.join(projectRoot, "canvas-agent", "package.json");
const agentTarget = path.join(runtimeRoot, "canvas-agent");

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(agentTarget, { recursive: true });
await cp(webSource, path.join(runtimeRoot, "web"), { recursive: true });
await cp(agentSource, path.join(agentTarget, "dist"), { recursive: true });
await writeFile(path.join(agentTarget, "package.json"), await readFile(agentPackageSource));

process.stdout.write(`Desktop runtime synchronized: ${runtimeRoot}\n`);
