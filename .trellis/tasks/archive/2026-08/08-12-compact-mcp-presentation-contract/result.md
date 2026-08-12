# Result: Compact MCP Presentation Contract

Date: 2026-08-12

## Identity

- Related root issue: `ROOT-ISSUE-041`
- Baseline: `c7a098606518a53bfb9a43c0ca11caceb5bd4ed4`
- Implementation branch: `fix/compact-mcp-presentation-contract`
- Starting version: `1.0.185`
- Release candidate: `1.0.186`; remote tag confirmed free before versioning
- Implementation commit:
  `408e25d60ab7ef93c6abe62c945eef553272fca2`
- Version commit: `a7a9bd67e98aa2a29ec4a5167a9f9806935c7a34`

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

## Version 1.0.186 Validation

- `typecheck`: passed.
- Two consecutive `build` runs passed all nine bundle assertions and
  asymmetric drift; all nine generated artifact hashes were identical.
- Full authoritative suite: `233 files, 4988 passed, 41 skipped`; pretest also
  passed the complete build gate.
- Two Codex marketplace archives and sidecars were byte-identical. The archive
  contained `124` verified manifest entries and passed isolated offline
  marketplace installation, normalized stdio transport, MCP initialize, and a
  real tool call.
- Source, archive, installed manifest, and normalized Codex transport expose
  exactly these non-sensitive forwarded variables:
  `CONTEXT_MODE_CODE_ECHO_MAX`, `CONTEXT_MODE_COMMAND_ECHO_MAX`,
  `CONTEXT_MODE_TITLE_PREVIEW_MAX`, `CONTEXT_MODE_SEARCHABLE_TERMS_MAX`, and
  `CONTEXT_MODE_RESULT_PREVIEW_MAX`. Fixed
  `CONTEXT_MODE_PLATFORM=codex` remains unchanged.
- Real disposable stdio probes reproduced `447 chars / 7 lines` for the default
  240-character source preview and `255 chars / 7 lines` for
  `64/64/16/0/160`. The 365-character source reports 125 and 301 omitted
  characters respectively.
- Release-candidate marketplace archive SHA-256:
  `604231d2c52c8f95bc502486a433981c16b20402b9b73fad69cdfb4d32425a23`.
- Release-candidate `CONTENT-MANIFEST.json` SHA-256:
  `c601fabf00a9608f1746ecc818f2dccf5aeb1aab821b4b5862a8633d44540351`.

The native attestation, release source/evidence commits, annotated tag, remote
CI/Release state, downloaded asset hashes, and final residual-risk statement
are recorded after those gates complete.
