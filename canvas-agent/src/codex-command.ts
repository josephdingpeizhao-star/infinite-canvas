import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type CodexCommand = { command: string; baseArgs: string[]; env?: NodeJS.ProcessEnv; fallback?: { reason: string } };
export type CodexCommandOptions = { resolvePackageJson?: (specifier: string) => string };

const WINDOWS_NATIVE_TARGETS: Record<string, { pkg: string; triple: string }> = {
    x64: { pkg: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc" },
    arm64: { pkg: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc" },
};

const require = createRequire(import.meta.url);

export function codexBin() {
    return path.join(codexPackageRoot(), "bin", "codex.js");
}

// Windows 直连平台包内的原生 codex.exe：官方 JS 包装器 spawn 原生程序时未设 windowsHide，
// 在无控制台的 Electron 进程链下会新开可见黑色控制台窗口；两个环境变量与包装器注入行为对齐。
export function resolveCodexCommand(platform: string = process.platform, arch: string = process.arch, options: CodexCommandOptions = {}): CodexCommand {
    if (platform !== "win32") return wrapperCommand();
    const target = WINDOWS_NATIVE_TARGETS[arch];
    if (!target) return wrapperCommand(`Codex 未提供 win32/${arch} 原生平台包`);
    const resolvePackageJson = options.resolvePackageJson || ((specifier: string) => require.resolve(specifier));
    let nativeBinary: string;
    try {
        nativeBinary = path.join(path.dirname(resolvePackageJson(`${target.pkg}/package.json`)), "vendor", target.triple, "bin", "codex.exe");
    } catch {
        return wrapperCommand(`Codex 平台包 ${target.pkg} 未安装`);
    }
    if (!existsSync(nativeBinary)) return wrapperCommand(`Codex 原生程序缺失：${nativeBinary}`);
    return { command: nativeBinary, baseArgs: [], env: { ...process.env, CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: managedPackageRoot() } };
}

function wrapperCommand(fallbackReason?: string): CodexCommand {
    const command: CodexCommand = { command: process.execPath, baseArgs: [codexBin()] };
    if (fallbackReason) command.fallback = { reason: `${fallbackReason}，本次回退 JS 包装器启动（功能不受影响，可能出现黑色控制台窗口）` };
    return command;
}

function codexPackageRoot() {
    return path.dirname(require.resolve("@openai/codex/package.json"));
}

function managedPackageRoot() {
    const root = codexPackageRoot();
    try {
        return realpathSync(root);
    } catch {
        return root;
    }
}
