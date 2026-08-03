---
name: ctx-recovery-brief
description: |
  Low-level controlled RecoveryBrief provider protocol for a Trellis coordinator, or for an explicit user request to inspect, repair, force-refresh, or formally hand off recovery state. Use status and CAS updates only with confirmed semantic evidence. Do not use for ordinary compaction, PreCompact, PostCompact, SessionStart(compact), claimed checkpoints, or ordinary session resume. Trigger: /context-mode:ctx-recovery-brief
user-invocable: true
---

# RecoveryBrief

This is the low-level provider protocol. For a Trellis-managed project, the
normal caller is the project-local `trellis-recovery-brief-sync` skill at an
approved semantic workflow gate. Trellis owns task semantics and cross-session
task state; context-mode owns only Brief validation, CAS persistence, and
same-session checkpoint delivery.

Do not invoke this skill merely because a compact lifecycle ran, a
`SessionStart(compact)` occurred, a checkpoint was claimed, or a session
resumed. Those events never write a Brief and must remain independent of this
skill being loaded.

## Provider Protocol

1. Call `ctx_recovery_brief_status` before reading or changing state.
2. When status selects an active Trellis provider, update only that active
   task. Every fact must use `trellis_task` and exactly match current
   `trellisSourceSha256`.
3. Construct a complete v1 Brief from confirmed semantic evidence, then call
   `ctx_recovery_brief_update` with status `briefSha256` as `expected_sha256`.
   Use `"absent"` only when status reports no Brief.
4. Call `ctx_recovery_brief_status` again and report only the content-free result.

When status selects `trellis`, update only its active task. A valid Trellis
pointer is authoritative. If it reports drift, reconcile the active task and
refresh using the old `briefSha256` plus the new `trellisSourceSha256`. If it
reports invalid Trellis state, stop and repair it; never work around it with
project fallback.

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
- Never treat a transcript, FTS result, model memory, raw tool output, or Git diff as a substitute for confirmed project-semantic state.
- Never make checkpoint creation, confirmation, or compact-session delivery depend on this skill.
- Never claim that a status or checkpoint report measures model understanding, semantic recall, or task-continuation quality.

Read [the v1 reference](references/recovery-brief-v1.md) for field constraints,
provider selection, and error handling.
