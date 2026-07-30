#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";

import { readStdin, parseStdin, resolveConfigDir, CODEX_OPTS } from "../session-helpers.mjs";

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const { recordToolCheckpointSignal } = await import("../checkpoint.bundle.mjs");
  recordToolCheckpointSignal(input, { configDir: resolveConfigDir(CODEX_OPTS) });
} catch {
  // Checkpoint capture is strictly best-effort and must not block Codex.
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "" },
}) + "\n");
