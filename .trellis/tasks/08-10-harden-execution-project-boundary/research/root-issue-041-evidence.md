# ROOT-ISSUE-041 Evidence Snapshot

## Observed UI Cost

A normal Codex `ctx_execute` call can occupy many terminal lines twice:

1. Codex renders the full MCP input, including a multi-line `code` field, in its
   host-owned `Called` block.
2. context-mode prepends another fenced copy of the source to the MCP result,
   followed by indexed section previews, a long searchable-term list, and a
   retrieval instruction.

The component can shorten the second part. No local evidence establishes a
context-mode mechanism that controls the first part.

## Verified Source Paths

- `src/server.ts`: `CODE_ECHO_MAX` is a hard-coded `2000`.
- `src/server.ts`: `truncateCodeForEcho()` and `buildExecuteEcho()` produce the
  fenced result preamble.
- `src/server.ts`: both `ctx_execute` and `ctx_execute_file` prepend that echo.
- `src/server.ts`: indexed summaries append section previews, `Searchable terms`,
  and a `ctx_search` instruction.
- The source comment links source echoing to upstream Issues #717 and #736. The
  implementation session verified both issues and their regression tests before
  changing the echo contract.

## Upstream Verification (2026-08-10)

- [Issue #717](https://github.com/mksglu/context-mode/issues/717) is closed. It
  requires `ctx_execute` and `ctx_execute_file` responses to show the executed
  source plus language/path so Pi extensions and users can inspect, debug, and
  block source patterns.
- [Issue #736](https://github.com/mksglu/context-mode/issues/736) is closed. It
  requires batch responses to show the exact commands for review and audit.
- Upstream commits linked to those contracts are
  `38117ad1c614d685f615353e22c9185309ed1236` (bounded execute source echo),
  `a54c666f7d816a455c7d642f67ff53b278ae2641` (execute-file path/source echo),
  `f7af3cafd9dfab45bbb7410053ffc059d128e279` (per-section batch command echo),
  and `c1030ca5fc3cfb1a4c16aa6618dc0637e162d6f2` (top-level command inventory).
- The associated regression coverage lives in
  `tests/core/echo-commands.test.ts`. Upstream `main` was observed at
  `ff5f911d5732a036336c59684c27f4514f211edf` during verification.

Conclusion: a configured value of `0` cannot suppress code or command bodies.
The implementation maps it to a tested 64-code-point minimum. Optional
`Searchable terms` are not part of the direct source audit contract and may be
disabled with `0`.

## Recommended Direction

Use one typed response-presentation policy rather than another fixed magic
number. Give source previews and indexed summaries bounded defaults and optional
environment configuration. A compact source preview should retain language,
original size, omitted size, truncation state, and a stable digest.

Do not promise to truncate Codex's `Called` input rendering from this component.
Do not preserve full restricted source or output in FTS5 as a workaround. Treat
zero-length previews as conditional on the verified #717/#736 audit contract and
enforce a tested minimum if required.

## Correlation

- Root issue: `ROOT-ISSUE-041`
- Component task: `.trellis/tasks/08-10-harden-execution-project-boundary`
- Delivery: the same independent Codex main session as `ROOT-ISSUE-025`

## Component Boundary

The shared presentation policy controls only MCP return content: source echo,
command inventory, indexed title previews, searchable terms, and result
previews. Codex constructs its `Called` argument display before the MCP result
is available. That host-owned area remains unchanged and must be measured and
reported separately from context-mode response reduction.
