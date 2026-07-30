#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";

import { readStdin, parseStdin, resolveConfigDir, CODEX_OPTS } from "../session-helpers.mjs";

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const { createPendingCheckpoint } = await import("../checkpoint.bundle.mjs");
  createPendingCheckpoint(input, { configDir: resolveConfigDir(CODEX_OPTS) });
} catch {
  // A failed checkpoint must never cancel native compaction.
}

process.stdout.write(JSON.stringify({}) + "\n");
