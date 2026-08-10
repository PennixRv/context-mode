# Implementation Plan: RecoveryBrief MCP Follow-Ups And v1.0.183

## Preconditions

- [x] User approves `prd.md`, `design.md`, and this plan.
- [x] Run `python3 ./.trellis/scripts/task.py start 08-10-fix-recovery-brief-mcp-followups` only after approval.
- [x] Load `trellis-before-dev`, read applicable backend/guides specs, and synchronize the controlled RecoveryBrief at the post-activation semantic gate.
- [x] Reconfirm branch `fix/issue-025-execution-boundary`, baseline `7d55bba5c96cf68ad04f7f8670b7df393384293b`, refreshed `origin/devel`, and a worktree containing only this task's planning artifacts.

## Phase A: RecoveryBrief contract and diagnostics

- [x] Add shared typed source-kind, slot-priority, and bound constants without introducing Zod into the checkpoint runtime bundle.
- [x] Add a strict exported RecoveryBrief v1 Zod schema and use it for `ctx_recovery_brief_update.brief`.
- [x] Replace the misleading minimal tool example with a complete minimal valid Brief.
- [x] Refactor runtime parsing to return a deterministic content-free validation issue while preserving the existing nullable internal parser contract.
- [x] Add optional `validationIssue` to invalid update results only; keep `INVALID_RECOVERY_BRIEF` as the stable provider error code.
- [x] Add direct runtime tests for missing/extra fields, wrong priority, invalid source kind/digest/timestamp, control/byte/list/aggregate bounds, deterministic issue order, and absence of submitted sentinel text.
- [x] Add MCP schema projection tests for required fields, strict objects, slot-specific literals, source kinds, list maximums, and a valid minimal payload.

Rollback point: targeted RecoveryBrief tests must pass before changing provider byte reporting.

## Phase B: byte semantics

- [x] Carry persisted valid-file bytes through Trellis and project provider resolution.
- [x] Map status `briefBytes` from persisted file bytes and retain `null` for absent/invalid/drifted state.
- [x] Assert successful update bytes equal immediate status bytes and `statSync(...).size` for both provider kinds.
- [x] Assert canonical digest remains equal for semantically identical compact and pretty file representations and CAS behavior is unchanged.

Rollback point: provider tests and checkpoint snapshot tests must pass before temporary-directory work.

## Phase C: executor-aware test fixtures

- [x] Extract the existing host-temp resolution into a reusable utility with no behavioral change to `.ctx-mode-*` creation, child `TMPDIR`, or cleanup.
- [x] Move only indexable outer fixtures in the shared-handler suite to the resolved host temp.
- [x] Add POSIX hidden-`TMPDIR` regression coverage and retain Windows temp/cleanup tests.
- [x] Run the shared-handler suite through the real `ctx_execute` MCP with its default hidden sandbox `TMPDIR`; record the returned temp basename and pass counts in task results.
- [x] Confirm direct hidden paths and descendants of hidden ancestors are still rejected by `ctx_index`/directory walking.

Rollback point: Issue #186, executor environment, store-directory isolation, and shared-handler tests must all pass together.

## Phase D: quality gate and source integration

- [x] Run focused tests:

```bash
node scripts/run-pnpm.mjs exec vitest run \
  tests/checkpoint/recovery-brief-provider.test.ts \
  tests/checkpoint/recovery-brief-contract.test.ts \
  tests/hooks/codex-recovery-identity.test.ts \
  tests/core/server-shared-handler.test.ts \
  tests/store-directory.test.ts \
  tests/executor.test.ts \
  tests/executor/win-sandbox-782-788.test.ts \
  tests/scripts/version-sync.test.ts \
  tests/scripts/release-workflow-contract.test.ts
```

- [x] Load and execute `trellis-check`; resolve all findings in the main session.
- [x] Run `node scripts/run-pnpm.mjs run typecheck`.
- [x] Run `node scripts/run-pnpm.mjs run build` and commit every required tracked bundle.
- [x] Run `node scripts/run-pnpm.mjs test` and record file/test/pass/skip totals.
- [x] Run `git diff --check` and the bundle/asymmetric-drift assertions.
- [x] Build an npm pack and Codex marketplace archive in a fresh temporary directory; run `verify:codex-marketplace` and record archive/content-manifest digests without publishing.
- [x] Merge refreshed `origin/devel` into the task branch without rebasing and rerun focused tests, typecheck, build drift, and full tests on the integrated tree.

## Phase E: spec, task result, version, and clean source commit

- [x] Load `trellis-update-spec` and record only durable contracts: RecoveryBrief validation diagnostics/byte semantics and hidden executor-temp test-fixture guidance.
- [x] Write the task result with changed files, exact validation totals, real MCP probe evidence, platform coverage, and residual risks.
- [x] Commit the implementation and task evidence with clear English commit messages.
- [x] Synchronize all manifests to `1.0.183` using the repository version lifecycle, rebuild bundles, and run version-lockstep/release-contract tests.
- [x] Run the complete quality gate again from the final versioned tree.
- [x] Run `trellis-finish-work`, archive the task, commit the archived task state, and confirm the clean final source commit contains no attestation file.

Release-ready checkpoint: report the source commit, `git status --short`, validation totals, and exact remaining external actions. Stop here unless actual remote publication was explicitly approved.

## Phase F: optional authorized v1.0.183 publication

- [ ] Confirm a mode-`0600` provider projection outside this repository and inherited provider authorization are available; do not read or copy normal profile state.
- [ ] Fast-forward local `devel` to the clean final source commit.
- [ ] Run the disposable native release preflight for `v1.0.183` from that exact commit and verify manual plus host-driven automatic `pending -> confirmed -> claimed` evidence.
- [ ] Verify the generated attestation contains no provider material, prompt, payload, tool I/O, or task bodies.
- [ ] Commit only `docs/releases/attestations/v1.0.183.json` as the direct evidence child.
- [ ] Build the deterministic marketplace archive and obtain the exact `CONTENT-MANIFEST.json` digest.
- [ ] Create an annotated `v1.0.183` tag on the evidence commit with exactly one content-manifest digest line and one native-attestation metadata line.
- [ ] Validate tag form, annotation type, package-version match, evidence-only child shape, and reachability against the proposed `devel` tip before any push.
- [ ] Push `devel`, then push only `v1.0.183`; do not push other branches or tags.
- [ ] Monitor the Release workflow through completion and verify the GitHub Release assets/digests.
- [ ] Confirm npm registry latest remains intentionally unchanged because this fork workflow does not publish npm.
- [ ] Report source commit, evidence commit, tag object/target, remote `devel`, workflow URL/result, release URL/assets, and clean worktree.

## Stop Conditions

- Any submitted semantic content appears in a validation diagnostic.
- MCP JSON Schema loses nested fields or strict-client compatibility.
- Hidden/protected/Git-ignored paths become indexable.
- Canonical Brief digest changes solely because of formatting.
- Full tests, build, bundle drift, archive verification, or real MCP probe fails.
- `origin/devel` gains unreviewed overlapping changes after the integration check.
- Provider projection/privacy validation or native preflight is unavailable.
- The evidence commit contains any path other than `docs/releases/attestations/v1.0.183.json`.
- Tag metadata or content-manifest digest cannot be reproduced exactly.
