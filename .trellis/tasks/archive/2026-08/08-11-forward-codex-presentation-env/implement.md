# Implementation Plan: Codex Presentation Environment Forwarding

## Preconditions

- [x] Confirm clean baseline `f13ee081296c3bc96404c551cdeecbb110c8643c` on
  `devel`, including local `origin/devel` and remote `refs/heads/devel`.
- [x] Create task `08-11-forward-codex-presentation-env` and branch
  `fix/issue-054-codex-plugin-env-forwarding` from that exact commit.
- [x] Reproduce host `64/64/16/0/160`, MCP unset values, and
  365-character source `preview=240` without printing sensitive environment.
- [x] Confirm `1.0.185` and `v1.0.185` are currently unoccupied; repeat before
  release because availability is time-sensitive.

## Implementation

1. Add one shared test-only expected list for the five presentation variable
   names and extend source manifest assertions to require exact `env_vars`,
   fixed platform `env`, and absence of credentials, broad names, and budget
   values.
2. Add a failing marketplace test that builds and extracts the archive, verifies
   the payload manifest and its `CONTENT-MANIFEST.json` entry, and compares the
   exact list with source.
3. Extend the offline release verifier to compare source, extracted, installed,
   and normalized `codex mcp list --json` forwarding contracts while preserving
   its real installation and initialize probes.
4. Add a manifest-driven real stdio MCP test for the absent/default and
   `64/64/16/0/160` parent environments. Assert environment observation,
   365-character source preview sizes, audit metadata, visible fenced source,
   and complete response characters/lines.
5. Add exactly the five names to `.codex-plugin/mcp.json`; retain only
   `CONTEXT_MODE_PLATFORM=codex` in fixed `env`. Do not edit presentation policy
   defaults, other platform manifests, or execution policy.
6. Update README/platform documentation and
   `.trellis/spec/backend/restricted-execution-and-presentation.md` with the
   Codex forwarding and regression contract.
7. Build generated bundles only through the repository build command and review
   every generated diff. No source change is expected to require new runtime
   bundle behavior; any unrelated drift is a blocker.

## Focused Verification

Run the relevant Vitest files, including:

- `tests/plugins/codex-manifest.test.ts`
- the new real stdio forwarding test
- `tests/scripts/codex-release-asset.test.ts`
- `tests/codex/marketplace-layout.test.ts`
- `tests/presentation-policy.test.ts`
- `tests/core/echo-commands.test.ts`
- `tests/core/restricted-execution-server.test.ts`
- `tests/executor/restricted-boundary.test.ts`

Repeat the real stdio probe independently and record both return sizes. Run
`git diff --check` and inspect the complete changed-file list before broad
validation.

## Full Verification

1. `npx --yes pnpm@10.23.0 run typecheck`
2. `npx --yes pnpm@10.23.0 run build`
3. All repository `assert-bundle` checks and `assert-asymmetric-drift` through
   the build script.
4. `npx --yes pnpm@10.23.0 run test`
5. `node scripts/build-codex-marketplace-bundle.mjs --output-dir <fresh-dir>`
6. `node scripts/verify-codex-release-asset.mjs <fresh-archive>`
7. Build twice from clean, isolated output directories and compare archive,
   content-manifest, and generated bundle SHA-256 values.
8. Validate task context and run the Trellis check workflow before commits.

The repository has no independent lint script; typecheck, build-time bundle
checks, focused/full tests, and `git diff --check` are the applicable gates.

## Commit And Release Sequence

1. Commit implementation, tests, documentation, spec, and task evidence.
2. Recheck remote `devel`, branch ancestry, worktree cleanliness, package
   version, and local/remote `v1.0.185` availability. Stop on any collision.
3. Synchronize `1.0.185` with the repository's existing npm version lifecycle;
   review the exact manifest set and commit release preparation.
4. Complete source validation, task result, and archive so the resulting exact
   commit is the release source commit; push it to `devel` and wait for required
   CI where the existing workflow requires it.
5. Run the provider-authorized Codex native release preflight against that exact
   clean source commit using a disposable mode-`0600` projection outside the
   repository. Do not print credentials or modify `/home/penn/.codex`.
6. Commit only `docs/releases/attestations/v1.0.185.json` as the direct child
   evidence commit.
7. Build and verify the deterministic asset; create the exact annotated tag
   message; run native-attestation and fork-release-ref validators.
8. Push the evidence commit first, then push only the new annotated tag. Never
   force or overwrite a tag.
9. Wait for the Release workflow and all required CI to complete. Download all
   assets into a fresh directory, verify every SHA-256 and offline install, and
   confirm npm `latest` did not change.
10. Record release evidence in the archived task, commit/push that metadata,
    wait for final branch checks, remove temporary files, and confirm
    `git status --short` is empty.

## Rollback Points

- Test or implementation failure: revert only scoped work on the fix branch.
- Versioned but untagged failure: revert the version/source commits or prepare a
  corrected source commit; all evidence must be regenerated from the new source.
- Local unpushed tag failure: resolve its exact object, remove only that local
  candidate tag, then regenerate. Never delete or overwrite a remote tag.
- Published failure: keep the release immutable and prepare a new patch.
- At every point, installed Plugin cache, normal Codex configuration, parent
  repository, Gitlink, Governance Plugin, sibling components, and credentials
  remain outside the write boundary.
