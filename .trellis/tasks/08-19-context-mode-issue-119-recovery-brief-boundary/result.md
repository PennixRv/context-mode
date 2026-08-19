# Result: ROOT-ISSUE-119 RecoveryBrief Task Boundary

Date: 2026-08-19

## Status

Implementation and local release gates are complete for the `v1.0.191`
candidate. Source/evidence commits, annotated tag, CI, GitHub Release assets,
and root-side dynamic acceptance remain to be recorded after publication.

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
