---
name: trellis-recovery-brief-sync
description: |
  Synchronize the active Trellis task's controlled RecoveryBrief as the main
  coordinator at an approved semantic workflow gate: immediately after task
  activation before implementation, after a checked and recorded material
  semantic change, before explicit handoff/pause/finish/archive, or when the
  user explicitly requests inspection, repair, force refresh, or formal
  handoff. Do not use for ordinary edits, tests, diffs, compact events,
  SessionStart, claimed checkpoints, or ordinary session resume.
---

# Trellis Recovery Brief Sync

Use this project-local skill only as the main Trellis coordinator. Trellis task
artifacts and task state are the project-semantic authority. This skill turns
their confirmed current state into a controlled, replaceable RecoveryBrief;
context-mode only supplies the status and atomic CAS provider protocol.

## Approved Gates

Run the status-first protocol at exactly these gates:

1. Immediately after an approved `task.py start`, before the first
   implementation step.
2. After `trellis-check` confirms a material semantic change and that change
   is recorded in the active task's trusted material.
3. Before an explicit handoff, pause preparation, finish, or archive.
4. When the user explicitly asks to inspect, repair, force-refresh, or create
   a formal handoff.

Do not invoke this skill for ordinary edits, tests, diffs, regular compact
events, `PreCompact`, `PostCompact`, `SessionStart(compact)`, checkpoint
`claimed`, or an ordinary resumed session. Those events either carry
same-session transport or orientation only; they do not establish a new
project-semantic fact.

## Synchronization Protocol

1. Call `ctx_recovery_brief_status` for the current attributed session.
2. If status selects a valid active Trellis provider and reports an available,
   non-drifted Brief that already represents current confirmed state, report
   the content-free status and do not write.
3. For an absent or drifted Trellis Brief, read only the current active task's
   trusted `task.json`, `prd.md`, `design.md`, `implement.md`, and `check.md`
   as applicable. Distill confirmed semantic facts; do not treat a transcript,
   FTS result, raw tool I/O, full artifact body, or Git diff as authority.
4. Build a complete RecoveryBrief. Every fact must use
   `source_kind: "trellis_task"` and the current status
   `trellisSourceSha256`. Keep values concise and evidence-backed. Exclude
   credentials, PII, raw tool data, transcript text, full artifacts, and
   task-body copies.
5. Call `ctx_recovery_brief_update` with `expected_sha256` equal to status
   `briefSha256`, or `"absent"` only when status reports no Brief. Report only
   the content-free update result, then call status once more to confirm.

## Error Handling

- `TRELLIS_SOURCE_DRIFT`: reconcile the changed active Trellis material, use
  the new `trellisSourceSha256`, and refresh with the old status
  `briefSha256` as CAS input. Do not project or reconstruct the stale Brief.
- `CAS_CONFLICT`: reread status, re-evaluate current Trellis material, and
  retry only with the newly reported Brief hash.
- `TRELLIS_RUNTIME_INVALID`, `TRELLIS_TASK_INVALID`, or
  `TRELLIS_BRIEF_INVALID`: repair the Trellis state. Never bypass an invalid
  Trellis pointer with a project provider.
- `NO_PROVIDER`: do not initialize a project provider from this skill. That
  fallback is permitted only when no Trellis pointer exists and the user
  explicitly asks for a project-local provider.

## Authority Boundaries

- Only the main coordinator may run this synchronization protocol.
- Implementation and check workers report verified findings to the coordinator;
  they do not write or refresh Briefs.
- Checkpoint hooks retain their own fail-open lifecycle and never call this
  skill, write a Brief, or mutate Trellis task material.
- This skill supplies bounded context only. It does not determine how a
  conversation proceeds after compaction.
