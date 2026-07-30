#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";

import { readStdin, parseStdin, resolveConfigDir, CODEX_OPTS } from "../session-helpers.mjs";

let additionalContext = "";
try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const { claimConfirmedCheckpointContext } = await import("../checkpoint.bundle.mjs");
  additionalContext = claimConfirmedCheckpointContext(input, { configDir: resolveConfigDir(CODEX_OPTS) });
} catch {
  // A missing checkpoint is indistinguishable from an unavailable checkpoint.
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
}) + "\n");
