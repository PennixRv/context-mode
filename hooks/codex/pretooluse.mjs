#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import {
  RECOVERY_BRIEF_CAPABILITY_FIELD,
  isCodexRecoveryBriefToolName,
  issueRecoveryBriefCapability,
} from "../recovery-brief-capability.mjs";
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
import {
  hasCodexMcpCapability,
  isCodexCtxExecuteToolName,
  recordCodexMcpCapability,
} from "./mcp-capability.mjs";

const __hookDir = dirname(fileURLToPath(import.meta.url));
await initSecurity(resolve(__hookDir, "..", "..", "build"));

const raw = await readStdin();
const input = parseStdin(raw);
const tool = input.tool_name ?? "";
const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
const projectDir = getInputProjectDir(input, CODEX_OPTS);

let response;
if (isCodexRecoveryBriefToolName(tool)) {
  // This is the only MCP identity bridge. It requires the authoritative
  // Codex hook fields and never falls back to the pid-based session helper.
  const supportsRewrite = codexSupportsUpdatedInput();
  const capability = supportsRewrite
    ? issueRecoveryBriefCapability({ cwd: input.cwd, sessionId: input.session_id })
    : null;
  response = capability
    ? {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...toolInput,
          [RECOVERY_BRIEF_CAPABILITY_FIELD]: capability,
        },
      },
    }
    : {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "RecoveryBrief identity bridge unavailable",
      },
    };
} else {
  // Codex does not provide a current-session MCP tool table to hooks. Only an
  // observed exact owned ctx_execute event can prove this session has the
  // redirect target. Never infer that from a global server sentinel or another
  // session. External MCP names that resemble ctx_execute are not accepted.
  if (isCodexCtxExecuteToolName(tool)) recordCodexMcpCapability(input.session_id);
  const decision = routePreToolUse(
    tool,
    toolInput,
    projectDir,
    "codex",
    getSessionId(input, CODEX_OPTS),
    {
      mcpToolsAvailable: hasCodexMcpCapability(input.session_id),
      mcpRedirectTarget: "ctx_execute",
    },
  );
  // #845: only modify/context depend on Codex's rewrite capability. Detection is
  // cached, but skip the probe entirely for deny / ask / passthrough decisions.
  const needsCaps = decision && (decision.action === "modify" || decision.action === "context");
  response = formatDecision(
    "codex",
    decision,
    needsCaps ? { codexSupportsRewrite: codexSupportsUpdatedInput() } : {},
  );
}
const output = response ?? {
  hookSpecificOutput: { hookEventName: "PreToolUse" },
};
process.stdout.write(JSON.stringify(output) + "\n");
