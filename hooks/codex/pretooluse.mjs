#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
/**
 * Codex CLI preToolUse hook for context-mode.
 *
 * Codex PreToolUse honors `permissionDecision:"deny"` on all builds, and
 * `permissionDecision:"allow" + updatedInput` / `additionalContext` on
 * codex-cli >= 0.141.0 (#845). Capability is detected at runtime by
 * codex-caps.mjs; older builds fail closed (redirect → deny). `ask` is still
 * unsupported. Source: codex-rs/hooks/src/engine/output_parser.rs
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdin, parseStdin, getInputProjectDir, getSessionId, CODEX_OPTS } from "../session-helpers.mjs";
import { routePreToolUse, initSecurity } from "../core/routing.mjs";
import { formatDecision } from "../core/formatters.mjs";
import { codexSupportsUpdatedInput } from "../core/codex-caps.mjs";

const __hookDir = dirname(fileURLToPath(import.meta.url));
await initSecurity(resolve(__hookDir, "..", "..", "build"));

const raw = await readStdin();
const input = parseStdin(raw);
const tool = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};
let projectDir;
try { projectDir = getInputProjectDir(input, CODEX_OPTS); }
catch (err) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: `Context Mode could not verify the native Codex context: ${err.message}`,
  } }) + "\n");
  process.exit(0);
}

const decision = routePreToolUse(tool, toolInput, projectDir, "codex", getSessionId(input, CODEX_OPTS));
// #845: only modify/context depend on Codex's rewrite capability. Detection is
// cached, but skip the probe entirely for deny / ask / passthrough decisions.
const needsCaps = decision && (decision.action === "modify" || decision.action === "context");
const response = formatDecision(
  "codex",
  decision,
  needsCaps ? { codexSupportsRewrite: codexSupportsUpdatedInput() } : {},
);
const output = response ?? {
  hookSpecificOutput: { hookEventName: "PreToolUse" },
};
process.stdout.write(JSON.stringify(output) + "\n");
