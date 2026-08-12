---
name: context-mode
description: MANDATORY routing rules for context-mode. Invoke whenever you analyze, count, filter, compare, search, parse, or transform data; fetch a URL; or run a data-heavy command — so raw bytes stay out of the context window.
---

# context-mode — MANDATORY routing rules

context-mode MCP tools are available in GitHub Copilot CLI. These rules protect
the context window from flooding — one unrouted command can dump tens of KB into
the conversation. Follow them strictly.

## Think in Code — MANDATORY

Analyze / count / filter / compare / search / parse / transform data: **write
code** via `ctx_execute(language, code)` and `console.log()` only the answer. Do
NOT read raw data into context. PROGRAM the analysis, do not COMPUTE it by
reading. One script replaces ten tool calls.

## Protocol passthrough

Call lifecycle control, event waits, interactive actions, bounded structured
results, and tools with dedicated status/error protocols directly. Never wrap
Trellis/Governance, CodeGraph, Fast Context, or another bounded MCP call in
context-mode execution. With an approved `.codegraph/`, use CodeGraph first for
symbols, architecture, call paths, and impact. For a large structured result,
have the original tool write a file and analyze it with `ctx_execute_file`;
keep unverified external candidates non-persistent.

## BLOCKED — do NOT use

- **curl / wget** — dumps raw HTTP into context. Keep bounded web protocols
  direct; for large one-shot results save a file and use `ctx_execute_file`.
  Use `ctx_fetch_and_index` only for a trusted source explicitly selected for retention.
- **Inline HTTP** (`node -e "fetch(...)"`, `python -c "requests.get(...)"`) — use
  `ctx_execute(language, code)`; only stdout enters context.
- **Reading large files to analyze** — use
  `ctx_execute_file(path, language, code)`.

## Tool selection

1. **GATHER**: `ctx_batch_execute(commands, queries)` — runs all commands,
   searches successful output in this request, and does not persist by default.
2. **PROCESS**: `ctx_execute` / `ctx_execute_file` — sandbox; only stdout enters
   context.
3. **WEB**: preserve bounded web/MCP protocols. Use `ctx_fetch_and_index` only
   for a trusted source explicitly selected for retention.
4. **SEARCH**: `ctx_search(queries: [...])` queries previously persisted content only.
5. **INDEX**: `ctx_index(path, source)` explicitly retains a locally verified artifact; never use it as the default whole-repository route.

Write artifacts to FILES; return a path + one-line description, not inline dumps.
