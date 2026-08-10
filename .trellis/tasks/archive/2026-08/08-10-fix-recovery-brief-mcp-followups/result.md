# Result: RecoveryBrief MCP Follow-Ups And v1.0.183

Date: 2026-08-10

## Identity

- Root issues: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`
- Branch: `fix/issue-025-execution-boundary`
- Baseline before this task: `7d55bba5c96cf68ad04f7f8670b7df393384293b`
- Implementation commit: `0ec118d7` (`fix: resolve RecoveryBrief MCP follow-ups`)
- Integrated `origin/devel`: `6057a8d8` via merge commit `e4a6921c`
- Release target: fork `devel`, version `v1.0.183`
- Delivery policy: no parent repository, Gitlink, `/home/penn/.codex`,
  Governance Plugin, sibling component, npm registry, push, or publication was
  included in the implementation commit.

## Delivered

`ROOT-ISSUE-025` remains server-authorized for `ctx_execute`,
`ctx_execute_file`, and `ctx_batch_execute`. This follow-up does not broaden
restricted authority. It makes the host temp resolver reusable while keeping
`.ctx-mode-*`, child `TMPDIR`, hidden-path exclusion, and cleanup behavior
unchanged; only indexable outer test fixtures use the host temp root.

`ROOT-ISSUE-041` now exposes a complete typed RecoveryBrief v1 MCP shape with
strict nested objects, slot-specific priority literals, source kinds, list
bounds, timestamp and digest shapes. Runtime validation remains authoritative
and returns stable, bounded, content-free `validationIssue` details alongside
`INVALID_RECOVERY_BRIEF`. `briefBytes` now consistently means persisted UTF-8
file bytes; canonical compact JSON remains the `briefSha256`/CAS identity.

## Changed Files

Product and documentation:

- `src/checkpoint/types.ts`
- `src/checkpoint/recovery-brief-schema.ts`
- `src/checkpoint/runtime.ts`
- `src/executor.ts`
- `src/server.ts`
- `src/util/system-temp.ts`
- `skills/ctx-recovery-brief/references/recovery-brief-v1.md`
- `.trellis/spec/backend/codex-trellis-recovery-boundaries.md`
- `.trellis/spec/backend/restricted-execution-and-presentation.md`

Tests:

- `tests/checkpoint/recovery-brief-provider.test.ts`
- `tests/checkpoint/recovery-brief-contract.test.ts`
- `tests/checkpoint/recovery-brief-schema.test.ts`
- `tests/core/server-shared-handler.test.ts`
- `tests/executor/win-sandbox-782-788.test.ts`
- `tests/util/system-temp.test.ts`

Generated release payload:

- `server.bundle.mjs`
- `cli.bundle.mjs`
- `hooks/checkpoint.bundle.mjs`

Task evidence and planning:

- `.trellis/tasks/08-10-fix-recovery-brief-mcp-followups/`

The origin merge also brought the remote-only `stats.json` install-stat
change. It is not part of the product fix and had no path overlap with the
task implementation.

## Verification

All commands ran in the component repository with `node scripts/run-pnpm.mjs`
where the project requires pnpm; no global pnpm executable was available.

```text
python3 ./.trellis/scripts/task.py start 08-10-fix-recovery-brief-mcp-followups
  PASS; task activated before implementation

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-10-fix-recovery-brief-mcp-followups
  PASS

Focused pre-integration matrix
  11 files passed; 197 passed; 24 skipped

Focused integrated matrix
  11 files passed; 197 passed; 24 skipped

Version/release contract matrix on v1.0.183
  7 files passed; 58 passed

Full integrated suite on v1.0.182 source
  232 files passed; 4,979 passed; 41 skipped

Full final versioned suite on v1.0.183
  232 files passed; 4,979 passed; 41 skipped

node scripts/run-pnpm.mjs run typecheck
  PASS before and after origin/devel integration; final build also passed tsc

node scripts/run-pnpm.mjs run build
  PASS; all nine assert-bundle checks and assert-asymmetric-drift passed

git diff --check
  PASS

Consecutive generated bundle hashes
  server.bundle.mjs: ed1fe26686b74917402625d77098fd4259839e2e0fb687fe9dd898e38e09e660
  cli.bundle.mjs: 4850b743106cc3d3a886d752543d1cf51dda80bd3dcc1199558ec40f7158fdf8
  hooks/checkpoint.bundle.mjs: a993bf5d00cf5a9e6914cd7104ada9aa969e4696609eb2e708d0a56705afbdaa
  matched across consecutive builds

Real installed ctx_execute probe
  TMPDIR basename: .ctx-mode-VSLkXB
  tests/core/server-shared-handler.test.ts + tests/util/system-temp.test.ts:
  2 files passed; 4 passed; no TMPDIR override

npm pack --pack-destination <fresh temporary directory>
  context-mode-1.0.183.tgz; embedded version 1.0.183; 22 package files
  SHA-256: 9c937604dab33fc674da1d9dec6180bc0a97bbe26a9dbec44a83ce68871d3abe

node scripts/run-pnpm.mjs run build:codex-marketplace -- --output-dir <fresh temporary directory>
  archive SHA-256: e2e0860bd6e7f0cc2d53838156764717f0299b3f440348f590d9c3fa7d502e10
  CONTENT-MANIFEST SHA-256: ecba16eef6c2b5d8325844ed6bfd75d7e9c7ad417ebf2c139ae96741ee8cacab

node scripts/run-pnpm.mjs run verify:codex-marketplace -- <archive>
  PASS; offline install and MCP initialize; 124 manifest entries
```

The repository has no independent `lint` script. The initial direct
`pnpm` invocation was unavailable in this shell; the repository's
`scripts/run-pnpm.mjs` Corepack path was used for all package scripts.

## Supported Platforms

- Restricted execution: Linux with a successful real `bubblewrap` probe.
- macOS and Windows: restricted mode fails closed with stable isolation errors;
  compatibility execution remains available.
- Restricted languages: shell, JavaScript, TypeScript, and Python when the
  selected interpreter is visible through the read-only system/runtime view.
- Host-temp resolver: POSIX ignores inherited `TMPDIR`; Windows uses `TEMP`,
  `TMP`, or Node's temp fallback. The real MCP probe was Linux only.

## Upstream #717 / #736 Conclusion

Issues #717 and #736 are closed. The verified upstream commits are
`38117ad1c614d685f615353e22c9185309ed1236`,
`a54c666f7d816a455c7d642f67ff53b278ae2641`,
`f7af3cafd9dfab45bbb7410053ffc059d128e279`, and
`c1030ca5fc3cfb1a4c16aa6618dc0637e162d6f2`; regression coverage is in
`tests/core/echo-commands.test.ts`. The audit contract requires visible
executed source and commands, so zero source/command preview values use the
tested 64-code-point minimum. Optional `Searchable terms` may be disabled with
zero.

## Response Measurements

These are context-mode MCP return-content measurements, not Codex host display
measurements, from the preceding execution-boundary delivery and remain the
applicable presentation contract:

| Policy | Execute | Execute file | Batch |
| --- | ---: | ---: | ---: |
| 2,000-preview proxy | 2,234 chars / 10 lines | 2,251 / 11 | 2,166 / 25 |
| Default | 473 chars / 10 lines | 490 / 11 | 1,342 / 25 |
| Configured compact | 312 chars / 10 lines | 329 / 11 | 938 / 25 |
| Effective zero minimum | 296 chars / 10 lines | 313 / 11 | 764 / 23 |

Codex host tool-call input still owns the complete `Called` argument display;
context-mode does not claim to shorten that host-owned region.

## Residual Risks And External State

- The native release preflight still requires a disposable mode-`0600`
  provider projection outside this repository and inherited provider
  authorization. Normal `/home/penn/.codex` state must not be read.
- Linux distributions and user-managed runtime layouts beyond this host's real
  probes need separate release portability coverage.
- The installed v1.0.182 MCP baseline still reports old `briefBytes` semantics;
  consumers must load the v1.0.183 bundle to receive the fix.
- No npm registry publication is planned or performed; the npm-shaped archive
  is a GitHub Release asset only.
