# Check: Compact MCP Presentation Contract

Date: 2026-08-12

## Scope Reviewed

- Shared presentation parsing, source/command proof, measurements, and batch
  digest.
- All fifteen registered MCP tools and their changed or intentionally
  unchanged response wrappers.
- Compatibility and restricted execution, FTS5 persistence/request-only
  boundaries, query scope, timeout/error status, and #717/#736 source echo.
- Compact typed checkpoint/RecoveryBrief text and `structuredContent`, including
  preservation of version notices without corrupting JSON.
- README, Codex presentation environment forwarding, generated bundles, and
  platform adapter contracts.

## Findings Resolved

1. The first typed-response implementation skipped the existing version update
   notice to keep JSON parseable. The checked implementation now leaves compact
   JSON in `content[0]` and appends the notice as a second text item, with a
   behavior test for typed and plain responses.
2. The compact batch response initially omitted the exact persistent source.
   It now reports `Indexed N sections as "batch:<labels>"` on the first wrapper
   line, preserving a precise later `ctx_search(..., source: ...)` path without
   exceeding the two-line wrapper target.
3. The plan assumed a no-query batch path. Git history proves
   `ctx_batch_execute.queries` has been required with `.min(1)` since its first
   implementation (`103b41dd`), so the task does not broaden the input schema.
4. Hidden-path-sensitive tests fail when launched inside `ctx_execute` because
   its private `.ctx-mode-*` `TMPDIR` is intentionally non-indexable. The
   authoritative suite ran from the real repository path with `TMPDIR=/tmp`;
   no security policy was relaxed.
5. Vitest `4.1.10` treats `--reporter=basic` as a custom module and the project
   has no such reporter. Canonical `pnpm test` with its default reporter is the
   authoritative command.

## Checks Passed At Version 1.0.185

```text
Focused presentation/execution/restricted/typed/Codex env matrix
  PASS; 6 files, 39 tests

Expanded retrieval/state/management matrix
  PASS; 13 files, 885 passed, 5 skipped

TMPDIR=/tmp npx --yes pnpm@10.23.0 test
  PASS; 233 files, 4988 passed, 41 skipped
  pretest also passed typecheck, build, nine bundle assertions,
  and asymmetric drift

npx --yes pnpm@10.23.0 run typecheck
  PASS

npx --yes pnpm@10.23.0 run build
  PASS; all generated bundle assertions and asymmetric drift
```

## Semantic Result

Actionable result fixtures are byte-for-byte unchanged. The deterministic
15-tool wrapper matrix reduces aggregate Unicode characters by `36.43%` and
non-empty lines by `65.82%`; the representative queried batch wrapper is two
non-empty lines. Actual source/commands, errors, warnings, timeouts, security
refusals, exact indexed source, ranking/snippets, state fields, and destructive
scope remain available.

The Codex host-owned `Called` input display is unchanged and is not counted as
a context-mode presentation reduction.

## Additional Pre-Version Gates Passed

- Executable MCP presentation spec updated through `trellis-update-spec`; the
  affected focused suite passed again.
- Two Codex marketplace builds were byte-identical at version `1.0.185`:
  archive SHA-256
  `eae121662b01ce1fb0c2993f7b8e14397002c80a36e977674a0f502b8bc059fb`,
  manifest SHA-256
  `da4be776967d271f694196cecda4fd9b58edb0135a88d0c1b07152b6f7ed21a9`,
  and `124` manifest entries. Offline install, normalized stdio transport,
  exact five-variable `env_vars`, MCP initialize, and real call all passed.
- Consecutive source builds were byte-identical: `server.bundle.mjs`
  `7b175faf1aa44674218bb1df315d75b3ed9a1a1868bae0728e8efcc176e9edf5`
  and `cli.bundle.mjs`
  `49757add808c63d0ea86f099b76deec3dc7601bae00b74f2b9cae466e232670a`.
- Disposable real stdio long-source probes measured `447 chars / 7 lines`
  with the default 240-character preview and `255 chars / 7 lines` with
  `64/64/16/0/160`. Each is 34 characters below the archived `1.0.185`
  response while preserving the same source preview budget.

## Remaining Gates

- Commit implementation, synchronize the next available patch version, rerun
  all release gates, produce native Codex attestation evidence, publish the
  annotated tag, and verify CI/Release assets.
