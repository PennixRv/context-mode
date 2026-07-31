---
name: ctx-recovery-brief
description: |
  Maintain or inspect a controlled RecoveryBrief for long-running Codex work, compaction preparation, task handoff, or session continuation. Use for Trellis RecoveryBrief updates, explicit project RecoveryBrief updates, and recovery-state inspection. Trigger: /context-mode:ctx-recovery-brief
user-invocable: true
---

# RecoveryBrief

Use this skill only when work needs durable semantic continuity across a Codex
compaction or a later session. It maintains recovery input; it does not perform
checkpoint delivery. The deterministic lifecycle remains:

`PreCompact -> PostCompact -> SessionStart(compact)`.

## Workflow

1. Call `ctx_recovery_brief_status` before reading or changing state.
2. Read only explicit, trusted project evidence needed to support the current facts. Do not use a transcript, FTS results, model memory, raw tool output, or a Git diff as a substitute for confirmed historical state.
3. Construct a complete v1 Brief with current objective, constraints, decisions, completed and open work, blocker, next action, and source-backed project state.
4. Call `ctx_recovery_brief_update` with the status digest as `expected_sha256`. Use `"absent"` only when status reports no Brief.
5. Call `ctx_recovery_brief_status` again and report only the content-free result.

When status selects `trellis`, update only its active task. A valid Trellis
pointer is authoritative. If status reports invalid Trellis state, stop and
repair it; never work around it with project fallback.

When status reports `NO_PROVIDER`, explain that no semantic source is active.
Call `ctx_recovery_brief_init` only after explicit user intent to enable the
project-local fallback. Choose `local` for untracked state or `tracked` only
when the project intends to review and commit the provider files.

For project providers, `explicit_project_state` hashes must refer to registered
source paths and `git` hashes must match current Git status. Supply
`source_paths` to `ctx_recovery_brief_update` only when explicitly refreshing
that evidence registration.

## Boundaries

- Never put secrets, credentials, PII, raw tool I/O, or full artifact bodies in a Brief.
- Never use `trellis_task` as a source kind for a project provider.
- Never reread, alter, or recreate a historical checkpoint snapshot. Updates apply only to the selected live provider.
- Never assume this skill is loaded before compaction. A missing skill must not affect checkpoint creation, confirmation, or compact-session delivery.
- Never claim that a status or checkpoint report measures model understanding, semantic recall, or task-continuation quality.

Read [the v1 reference](references/recovery-brief-v1.md) for field constraints,
provider selection, and error handling.
