# Converge Codex compact lifecycle and routing

## Goal

Remove retired compact-context delivery, preserve audit-only lifecycle checkpoints, and align context-mode routing with the approved workflow boundary.

## Requirements

- Remove the complete Codex `SessionStart(compact)` checkpoint-delivery path so
  context-mode cannot inject `additionalContext` into Codex Remote Compaction
  v2.
- Retain the existing PreCompact/PostCompact checkpoint lifecycle as fail-open
  local audit only. It must not write a RecoveryBrief or block native compact.
- Keep historical local checkpoint rows readable without a destructive database
  migration, but stop creating or claiming delivery rows.
- Keep RecoveryBrief as an explicit provider protocol. Its semantic write gates
  belong to the project workflow, not to automatic compact/resume handling.
- Route workflow/component commands, structured MCP protocols, mutations, and
  external search directly. Context-mode may aggregate only unbounded local
  textual output or an explicitly requested direct HTTP/API response.
- Publish a normal, remotely reproducible `v1.0.192` release through the
  repository's existing release process. Do not merge unrelated upstream CI
  history or edit installed plugin caches.

## Acceptance Criteria

- [ ] Neither Codex manifest registers a compact `SessionStart` hook and no
  runtime path returns checkpoint text through `additionalContext`.
- [ ] PreCompact/PostCompact remain installed, fail open, and preserve only
  pending/confirmed audit behavior.
- [ ] Provider CAS/source-drift contracts and compatibility with historical
  checkpoint state pass focused tests.
- [ ] Routing documentation and behavior no longer present context-mode as a
  web-retrieval or workflow-component wrapper.
- [ ] Typecheck, focused regression tests, full test/build/release assertions,
  and the repository release process pass for an immutable remote `v1.0.192`.

## Constraints

- This task owns only the context-mode repository. Cross-component workflow
  changes are recorded and delivered by their respective component tasks.
- Do not add a second summary system, automatic memory recall, polling,
  background services, data exports, or new configuration.
