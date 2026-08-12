# Skills, Batch Execution, And Allowlist Boundaries

## Conclusion

context-mode does not turn Skill invocations into `ctx_batch_execute`
commands. Skill activation remains a host operation. The batch tool receives
and executes only the explicit `commands` array supplied in its MCP request.

Claude Code's `PostToolUse` matcher includes `Skill` so context-mode can record
a bounded `skill` session event for continuity. That observer does not execute
the Skill, rewrite it into a shell command, or add it to a batch. Codex's
default hook profile does not register generic `PostToolUse` and its
`PreToolUse` matcher names only native shell/edit tools and explicit
context-mode `ctx_*` tools.

## Exact Capability Matchers

- `hooks/codex/mcp-capability.mjs` accepts only `ctx_execute` and its two exact
  context-mode MCP names as the session-local execute capability proof.
- RecoveryBrief uses a separate exact matcher for only
  `ctx_recovery_brief_status` and `ctx_recovery_brief_update`.
- Neither matcher contains a wildcard for external MCP tools or Skills.

## Allowlist Meaning

`hooks/core/routing.mjs` has a structurally bounded shell-command allowlist.
It recognizes short, predictable probes such as `git status` and version
commands so the routing hook can omit a noisy “use context-mode” suggestion.
It rejects composed commands with shell control operators from that bypass.
This allowlist controls presentation of a routing nudge only: it does not grant
execution permission, bypass deny rules, activate Skills, or change the
server-enforced restricted execution policy.

