# Codex Marketplace Release v1.0.189

## Scope

This patch completes the Issue 009 Doctor contract for Linux and WSL Codex
Plugin installs. CLI `doctor` and MCP `ctx_doctor` now collect one diagnostic
report and render the same Plugin inventory, source/cache/runtime roots,
manifests, Hook declarations, cache alignment, and registration facts.

Every non-present observation has a stable reason. Probe or host-session limits
produce `unavailable`, confirmed absence produces `missing`, and observations
that do not apply to an absent or disabled Plugin produce `not_applicable`.
Filesystem manifests do not claim that the current Codex host session loaded
Hooks; that host-only fact remains explicitly unavailable until a host
observation channel exists.

## Codex MCP Discovery

The Plugin manifest keeps `CONTEXT_MODE_PLATFORM=codex` fixed and forwards an
exact eight-name allowlist:

- `PATH`
- `HOME`
- `CODEX_HOME`
- `CONTEXT_MODE_CODE_ECHO_MAX`
- `CONTEXT_MODE_COMMAND_ECHO_MAX`
- `CONTEXT_MODE_TITLE_PREVIEW_MAX`
- `CONTEXT_MODE_SEARCHABLE_TERMS_MAX`
- `CONTEXT_MODE_RESULT_PREVIEW_MAX`

The first three entries give the MCP process the same Codex executable and
profile discovery inputs as CLI Doctor. The remaining entries retain the
compact presentation contract from v1.0.185. No credential, concrete budget,
machine-specific root, or open-ended environment is embedded or forwarded.

## Upgrade Note

Install the marketplace patch through the normal Codex Plugin update
transaction and restart Codex. A process already started from v1.0.188 cannot
acquire the new manifest environment projection in place. Root workflow
acceptance must compare CLI Doctor and MCP `ctx_doctor` in the same newly
started Codex session.
