# Result: Compact MCP Presentation Contract

Date: 2026-08-12

## Identity

- Related root issue: `ROOT-ISSUE-041`
- Baseline: `c7a098606518a53bfb9a43c0ca11caceb5bd4ed4`
- Implementation branch: `fix/compact-mcp-presentation-contract`
- Starting version: `1.0.185`
- Release candidate: `1.0.186`, subject to final remote/tag availability

## Delivered

- Shared typed presentation measurement and batch command-proof primitives.
- Compact source proofs that preserve language, actual bounded source,
  Unicode counts, omitted/truncated state, and full SHA-256.
- A two-line normal queried `ctx_batch_execute` wrapper with all bounded
  commands, timeout/error status, one canonical full-batch digest, persistence,
  query scope, section count, and exact indexed source.
- Removal of repeated `## Commands`, `## Indexed Sections`, generic batch tips,
  and per-command five-field presentation ledgers from the common queried path.
- Compact index, search throttle/empty state, fetch cache, doctor, and upgrade
  wrappers without changing ranking, snippets, cache, errors, or actions.
- Compact JSON text and identical `structuredContent` for checkpoint and
  RecoveryBrief state. Version notices remain available as a separate text
  item and cannot corrupt JSON parsing.
- Explicit non-changes for capability-bearing `ctx_stats`, destructive
  `ctx_purge`, and already-minimal `ctx_insight` results.
- Restricted batch matching remains request-only and non-persistent; execution
  authority, isolation, deny policy, annotations, schemas, and platform
  manifests are unchanged.

## Audit Conclusions

Upstream Issues #717 and #736 require actual executable source and actual batch
commands to remain visible. They do not require the fork's repeated
`[source=..., preview=..., omitted=..., truncated=..., sha256=...]` suffix.
Zero source/command budgets therefore still map to the tested 64-character
minimum, while optional searchable terms may be disabled with zero.

Skills are not merged into batch execution. Claude's `Skill` post-tool hook is
observability only; Codex and RecoveryBrief capability matchers use exact owned
tool names. The structurally bounded shell allowlist only suppresses a routing
nudge and does not grant execution authority.

## Measurements

The checked 15-tool fixture preserves actionable output byte-for-byte while
reducing aggregate wrappers from `3349 -> 2126` UTF-8 bytes (`36.52%`),
`3341 -> 2124` Unicode characters (`36.43%`), and `79 -> 27` non-empty lines
(`65.82%`). The representative queried batch wrapper changes from
`828 chars / 10 lines` to `303 chars / 2 lines`.

Detailed per-tool figures are in
`research/presentation-measurements.md`. These measurements cover context-mode
MCP return content only. The Codex host-owned `Called` input area is unchanged.

## Pre-Version Validation

- Focused execution/presentation/restricted/typed/Codex env matrix:
  `6 files, 39 passed`.
- Expanded retrieval/state/management matrix: `885 passed, 5 skipped`.
- Full authoritative suite: `233 files, 4988 passed, 41 skipped`; pretest also
  passed typecheck, build, bundle assertions, and asymmetric drift.
- `typecheck`: passed at `1.0.185`.
- `build`: passed at `1.0.185`, including all bundle assertions and asymmetric
  drift.
- Consecutive source bundle builds were byte-identical. Consecutive Codex
  marketplace builds were also byte-identical, contained `124` manifest
  entries and the exact five presentation `env_vars`, and passed offline
  install, stdio normalization, MCP initialize, and a real tool call.
- Disposable real stdio responses for a 365-character source measured
  `447 chars / 7 lines` at the default 240-character preview and
  `255 chars / 7 lines` at `64/64/16/0/160`, each 34 characters below the
  archived `1.0.185` response without reducing the source preview itself.
- The planned `--reporter=basic` invocation is invalid with Vitest `4.1.10`
  because no custom `basic` reporter module exists. The repository's canonical
  `pnpm test`/default reporter is used for authoritative full-suite validation.
- Hidden-path-sensitive tests run with `TMPDIR=/tmp` from the real repository
  path; no index security rule is relaxed for the harness.

Final commits, versioned validation, release tag, CI, asset hashes, and
residual risks are added only after those gates complete.
