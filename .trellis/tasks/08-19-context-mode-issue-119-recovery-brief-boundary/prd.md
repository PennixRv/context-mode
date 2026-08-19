# Harden RecoveryBrief Trellis Task Boundary

## Goal

Close ROOT-ISSUE-119 in the context-mode component by making the Trellis
RecoveryBrief provider fail closed unless the current runtime pointer selects a
canonical, trustworthy, active Trellis task. Preserve the existing schema,
source digest, and compare-and-swap behavior for legitimate `planning` and
`in_progress` tasks, then publish a verified patch release for root-side
installation and dynamic acceptance.

## Background

The v1.0.190 implementation in `src/checkpoint/runtime.ts` resolves a runtime
pointer with `safeTaskPath`, checks only that the resolved path remains below
`.trellis`, reads any parseable `task.json`, and reports the Trellis provider as
`available` with `task=active`. It does not require the task path to be the
single directory `.trellis/tasks/<task>` or require `task.json.status` to be
active. `updateRecoveryBriefProvider` consumes the same resolution and can
therefore write a RecoveryBrief for a completed task.

The pre-fix isolated reproduction on baseline
`384cb779574812d4aea7883d5b2d20cdc5918e8a` used
`.trellis/tasks/task-1` with `status=completed`. Status returned
`trellis/available/active/NONE`, the update returned `ok=true`, and
`recovery-brief.json` was created. The bounded fixture was deleted after the
probe.

## Requirements

### R1. Canonical Trellis Task Path

- A Trellis runtime pointer is eligible only when it identifies exactly one
  ordinary directory directly below `.trellis/tasks/`.
- Accept existing canonical pointer spellings needed by Trellis, including the
  project-relative `.trellis/tasks/<task>`, Trellis-relative `tasks/<task>`,
  bare task directory name, and an absolute path that resolves to the same
  canonical direct child.
- Reject paths outside `tasks/`, direct `task.json` pointers, extra nesting,
  `tasks/archive` and descendants, missing or non-directory targets, symbolic
  link task directories, symbolic link escape, and unprovable paths.
- Require `task.json` to be a readable, non-symbolic-link regular file inside
  the selected task directory.

### R2. Active Task Status

- Require the literal `task.json.status` value to be exactly `planning` or
  `in_progress` before the task can be reported as active or selected as a
  RecoveryBrief provider.
- Reject `completed`, `archived`, `cancelled`, `blocked`, missing, empty,
  unknown, and non-string status values.
- Represent a trustworthy task with a non-active status using the stable,
  machine-readable error code `TRELLIS_TASK_INACTIVE`; continue to use
  `TRELLIS_TASK_INVALID` for path or task manifest failures.

### R3. Shared Fail-Closed Resolution

- `readTrellisEvidence`, `getRecoveryBriefProviderStatus`, checkpoint snapshot
  selection, and `updateRecoveryBriefProvider` must share the same canonical
  path and active-status decision rather than duplicating partial checks.
- If a runtime pointer exists but its runtime file, task path, task manifest,
  or task status is invalid, return a Trellis failure. Do not fall back to an
  explicitly configured project provider.
- Invalid or inactive resolutions must not expose a Brief path, source digest,
  forged active state, or semantic file content.

### R4. Write Protection And Compatibility

- A rejected status or path must not create `recovery-brief.json`.
- A rejected update must not modify an existing `recovery-brief.json`; content
  and SHA-256 must remain identical.
- Preserve successful initial and subsequent CAS updates for both `planning`
  and `in_progress` tasks, including digest calculation, source binding,
  formatting-insensitive Brief identity, byte reporting, and conflict behavior.
- Do not modify task state, archive or delete tasks, weaken RecoveryBrief
  validation, or turn RecoveryBrief into a Codex compaction fallback.

### R5. Component Delivery

- Update component-owned tests, backend specification, release notes, generated
  bundles, version manifests, and release evidence as required by the existing
  release process.
- Publish the next unused stable patch version, currently expected to be
  `v1.0.191`, from the repository's required release branch and annotated-tag
  evidence chain.
- Do not modify or install into the parent integration repository,
  `/home/penn/.codex`, Plugin cache, sibling components, or root Issue state.

## Acceptance Criteria

- [x] `planning` and `in_progress` canonical tasks each report
  `provider=trellis`, `health=available`, `task=active`, `errorCode=NONE`, and
  complete valid CAS writes.
- [x] `completed`, `archived`, `cancelled`, `blocked`, missing, empty, unknown,
  and non-string statuses report `TRELLIS_TASK_INACTIVE` and cannot create or
  update a RecoveryBrief.
- [x] Malformed or missing `task.json` reports `TRELLIS_TASK_INVALID` and cannot
  write.
- [x] Archive, nested, non-`tasks`, direct-file, missing, non-directory, and
  symbolic-link pointer fixtures fail closed through both status and update
  entry points.
- [x] An invalid Trellis runtime pointer remains authoritative failure even
  when an explicit project provider exists; project-provider content is not
  selected or exposed.
- [x] Rejected updates preserve the exact bytes and SHA-256 of an existing
  RecoveryBrief.
- [x] Checkpoint and Trellis evidence surfaces do not label rejected tasks as
  active or capture their Brief as an available recovery snapshot.
- [x] Targeted unit/integration tests, typecheck, build, generated-bundle drift,
  full tests, deterministic marketplace build, offline installation, native
  release preflight, and immutable release attestation checks pass.
- [ ] The stable GitHub Release is published with verified assets and SHA-256
  values; the component branch and release branch are clean and synchronized.
- [ ] The final report gives root-side install/restart commands and positive
  and negative dynamic acceptance cases without claiming the root Issue is
  closed before that independent acceptance.

## Out Of Scope

- Changing Codex native compaction or adding remote/local compaction fallback.
- Generating Trellis task facts, changing task lifecycle states, or repairing
  stale runtime pointers automatically.
- Modifying root repository governance, root Issue files, the parent Gitlink,
  `/home/penn/.codex`, or any installed Plugin cache.
- Closing ROOT-ISSUE-119 from the component session.

## External Ownership

The root integration workflow owns installation of the released Plugin,
complete Codex restart, dynamic positive/negative provider probes, Gitlink
update, and final ROOT-ISSUE-119 disposition.
