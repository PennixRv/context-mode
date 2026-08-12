# Implementation Plan

Expected implementation branch: `fix/context-mode-open-issues-convergence`

Expected release: next free stable patch after `v1.0.186` (currently
`v1.0.187`), published from `devel` using the existing source/evidence topology.

## Phase 1: Bind And Capture Baseline Failures

1. Run `task.py start`, create the implementation branch from the verified
   `devel` baseline, and commit the approved Trellis preparation artifacts
   without product source.
2. Add focused regression tests for all remaining defects before product fixes:
   matcher inventory/dispatch count, routing matrix, downgrade/channel
   diagnostics, default non-persistence, external file access, archived probe
   root/stderr, and compound batch status/query behavior.
3. Run those tests against baseline behavior and save bounded failing evidence
   under this task's `research/` directory. For Issue 003, record that the
   parent regex-only duplicate premise does not reproduce under current Codex
   exact semantics while the defensive disjoint-inventory test initially fails.

## Phase 2: Hook And Routing Contract

4. Refactor Codex matcher constants/inventory; update `.codex-plugin/hooks.json`,
   `configs/codex/hooks.json`, README examples, adapter tests, marketplace
   fixtures, and the real handler dispatch-count test.
5. Add the shipped routing/trust reference, rewrite
   `skills/context-mode/SKILL.md`, and align routing-block/Hook guidance and tool
   descriptions. Preserve external MCP passthrough, RecoveryBrief behavior,
   security policies and repeat aggregation.

## Phase 3: Execution Persistence And File Boundary

6. Add shared persistence/provenance types and schemas; migrate ContentStore
   source metadata, add exact source removal, and extend `ctx_purge` with source
   scope. Convert execute/file/batch default processing to request-local search
   and persist only successful explicitly verified bodies.
7. Remove compatibility-mode project containment from `ctx_execute_file` and
   implement descriptor-based bounded file snapshot validation in the executor.
   Keep host deny checks, restricted project isolation, timeouts, output caps,
   process cleanup and language behavior.

## Phase 4: Batch Truthfulness

8. Replace NODE_OPTIONS command prefixes with shell preambles, introduce the
   typed per-command result, propagate exit code/stderr in serial and parallel
   paths, and derive query/index claims only from successful body content.
9. Replay real temporary-fixture probes for `for`, `if`, `while`, brace group
   and function scripts, serial and parallel nonzero/syntax/timeout cases, paths
   containing spaces/quotes, dynamic file discovery, and same-call
   `query_scope=batch` hits.

## Phase 5: Diagnostics And Version Channels

10. Promote the Codex plugin diagnostic projection and make CLI Doctor and MCP
    `ctx_doctor` render it. Add marketplace/offline/disabled/stale/missing-Hook
    fixtures and compare them to normalized `codex plugin list` facts.
11. Add the shared semantic version/channel module and replace CLI, server and
    analytics equality/private comparisons. Cover local newer/equal/remote
    newer, prerelease, invalid and channel-unavailable cases.

## Phase 6: Replay Probe, Docs And Specs

12. Extract the canonical response measurement script, add Git-root discovery
    and bounded sanitized stderr, retain the archived compatibility entrypoint,
    and replay both directory shapes.
13. Update README, Skill docs, purge/index/search/tool descriptions, task
    evidence and the applicable `.trellis/spec/` contracts. Preserve default
    presentation budgets and Codex env forwarding with explicit regressions.

## Phase 7: Validation And Review

14. Run issue-focused unit/integration tests, Hook/Skill static and subprocess
    tests, Doctor/MCP stdio tests, ContentStore migration/purge tests, external
    file probes, batch probes, measurement replay and Codex marketplace tests.
15. Run `trellis-check`, typecheck, format/static checks, full build/test,
    bundle and asymmetric drift checks, npm pack inspection, deterministic
    consecutive marketplace builds, offline install verification and secret/
    generated-garbage scans.
16. Run `trellis-update-spec`, finalize task result evidence, review all changes
    against each issue, create clear implementation commits, and leave the
    implementation branch clean.

## Phase 8: Integrate And Publish

17. Push the maintenance branch, fast-forward or otherwise integrate the
    reviewed commits into `devel` according to repository history, and verify
    `origin/devel` before release. Do not touch `main`.
18. Confirm the next version/tag is unoccupied, synchronize all version
    manifests, create a clean source candidate `C`, and rerun every release
    gate from that exact commit.
19. Run the provider-authorized Codex native release preflight with the existing
    authorized session projection and no credential output. Add only
    `docs/releases/attestations/vX.Y.Z.json` in direct-child evidence commit
    `E`, verify it, create the annotated tag on `E`, and include the exact
    content-manifest digest in the tag message.
20. Push `devel` and the tag, wait for the Release workflow and GitHub Release,
    verify all assets and SHA-256 values, inspect the npm package and offline
    marketplace contents, and confirm the tag object/peeled commit/source
    candidate topology. The existing workflow creates an npm tarball asset but
    does not publish the npm registry; report that channel accurately.
21. Finish the Trellis task, confirm a clean component worktree, and hand the
    release evidence plus root-owned Issue 010/018/067 acceptance steps back to
    the parent workflow without editing parent files.

## Required Validation Commands

The exact focused test file list may grow as tests are added. The final command
record must include at least:

```sh
python3 ./.trellis/scripts/task.py validate 08-12-context-mode-open-issues-convergence
node scripts/run-pnpm.mjs run typecheck
node scripts/run-pnpm.mjs run build
node scripts/run-pnpm.mjs test
node scripts/assert-bundle.mjs server.bundle.mjs cli.bundle.mjs fetch-worker.bundle.cjs hooks/session-extract.bundle.mjs hooks/session-snapshot.bundle.mjs hooks/session-db.bundle.mjs hooks/checkpoint.bundle.mjs hooks/recovery-brief-capability.bundle.mjs hooks/security.bundle.mjs
node scripts/assert-asymmetric-drift.mjs
npm pack --ignore-scripts --pack-destination <temporary-directory>
node scripts/build-codex-marketplace-bundle.mjs --output-dir <temporary-directory-a>
node scripts/build-codex-marketplace-bundle.mjs --output-dir <temporary-directory-b>
node scripts/verify-codex-release-asset.mjs <marketplace-archive>
git diff --check
git status --short
```

Release-only commands and their sanitized outputs are recorded after source
candidate creation because they bind exact commit, runtime, provider projection,
archive and tag identities.
