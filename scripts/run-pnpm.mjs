#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const corepackVersion = "0.31.0";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCommand,
  [
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
