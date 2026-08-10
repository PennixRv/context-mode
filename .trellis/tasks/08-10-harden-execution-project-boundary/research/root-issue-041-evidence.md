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
  issues and their tests still require direct verification by the implementation
  session before the echo contract changes.

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
