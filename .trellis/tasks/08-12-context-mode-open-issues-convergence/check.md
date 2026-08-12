# Check: Context-mode Open Issues Convergence

Date: 2026-08-12

## Review Result

The component implementation satisfies AC1 through AC9. The release, final
root-workflow handoff, and clean-worktree criteria remain open until the source
candidate is integrated into `devel`, attested, tagged, published, downloaded,
and independently inspected.

The final implementation review found two material defects before this check.
One `ContentStore.index` path still wrote provenance after the FTS transaction;
the store now writes chunks, source metadata, and provenance atomically in the
same transaction. A second draft unnecessarily coupled read-only
`query_scope=global` to verified persistence; global scope now reads the
existing persistent index without retaining current output, while restricted
mode still rejects it. Focused regressions and the full suite passed after both
corrections.

## Issue Findings And Evidence

| Issue | Baseline conclusion | Component result | Primary regression evidence |
| --- | --- | --- | --- |
| 003 | Parent duplicate-execution premise is invalid under current Codex exact-matcher semantics; the manifest arrangement was still fragile | One explicit disjoint inventory covers every bare and fully qualified name; real PreToolUse dispatch executes one handler | `tests/hooks/codex-matcher-dispatch.test.ts`, `tests/hooks/tool-naming.test.ts`, `tests/plugins/codex-manifest.test.ts` |
| 009 | Partially fixed at v1.0.186 | Shared typed plugin identity/runtime root/Hook readiness projection is rendered by CLI and MCP; marketplace/offline/disabled/stale/missing-asset fixtures agree | `tests/adapters/codex.test.ts`, `tests/core/cli.test.ts`, `tests/core/server.test.ts` |
| 010 | Reproduced | Shipped Skill gives an approved `.codegraph/` first priority for symbols, architecture, calls, paths, impact, and review locations; component guidance no longer substitutes a source scan because output may be long | `tests/open-issues-convergence.test.ts`, `tests/guidance-throttle.test.ts` |
| 012 | Reproduced | Strict semantic ordering and channel-aware update state replace equality-only/npm-universal checks; local-newer never warns about downgrade | `tests/version-channel.test.ts`, `tests/core/cli.test.ts`, `tests/core/server.test.ts` |
| 013 | Reproduced | Execute/file/batch default to request-only search; verified success-only persistence has typed bounded provenance, atomic metadata, and exact-source purge | `tests/execution-persistence.test.ts`, `tests/store.test.ts`, `tests/core/server.test.ts` |
| 018 | Component portion partially fixed; global issue remains root-owned | Repeat aggregation remains active for unbounded output while direct protocol exceptions and persistence boundaries are explicit | `tests/hooks/core-routing.test.ts`, `tests/core/routing.test.ts`, `tests/guidance-throttle.test.ts` |
| 053 | Reproduced | Canonical Git-root discovery works from current and archived paths; child failures expose bounded sanitized stderr | `tests/measurement-script.test.ts`, canonical and archived real probes |
| 064 | Reproduced in compatibility mode | Host/OS authorization governs external file reads; bounded one-descriptor regular-file snapshots retain size, race, link-loop, timeout, and restricted-mode protection | `tests/execute-file-authority.test.ts`, `tests/security/project-boundary-852.test.ts` |
| 067 | Partially fixed at v1.0.186 | One shipped matrix distinguishes direct protocol, aggregation, file-then-analyze, and forbidden calls; `ctx_search` and `ctx_index` are accurately bounded | `tests/adapters/codex-external-mcp-routing.test.ts`, `tests/open-issues-convergence.test.ts`, `tests/opencode-plugin.test.ts` |
| 068 | Reproduced | Shell-specific preambles apply NODE_OPTIONS to the unchanged whole script without `eval`; serial/parallel typed results preserve exit/error/timeout state and index only successful stdout | `tests/batch-execution-contract.test.ts`, `tests/core/echo-commands.test.ts`, `tests/core/server.test.ts` |

## Validation Passed At Version 1.0.186

```text
Targeted issue matrix
  PASS; 19 files, 659 tests

Store/persistence atomicity recheck
  PASS; 4 files, 701 tests

TMPDIR=/tmp node scripts/run-pnpm.mjs test
  PASS; 240 files, 5082 passed, 41 skipped
  PASS; pretest typecheck/build, nine bundle assertions, asymmetric drift

node scripts/run-pnpm.mjs run typecheck
  PASS

node scripts/run-pnpm.mjs run build (two consecutive runs)
  PASS; all nine generated bundle hashes identical

Codex marketplace build x2 + verify
  PASS; byte-identical archives
  PASS; 125 CONTENT-MANIFEST entries
  PASS; isolated offline install, plugin registration, MCP initialize/call
  PASS; exact five presentation env_vars and fixed CONTEXT_MODE_PLATFORM=codex

npm pack --ignore-scripts --pack-destination <temporary-directory>
  PASS; context-mode-1.0.186.tgz, 395 files

python3 ./.trellis/scripts/task.py validate 08-12-context-mode-open-issues-convergence
git diff --check
credential and generated-garbage scans
  PASS
```

The repository has no separate lint or formatter script. TypeScript compilation,
Vitest, bundle assertions, manifest drift checks, package inspection, and
`git diff --check` are the applicable static and formatting gates.

## Real Probes

- The canonical and archived response probes produced identical measurements
  and zero persistent files in repository, home, and host temporary scopes.
- The three-entrypoint measurement fixture processed 4,020 source characters;
  default wrappers were `439/458/1210` characters for execute/file/batch and
  the compact `80/80/32/5/200` wrappers were `278/297/873` characters.
- A disposable stdio 365-character source measured `478 characters / 9 lines`
  with default preview `240`, and `286 characters / 9 lines` with
  `64/64/16/0/160` and preview `64`.
- Real serial and parallel compound-shell probes covered `for`, `if`, `while`,
  brace groups, functions, nonzero exit, syntax error, timeout, paths with
  spaces/single quotes, dynamic file discovery, and same-batch body matches.
- A host-readable project-external temporary file succeeded. Missing,
  non-regular, oversized, replacement-race, and link-loop fixtures failed with
  bounded errors; restricted project containment remained unchanged.
- Unverified/request-only candidates were absent from `ctx_search`; explicitly
  verified successful content became searchable with provenance and disappeared
  after exact-source purge. Failed, timed-out, empty, title-only, and stderr-only
  candidates never became persistent.

These response measurements cover context-mode MCP return content only. The
Codex host-owned `Called` argument display is unchanged.

## Residual Boundaries

- Root `AGENTS.md` and any global CodeGraph precedence rule remain root-owned
  for Issue 010 acceptance.
- Issue 018 global routing enforcement remains cross-repository; this component
  supplies aggregation and exception behavior but cannot close it alone.
- Governance/root protocol policy for Issue 067 remains root-owned. The
  component cannot rewrite arbitrary external MCP calls or preserve protocols
  for callers that ignore the shipped Skill.
- Codex plugin enabled identity and Hook trust are observed from Codex; the
  component diagnoses them but cannot authorize or restart the host profile.

## Release Gates Remaining

Version synchronization, final-version full validation, task archive, native
Codex attestation, direct-child evidence commit, annotated tag, remote CI,
GitHub Release, downloaded asset hashes, final root handoff, and clean status.
