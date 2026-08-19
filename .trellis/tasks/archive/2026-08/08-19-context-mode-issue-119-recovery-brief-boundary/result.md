# Result: ROOT-ISSUE-119 RecoveryBrief Task Boundary

Date: 2026-08-19

## Status

Component implementation, verification, and publication are complete as
`v1.0.191`. The source candidate, direct-child evidence commit, annotated tag,
three-platform CI, GitHub Release workflow, downloaded assets, and offline
installation were independently checked. ROOT-ISSUE-119 remains root-owned
until the integration workflow installs this release, fully restarts Codex,
and completes positive and negative dynamic acceptance.

## Root Cause

`safeTaskPath` accepted any canonical target under `.trellis`, while
`trellisProviderResolution` treated any parseable `task.json` as active. It did
not require a direct child of `.trellis/tasks` or inspect `task.json.status`.
The public CAS update consumed that broad decision and could therefore write a
RecoveryBrief for a completed or noncanonical task. `readTrellisEvidence`
duplicated the same incomplete trust decision.

## Baseline Evidence

- Reviewed release: `v1.0.190`
- Reviewed release commit: `547851d4109396b4729e83723b815265a9599128`
- Task baseline: `384cb779574812d4aea7883d5b2d20cdc5918e8a`
- Isolated reproduction: `status=completed` reported
  `trellis/available/active/NONE`; update returned `ok=true` and created
  `recovery-brief.json`.
- Regression tests against the old implementation: 2 files failed, 12 tests
  failed and 41 passed (53 total). Failures covered inactive statuses,
  noncanonical paths, existing-Brief protection, project-provider non-fallback,
  and checkpoint evidence.

All temporary fixtures were removed. No real task, Brief, checkpoint database,
profile, credential, cache, or session body was used.

## Implementation

- `src/checkpoint/runtime.ts`: shared canonical active-task resolver for
  provider status, checkpoint evidence, and updates; direct-child ordinary
  directory enforcement; exact active-status set; write-time task/source/CAS
  revalidation.
- `src/checkpoint/types.ts`: content-free `TRELLIS_TASK_INACTIVE` diagnostic.
- `tests/checkpoint/recovery-brief-provider.test.ts`: active CAS positives,
  inactive status matrix, invalid path/manifest matrix, symlink and escape
  cases, byte/SHA immutability, and no project-provider fallback.
- `tests/checkpoint/runtime.test.ts`: inactive task evidence and checkpoint
  RecoveryBrief exclusion.
- `tests/hooks/codex-recovery-identity.test.ts`: fixture corrected to use the
  real Trellis `in_progress` status.
- `.trellis/spec/backend/codex-trellis-recovery-boundaries.md`: executable
  direct-child/status/error/CAS contract.
- `docs/releases/codex-v1.0.191.md`: component release and root acceptance
  boundary.
- Version manifests and generated `server`, `cli`, and checkpoint Hook bundles
  are synchronized at `1.0.191`.

## Verification To Date

```text
Pre-fix focused regression
  EXPECTED FAIL; 2 files, 12 failed, 41 passed (53 total)

Post-fix provider/runtime/identity regression
  PASS; 3 files, 62 tests

Expanded RecoveryBrief/Hook/MCP/release matrix
  PASS; 13 files, 141 tests

Full project test (final source candidate)
  PASS; 243 files, 5,201 passed, 41 skipped (5,242 total)

node scripts/run-pnpm.mjs run typecheck
  PASS

node scripts/run-pnpm.mjs run build
  PASS; TypeScript build, nine bundle assertions, asymmetric drift

Hook syntax
  PASS; every hooks/*.mjs|cjs and .codex/hooks/session-start.py

Marketplace consecutive builds
  PASS; archive and checksum sidecar byte-identical
  archive SHA-256:
  4b9c5e3a8b9acef73f2104a65d5d1cff41685a15f4341b395c838cfcb39e35b8
  CONTENT-MANIFEST SHA-256:
  078907878fd66f433910c52e6cedeafb6e8e540f6ed69f3e2e200bde250a15be

Offline marketplace verifier
  PASS; 125 manifest entries, exact eight env_vars, isolated install,
  normalized MCP registration, and real stdio initialize probe

git diff --check and unchanged unrelated bundle assertions
  PASS
```

This repository has no independent format or lint script; TypeScript, build,
deterministic asset, syntax, drift, and test gates are the project-defined
equivalents.

## Boundary Results

- `planning` and `in_progress`: provider available; initial and repeated CAS
  succeed with unchanged schema/digest semantics.
- Non-active/missing/unknown/type-invalid status: content-free
  `TRELLIS_TASK_INACTIVE`; no path, source digest, file creation, or overwrite.
- Invalid path, manifest, direct file, nested/archive/non-task target,
  non-directory, task symlink, external symlink escape, or symlink manifest:
  `TRELLIS_TASK_INVALID`; no write.
- Present invalid Trellis state plus project provider: Trellis failure remains
  authoritative; no fallback.
- Inactive task checkpoint evidence: stale/absent task and invalid Trellis
  RecoveryBrief snapshot; no semantic body captured.

## Residual Risks And Ownership

- The check-before-atomic-rename sequence narrows but cannot eliminate every
  filesystem race without OS-level task locking. Trusted path/source/CAS state
  is revalidated immediately before write; atomic rename and ordinary-file
  checks remain in force.
- Existing installed Plugin caches remain unchanged until root workflow installs
  the published patch and fully restarts Codex.
- ROOT-ISSUE-119 remains root-owned until the integration workflow runs real
  positive and negative status/update probes against the new process.
- No root repository file, `/home/penn/.codex`, active Plugin cache, or root
  Issue status is modified by this task.

## Published Release Evidence

- Version: `1.0.191`
- Release branch: `devel`
- Core implementation commit: `e4523b80dfa4d2dbcb4bdbc7258bc7c5117bc4e5`
- Final source-candidate test portability commit: `d09d8ebd616d91ff49e0e67f8fb8545d23b5f311`
- Source candidate: `d09d8ebd616d91ff49e0e67f8fb8545d23b5f311`
- Evidence commit: `6ab1349ad9d0bfe77c8ed2f571671eebed6cd522`
- Evidence parent: `d09d8ebd616d91ff49e0e67f8fb8545d23b5f311`
- Annotated tag: `v1.0.191`
- Tag object: `e25c0b70842fa73a438da6df2efdfdec87a6fbb2`
- Peeled commit: `6ab1349ad9d0bfe77c8ed2f571671eebed6cd522`
- Release workflow: `32230149051`, passed
- Source CI: `32228724532`, passed on Ubuntu, macOS, Windows, and the Codex
  offline marketplace job
- Evidence CI: `32229565535`, passed on Ubuntu, macOS, Windows, and the Codex
  offline marketplace job
- Evidence OpenClaw E2E: `32229565524`, passed
- Native preflight: Node `26.6.0`, Codex CLI `0.146.0`, manual and automatic
  checkpoints each reached `pending -> confirmed -> claimed`

Downloaded GitHub Release assets:

```text
CONTENT-MANIFEST.json
  078907878fd66f433910c52e6cedeafb6e8e540f6ed69f3e2e200bde250a15be
context-mode-1.0.191.tgz
  d0e2986188d133f075a9f5565aabac383fc202ec0bd8606ddfc1fa53d3ac4ac3
context-mode-codex-marketplace-v1.0.191.tar.gz
  4b9c5e3a8b9acef73f2104a65d5d1cff41685a15f4341b395c838cfcb39e35b8
context-mode-codex-marketplace-v1.0.191.tar.gz.sha256
  a250ebf948bd7f84f1ada6508b0503ef3146fbcf52a4c535d94e314e5b1481c8
```

The downloaded checksum sidecar passed `sha256sum -c`; the downloaded
marketplace archive passed `verify-codex-release-asset.mjs`, initialized the
real stdio MCP process, and reported 125 content-manifest entries. The npm
registry remains at `1.0.169`; this release workflow publishes GitHub and Codex
marketplace assets, not npm.

## Root Acceptance Handoff

1. In the root integration workflow, use `$codex-plugin-update` to install the
   `context-mode@context-mode` Plugin at `1.0.191`. The Hook-aware installation
   transaction must be the old session's final tool call.
2. Fully exit and restart the Codex host. Do not continue acceptance in the
   process that performed the update.
3. Confirm the installed Plugin and MCP runtime both report `1.0.191`, and
   confirm the installed `hooks/checkpoint.bundle.mjs` SHA-256 matches the
   release content manifest.
4. For canonical direct-child tasks with `status=planning` and
   `status=in_progress`, call provider status and perform an initial plus
   repeated controlled CAS update. Expect `provider=trellis`,
   `health=available`, `task=active`, `errorCode=NONE`, stable source binding,
   and valid expected-SHA behavior.
5. In disposable root-owned fixtures, repeat status and update for
   `completed`, `archived`, `cancelled`, `blocked`, missing, empty, unknown,
   and non-string status values. Expect `TRELLIS_TASK_INACTIVE`, no fabricated
   Brief path/source digest, no file creation, and no overwrite.
6. Repeat with archive, nested, non-task, direct-manifest, missing,
   non-directory, task-symlink, and external-symlink pointer targets. Expect
   `TRELLIS_TASK_INVALID`, no project-provider fallback, and no write.
7. Preserve and compare exact existing Brief bytes and SHA-256 around every
   rejected update. Only after these installed-process checks pass should the
   root workflow update its Gitlink or close ROOT-ISSUE-119.
