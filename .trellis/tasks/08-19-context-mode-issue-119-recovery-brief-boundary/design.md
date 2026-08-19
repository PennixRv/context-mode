# Design: Active Trellis RecoveryBrief Provider Boundary

## Architecture And Boundary

The repair remains inside `src/checkpoint/runtime.ts` and the existing typed
RecoveryBrief contract. A single internal active-task resolver will own the
trust decision used by Trellis evidence and RecoveryBrief provider resolution.
The public MCP handlers continue to call `getRecoveryBriefProviderStatus` and
`updateRecoveryBriefProvider`; no caller-side policy is treated as the
enforcement boundary.

The resolver has three stages:

1. Resolve a pointer only to a direct, ordinary child of the canonical
   `.trellis/tasks` directory.
2. Require a trusted regular `task.json` within that directory and parse it as
   an object.
3. Require `task.json.status` to be exactly `planning` or `in_progress`.

It returns either a trusted task directory, manifest, and parsed task object,
or a bounded failure category. It never returns task body content in status or
update results.

## Path Contract

The resolver canonicalizes the project root, verifies `.trellis`, `tasks`, and
the selected task as ordinary directories, and rejects symbolic-link task
directories. The selected path must have exactly one path component relative
to `.trellis/tasks`; `archive` is reserved and rejected. The resolver checks
both lexical containment and canonical containment so normalization or a
symbolic link cannot escape the direct-child boundary.

The selected `task.json` is checked relative to the trusted task directory,
not merely relative to the broader `.trellis` tree. Direct pointers to
`task.json` are not accepted because the provider contract selects a task
directory.

## Status And Error Contract

The active status set is a shared constant containing only:

```text
planning
in_progress
```

Resolution errors remain content-free:

| Condition | Error code | Provider task field |
| --- | --- | --- |
| Runtime file missing | project provider or `NO_PROVIDER`, preserving existing behavior | Existing behavior |
| Runtime file malformed or unsafe | `TRELLIS_RUNTIME_INVALID` | `absent` |
| Pointer/path/task manifest malformed or unsafe | `TRELLIS_TASK_INVALID` | `absent` |
| Trusted task with any non-active status | `TRELLIS_TASK_INACTIVE` | `absent` |
| Active task with malformed Brief | `TRELLIS_BRIEF_INVALID` | `active` |

An existing but invalid Trellis runtime remains a failed Trellis resolution,
so `resolveRecoveryBriefProvider` does not call the project-provider fallback.

## Read And Write Data Flow

```text
runtime pointer
  -> trusted runtime JSON
  -> canonical direct-child task resolver
  -> trusted task.json + active status
  -> task source digest and RecoveryBrief snapshot
  -> status/checkpoint read or CAS write
```

Status and update use the same `trellisProviderResolution`. The update path
stops before reading or writing a Brief when the resolution has no trusted
Brief path. Active tasks retain existing expected-SHA comparison, source hash
validation, canonical Brief digest, bounded serialization, and atomic rename.

`readTrellisEvidence` uses the same task resolver so an inactive or noncanonical
task is represented as stale/absent rather than active. This prevents the
checkpoint payload from contradicting the RecoveryBrief provider status.

## Compatibility

- The wire response schema is unchanged; only one new value is added to the
  existing `RecoveryBriefErrorCode` union.
- Active task Brief schema, source hashes, paths, and CAS semantics are
  unchanged.
- A task manifest without `status`, previously accepted accidentally, becomes
  invalid for provider selection. This is the intended fail-closed correction.
- Explicit project providers remain available only when no Trellis runtime
  pointer exists. Invalid Trellis state never falls through.

## Testing Strategy

The main matrix belongs in
`tests/checkpoint/recovery-brief-provider.test.ts` and calls both public status
and update functions. Positive cases cover both active statuses and repeated
CAS. Negative table cases assert stable errors, absent paths/digests, no file
creation, no project-provider fallback, and no content echo. A seeded Brief
case compares bytes and SHA-256 before and after a rejected update.

`tests/checkpoint/runtime.test.ts` covers Trellis evidence and checkpoint
snapshot behavior for inactive/noncanonical tasks. Existing capability,
schema, MCP contract, Hook, manifest, and release tests provide integration and
packaging regression coverage.

## Release And Rollback

The expected release is `v1.0.191`: source commit, direct-child attestation
commit, annotated tag, deterministic marketplace archive, and GitHub Release.
Rollback is to stop before pushing the tag if any gate fails. After publication,
rollback is a new patch release reverting the source change; the annotated tag
and published evidence are never moved or overwritten.

The component release does not install itself into the active Codex profile.
Root-side installation must use the Hook-aware Plugin transaction and a full
host restart before dynamic acceptance.
