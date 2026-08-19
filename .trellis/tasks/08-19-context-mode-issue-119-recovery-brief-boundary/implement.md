# Implementation Plan: Issue 119 RecoveryBrief Boundary

## 1. Baseline And Reproduction

- [x] Confirm clean component baseline and inspect remote `devel`.
- [x] Fast-forward to `384cb779574812d4aea7883d5b2d20cdc5918e8a`.
- [x] Confirm `v1.0.191` is unused locally, remotely, and in GitHub Releases.
- [x] Reproduce `completed` task status as `trellis/available/active/NONE` and
  successful RecoveryBrief creation in an isolated temporary fixture.
- [x] Record component/root ownership and the no-install boundary.

## 2. Regression Tests First

- [x] Update active fixture helpers to require an explicit `planning` or
  `in_progress` status.
- [x] Add status/update positive cases for both active statuses and repeated
  CAS.
- [x] Add table-driven inactive-status cases for completed, archived,
  cancelled, blocked, missing, empty, unknown, and non-string values.
- [x] Add malformed/missing manifest, archive, nested, non-task, direct-file,
  missing, non-directory, and symbolic-link path cases.
- [x] Add existing-Brief immutability and explicit project-provider
  non-fallback cases.
- [x] Add Trellis evidence/checkpoint snapshot regression cases.
- [x] Run the new targeted tests against the old implementation and retain the
  expected failures in task results.

## 3. Runtime Contract

- [x] Add `TRELLIS_TASK_INACTIVE` to the typed error union.
- [x] Replace the broad path containment helper with a shared canonical
  direct-child task resolver.
- [x] Parse runtime JSON, task manifest, and task status in separately
  classified failure stages.
- [x] Use the resolver from both `readTrellisEvidence` and
  `trellisProviderResolution`.
- [x] Preserve project-provider fallback only for an absent runtime pointer.
- [x] Verify rejected resolutions have no Brief path/source digest and stop the
  update before any filesystem write.

## 4. Documentation And Generated Assets

- [x] Update the backend RecoveryBrief specification with the direct-child and
  active-status contract.
- [x] Add `docs/releases/codex-v1.0.191.md` with ROOT-ISSUE-119 scope and root
  acceptance ownership.
- [x] Bump version manifests to `1.0.191` through the repository version-sync
  command.
- [x] Rebuild and commit generated bundles; confirm no unrelated manifest or
  presentation-policy drift.
- [x] Record implementation files, exact commands, counts, and residual risks
  in `results.md`.

## 5. Quality Gates

- [x] Run focused RecoveryBrief provider, runtime, capability, schema, contract,
  MCP/server, Hook, manifest, version-sync, and release-asset tests.
- [x] Run `typecheck`, build, bundle assertions, asymmetric drift, syntax
  checks, `git diff --check`, and the complete project test command.
- [x] Run Trellis task validation and document structure checks.
- [x] Build the Codex marketplace twice and prove byte-for-byte reproducibility.
- [x] Verify offline Plugin installation, MCP initialization, manifest entries,
  and environment forwarding without modifying the active profile.

## 6. Commit And Release

- [ ] Commit the source candidate on the issue branch with a clean worktree.
- [ ] Integrate the source candidate into the latest `devel` using the
  repository's existing non-destructive branch flow and rerun required gates.
- [ ] Reconfirm `v1.0.191` and the remote tag are unused.
- [ ] Run the Codex native release preflight with the approved local provider
  projection outside the repository and no credential output.
- [ ] Commit only `docs/releases/attestations/v1.0.191.json` as the direct-child
  evidence commit.
- [ ] Create and verify the annotated tag with content-manifest and native
  attestation metadata.
- [ ] Push the release branch before the tag, wait for Release CI, and download
  every asset for independent SHA-256 verification.
- [ ] Do not claim npm registry publication unless the existing workflow
  actually publishes it.

## 7. Root Handoff

- [ ] Report task path, baseline, source/evidence commits, tag object, peeled
  commit, version, asset hashes, tests, runtime versions, and clean status.
- [ ] Provide Hook-aware installation and full-restart requirements without
  performing them in this component session.
- [ ] Provide root-side positive `planning`/`in_progress` and negative
  completed/archive/path probes for both status and update.
- [ ] State that ROOT-ISSUE-119 remains root-owned until dynamic acceptance.
