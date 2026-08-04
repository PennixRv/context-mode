/**
 * adapters/codex/hooks — Codex CLI hook definitions.
 *
 * Codex CLI hooks run behind the current `hooks` feature flag surface.
 * Prefer `[features].hooks`; the legacy `[features].codex_hooks` alias is still
 * accepted in current Codex builds.
 * The default profile uses only PreToolUse, PreCompact, PostCompact, and the
 * compact SessionStart event. Rich local capture remains available through
 * the explicit optional observability profile.
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
// Routing instructions
// ─────────────────────────────────────────────────────────

/**
 * Path to the routing instructions file for Codex CLI.
 * Used as fallback routing awareness alongside hook-based enforcement.
 */
export const ROUTING_INSTRUCTIONS_PATH = "configs/codex/AGENTS.md";
