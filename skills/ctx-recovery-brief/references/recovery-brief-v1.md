# RecoveryBrief v1 Reference

## Provider Selection

1. A valid active Trellis runtime pointer selects the Trellis provider.
2. With no Trellis runtime pointer, an explicitly initialized `.context-mode/recovery-provider.json` selects the project provider.
3. An invalid, stale, unsafe, or malformed Trellis pointer fails closed. It never falls back to the project provider.
4. Without either provider, checkpoints retain normal lifecycle behavior but have an absent semantic snapshot.

`local` project providers add `.context-mode/` to `.git/info/exclude`; they do
not modify tracked `.gitignore`. `tracked` providers are deliberately visible
for normal review and commit. Initialization creates the provider registration,
not a synthetic Brief.

## Brief Shape

The controlled update accepts exactly this versioned shape:

```json
{
  "schema_version": 1,
  "updated_at": "2026-07-31T00:00:00.000Z",
  "objective": {
    "value": "Finish the current task",
    "priority": "critical",
    "source_kind": "explicit_project_state",
    "source_sha256": "64 lowercase hexadecimal characters",
    "valid_at": "2026-07-31T00:00:00.000Z"
  },
  "hard_constraints": [],
  "decisions": [],
  "completed_work": [],
  "open_work": [],
  "latest_blocker": null,
  "next_action": null,
  "project_state": null
}
```

`objective` and both nullable critical fields use critical priority.
`hard_constraints` uses critical priority. `decisions`, `open_work`, and
`project_state` use important priority. `completed_work` uses optional priority.
Every fact has `value`, `priority`, `source_kind`, `source_sha256`, and
`valid_at`; lists contain at most 16 facts and the full serialized Brief is
bounded by 12,000 bytes.

Project-provider facts may use `explicit_project_state` only when their digest
matches one of the registered source files, or `git` when it matches the
current Git status digest. `trellis_task` is rejected for project providers.
Trellis-provider facts must all use `trellis_task` and exactly match the
content-free `trellisSourceSha256` returned by current provider status. That
digest covers the trusted active-task identity/state and recognized task
artifact hashes, never artifact bodies, transcripts, tool I/O, journals, FTS,
or Git diffs. It is a freshness binding for the Brief, not a semantic-quality
claim.

## Error Handling

`CAS_CONFLICT` means another update changed the live Brief. Read status again,
re-evaluate only current trusted evidence, and retry with the new digest.
`PROJECT_SOURCE_DRIFT` means registered evidence changed after registration;
do not overwrite it silently. An explicit update with refreshed `source_paths`
is required. `PROJECT_SOURCE_MISMATCH` means supplied facts do not match
registered evidence. `TRELLIS_RUNTIME_INVALID`, `TRELLIS_TASK_INVALID`, and
`TRELLIS_BRIEF_INVALID` require Trellis repair and do not permit fallback.

`TRELLIS_SOURCE_MISMATCH` means the requested Trellis write contains a
non-Trellis fact or a digest other than current `trellisSourceSha256`; it is
rejected before the Brief file changes. `TRELLIS_SOURCE_DRIFT` means trusted
active-task material changed after the last valid Brief write. The old Brief is
withheld from new checkpoint snapshots while normal checkpoint lifecycle work
continues. Status retains the old content-free `briefSha256` for CAS and
returns the new `trellisSourceSha256`; a Trellis coordinator may refresh the
complete Brief only after reconciling current Trellis task state.

Status and report APIs intentionally omit Brief text. They describe structural
availability and delivery only, not semantic quality.
