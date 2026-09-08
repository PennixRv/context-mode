# Codex Trellis Recovery Boundaries

## Ownership

Trellis task artifacts are the project-semantic source of truth. The Trellis
workflow decides when a verified semantic change warrants a RecoveryBrief
status or compare-and-swap update. context-mode supplies only the bounded
low-level provider and rejects unsafe, stale, or mismatched Trellis sources.

The provider is not a task workflow, coordinator, or compaction callback. It
must not be invoked for ordinary edits, tests, diffs, `PreCompact`,
`PostCompact`, `SessionStart(compact)`, automatic resume, or historical audit
rows. Workers do not write RecoveryBriefs.

## Compact Boundary

Codex Remote Compaction v2 owns live continuity. context-mode records a local
`pending -> confirmed` compact audit and never emits `additionalContext` for a
compact session start. A project-local SessionStart orientation, when present,
remains an independent bounded workflow concern and must not proxy context-mode
state or create a RecoveryBrief.

## Safety

RecoveryBrief source resolution accepts only a materialized regular file below
the active Trellis task resolved through the session-specific runtime pointer.
Malformed paths, links, stale hashes, and invalid schemas fail closed. The
provider never discovers semantic state from transcripts, raw tool I/O, FTS
results, checkpoint payloads, or task-body copies.

`ctx_checkpoint_report` is local audit telemetry only. It may report aggregate
state and RecoveryBrief snapshot metadata; it must not return payloads, prompts,
tool data, artifact bodies, or credentials.
