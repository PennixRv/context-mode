#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const corepackVersion = "0.31.0";
export function resolveNpmCliPath(nodeExecutablePath, platform) {
  const path = platform === "win32" ? win32 : posix;
  const nodeRoot = platform === "win32"
    ? path.dirname(nodeExecutablePath)
    : path.dirname(path.dirname(nodeExecutablePath));
  return path.join(
    nodeRoot,
    ...(platform === "win32" ? ["node_modules"] : ["lib", "node_modules"]),
    "npm",
    "bin",
    "npm-cli.js",
  );
}

const npmCliPath = resolveNpmCliPath(process.execPath, process.platform);

export function runPnpm() {
  if (!existsSync(npmCliPath)) {
    throw new Error(`npm-cli.js is missing from the active Node runtime: ${npmCliPath}`);
  }

  const result = spawnSync(
    process.execPath,
    [
      npmCliPath,
      "exec",
      "--yes",
      `--package=corepack@${corepackVersion}`,
      "--",
      "corepack",
      "pnpm",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPnpm();
}
