# Fix RecoveryBrief MCP follow-ups and prepare release

## Goal

Fix the three locally reproduced MCP follow-up defects left after the execution-boundary work, preserve the established security contracts, and produce a release-ready `v1.0.183` candidate on the fork release line.

## Requirements

### 1. RecoveryBrief validation contract

- `ctx_recovery_brief_update` must publish the complete typed RecoveryBrief v1 input shape, including slot-specific priority literals, source-kind values, list bounds, timestamp shape, SHA-256 shape, and strict object fields.
- The checkpoint runtime remains the authoritative validator for every caller. MCP schema validation must not replace runtime validation.
- Runtime validation failures must retain the stable top-level `INVALID_RECOVERY_BRIEF` code and add a bounded, deterministic, content-free diagnostic that identifies the failing field and rule without returning the submitted fact value, source content, Brief body, prompt, or tool input.
- Shared constants and types must prevent the MCP schema, runtime parser, TypeScript interfaces, tests, and shipped reference from defining conflicting priorities or bounds.
- Existing provider selection, source provenance, compare-and-swap, fail-closed Trellis precedence, and no-indexing contracts must remain unchanged.

### 2. RecoveryBrief byte semantics

- `briefBytes` must have one documented meaning on update and status responses: the byte length of the persisted UTF-8 RecoveryBrief file, including its formatting and final newline.
- A successful update, an immediate status read, and filesystem metadata must report the same `briefBytes` value.
- `briefSha256` must continue to hash the canonical compact RecoveryBrief JSON so formatting-only file changes do not redefine the compare-and-swap identity.
- Absent or invalid Brief state must continue to report `briefBytes: null`.

### 3. `ctx_execute` test-fixture isolation

- Preserve the dot-prefixed `.ctx-mode-*` sandbox directory required by upstream Issue #186 and preserve the rule that hidden, protected, and Git-ignored source paths cannot be indexed.
- Test fixtures that must exercise an indexable project root must resolve a real host temporary directory independently of the child process's sandboxed `TMPDIR`.
- The fix must not make arbitrary hidden ancestors indexable, weaken per-file deny checks, persist test output to FTS5, or broaden compatibility-mode execution authority.
- A regression test and a real `ctx_execute` probe must cover the previously failing `tests/core/server-shared-handler.test.ts` path with a hidden sandbox `TMPDIR`.

### 4. Integration and release preparation

- Integrate the current branch with the latest `origin/devel` without rewriting the already delivered `08-10-harden-execution-project-boundary` commits.
- Bump the synchronized component manifests from `1.0.182` to `1.0.183` and regenerate all tracked release bundles from the final source tree.
- Follow the repository's fork release contract: `origin/devel` is the release line; `main` is not a local or release target.
- The repository's release workflow creates a GitHub Release and attached npm/offline marketplace archives. This task must not add or perform an npm registry publication.
- Any actual push, merge to `devel`, provider-authorized native preflight, evidence commit, annotated tag, tag push, or GitHub Release publication occurs only after the planning review explicitly authorizes that external release scope.
- Do not modify the parent `codex-workflow-optimization` repository, its Gitlink, `/home/penn/.codex`, Governance Plugin, sibling repositories, or other component worktrees.

## Acceptance Criteria

- [x] Invalid RecoveryBrief payloads are rejected with stable, bounded field/rule diagnostics and no submitted semantic content in direct runtime and MCP-facing tests.
- [x] The MCP tools/list schema exposes the complete strict RecoveryBrief v1 shape and correct priority literal for every slot.
- [x] Update, status, and persisted-file `briefBytes` values are equal; canonical digest and CAS behavior remain stable.
- [x] The shared-handler indexing suite passes when invoked through `ctx_execute` with `.ctx-mode-*` as `TMPDIR`, while hidden-path and Issue #186 regression tests remain green.
- [x] Targeted tests cover validation, byte semantics, schema projection, source secrecy, hidden-path exclusion, and host-temp resolution.
- [x] Full tests, typecheck, build, generated-bundle drift, release asset verification, version lockstep, and `git diff --check` pass.
- [x] Linux restricted-execution probes and cross-platform static/unit coverage remain green; platform-specific limitations are documented rather than inferred away.
- [x] The final implementation is committed on the task branch and the worktree is clean.
- [ ] When external release execution is approved, `v1.0.183` passes the disposable provider-authorized native preflight, immutable attestation verifier, annotated-tag ancestry gate, and GitHub Release workflow before publication is reported as successful.
- [ ] Final reporting distinguishes local implementation/validation, remote integration, GitHub Release publication, and the intentionally absent npm registry publication.

## Notes

- Baseline implementation HEAD: `7d55bba5c96cf68ad04f7f8670b7df393384293b` on `fix/issue-025-execution-boundary`.
- Latest observed fork release: `v1.0.182`, published from `devel` on 2026-08-04.
- After refreshing remote refs, `origin/devel` is `5149649888fb4be3be7dc3a6a7c4d4a74c2c9ab8`. It has three `stats.json`-only commits after the branch merge base and no changed-path overlap with the current branch.
- Detailed root-cause and release evidence is recorded under `research/`.
