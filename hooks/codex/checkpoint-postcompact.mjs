#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";

import { readStdin, parseStdin, resolveConfigDir, CODEX_OPTS } from "../session-helpers.mjs";

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const { confirmPendingCheckpoint } = await import("../checkpoint.bundle.mjs");
  confirmPendingCheckpoint(input, { configDir: resolveConfigDir(CODEX_OPTS) });
} catch {
  // A failed audit update must never affect a completed compaction.
}

process.stdout.write(JSON.stringify({}) + "\n");
