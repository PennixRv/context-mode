/**
 * adapters/codex/hooks — Codex CLI hook definitions.
 *
 * Codex CLI hooks run behind the current `hooks` feature flag surface.
 * Prefer `[features].hooks`; the legacy `[features].codex_hooks` alias is still
 * accepted in current Codex builds.
 * 6 hook events: PreToolUse, PostToolUse, PreCompact, SessionStart,
 * UserPromptSubmit, Stop. PreCompact is runtime-gated on Codex builds that emit
 * the event.
 * Same JSON stdin/stdout wire protocol as Claude Code.
 *
 * Config: $CODEX_HOME/hooks.json or ~/.codex/hooks.json.
 * MCP: full support via [mcp_servers] in $CODEX_HOME/config.toml.
 *
 * Known limitations:
 *   - PreToolUse: deny works on all builds. permissionDecision:"allow" +
 *     updatedInput (command rewrite) and additionalContext are honored on
 *     codex-cli >= 0.141.0 (#845), detected at runtime by
 *     hooks/core/codex-caps.mjs; older builds fail closed (redirect → deny).
 *     `ask` remains unsupported.
 *   - PostToolUse: updatedMCPToolOutput parsed but logged as unsupported
 *   - PostToolUse does not fire on failing Bash calls (upstream bug)
 */

// ─────────────────────────────────────────────────────────
// Hook type constants
// ─────────────────────────────────────────────────────────

/** Codex CLI hook types — mirrors Claude Code's continuity events. */
export const HOOK_TYPES = {
  PRE_TOOL_USE: "PreToolUse",
  POST_TOOL_USE: "PostToolUse",
  PRE_COMPACT: "PreCompact",
  SESSION_START: "SessionStart",
  USER_PROMPT_SUBMIT: "UserPromptSubmit",
  STOP: "Stop",
} as const;

// ─────────────────────────────────────────────────────────
// External MCP routing matcher (#529)
// ─────────────────────────────────────────────────────────

/**
 * Codex hook matcher for MCP-namespaced tools. Context Mode's own server is
 * filtered by routePreToolUse; the matcher must still reach the hook first.
 */
export const EXTERNAL_MCP_MATCHER_PATTERN = "mcp__.*";

// ─────────────────────────────────────────────────────────
// Routing instructions
// ─────────────────────────────────────────────────────────

/**
 * Path to the routing instructions file for Codex CLI.
 * Used as fallback routing awareness alongside hook-based enforcement.
 */
export const ROUTING_INSTRUCTIONS_PATH = "configs/codex/AGENTS.md";
