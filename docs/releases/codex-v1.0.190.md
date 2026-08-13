# Codex Marketplace Release v1.0.190

## Issue 009/073: deleted MCP cwd tolerance

- Codex CLI Doctor and Plugin inventory probes now use an explicit existing cwd
  selected from `CODEX_HOME`, `HOME`, or the operating-system home directory.
- Probes never inherit `process.cwd()`, which may refer to a deleted
  `plugin-backup-*` directory after a host Plugin update.
- Cwd unavailability, command startup failure, non-zero exit, timeout, and
  generic invocation failure are represented by distinct diagnostic reasons.
- Added a Linux isolation regression that deletes the MCP process's inherited
  cwd before invoking `ctx_doctor` and verifies stable Plugin inventory facts.

This release is a context-mode component-side mitigation. It does not repair
Codex host Plugin update cleanup or prove that the host will never retain a
deleted cwd for an active MCP process.
