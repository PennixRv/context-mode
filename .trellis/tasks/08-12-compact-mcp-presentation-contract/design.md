# Design: Compact MCP Presentation Contract

## Problem Statement

context-mode minimizes raw data entering the model, but its own response
wrappers have grown independently across fifteen MCP tools. Some wrappers now
repeat command previews, section inventories, accounting metadata, and usage
tips even when the actionable result already carries the same information.

The redesign must increase information density without changing any operation
that produced the result. It must also preserve the upstream #717/#736 rule
that actual executable source and batch commands remain visible.

## Architectural Boundary

```text
MCP request and host-owned Called display
  -> schema validation
  -> security/execution/index/search/recovery operation
  -> typed semantic result and exact provenance
  -> compact presentation primitives
  -> tool-family renderer
  -> self-sufficient content[0].text
  + optional compatible structuredContent
  -> response accounting / host transport
```

Presentation is the only changed layer. Renderers receive completed semantic
results and cannot change execution decisions, command arrays, indexed content,
search ranking, persistence, recovery compare-and-swap, or destructive scope.

## Design Principles

1. **Action before accounting.** Put the command/result/status first. Include
   accounting only when it explains truncation, persistence, scope, or a
   material warning.
2. **Text remains self-sufficient.** Some shipped clients and tests consume
   `content[0].text`. `structuredContent` is an additive typed mirror, not the
   only location of required information.
3. **Bound wrappers, not results.** Wrapper ceilings do not truncate query
   matches, security refusals, operational errors, or recovery conflicts below
   what is needed to act correctly.
4. **Conditional guidance.** Emit a next-action hint only when the result leaves
   a real next step. Do not repeat generic tips after inline query matches.
5. **Actual execution remains visible.** Labels are not substitutes for source
   or commands. Long executable text uses the configured bounded preview.
6. **Typed provenance remains exact.** Full digest, original size, preview size,
   omitted size, and truncation state remain computed from the original input.
7. **Do not change minimal tools for symmetry.** A tool already at its minimum
   receives contract tests but no speculative abstraction.

## Shared Presentation Primitives

Extend `src/presentation-policy.ts` or split a focused sibling module when the
implementation becomes clearer. The production API should expose typed data,
not accept arbitrary preformatted strings.

### `ExecutionProof`

```ts
interface ExecutionProof {
  kind: "source" | "file-source" | "batch";
  language?: string;
  path?: string;
  originalChars: number;
  previewChars: number;
  omittedChars: number;
  truncated: boolean;
  sha256: string;
}
```

The renderer emits one compact proof line. Full accounting is shown for an
individual source when truncated; untruncated sources use a shorter form while
retaining a stable digest. Batch output consolidates repeated command
accounting into a batch digest plus bounded command previews. A structured
mirror retains exact per-command provenance when supported.

### `CompactInventory`

```ts
interface CompactInventoryItem {
  label: string;
  preview?: string;
  bytes?: number;
  truncated?: boolean;
}
```

The renderer supports a fixed visible-item ceiling and a `+N more` suffix. It
does not own or truncate the underlying collection.

### `ConditionalHint`

A small helper emits one follow-up line only when a specific state requires it:

- persisted batch: expose its exact source for later source-scoped retrieval;
- cached fetch when explicit refresh is relevant;
- empty store: index before search;
- launch failure: manual URL;
- upgrade refusal: marketplace action.

### Compact Typed State

Checkpoint and RecoveryBrief tools already return bounded, content-free typed
objects. Preserve the object exactly in `structuredContent` and serialize text
without pretty-print whitespace. Stable key names and error codes remain
unchanged. Do not apply this to arbitrary search or execution output.

## Tool-Family Design

### Execution Tools

`ctx_execute` and `ctx_execute_file` keep a visible fenced source preview before
the result. Replace the current long bracketed accounting sentence with a
compact proof line. A truncated proof must communicate original, shown,
omitted, and digest values; an untruncated proof can omit redundant zero/false
labels while preserving digest identity.

Every result branch continues to prepend the same proof: success, indexed
intent result, timeout, background process, non-zero exit, runtime error, and
restricted request-only output. Policy refusal before launch remains a concise
error and does not claim that source executed.

### Batch Execution

For the normal queried path, the wrapper before matches is exactly two
non-empty lines:

```text
Executed N commands: L lines/B -> S sections; searched Q; sha256=...
Commands: label = command preview | label = command preview | ...
```

- The second line contains actual command previews, not labels alone.
- Long previews retain a compact truncation marker; exact per-command
  provenance remains typed internally and may be mirrored structurally.
- `## Indexed Sections` is omitted when inline query matches already identify
  returned sections.
- The schema has required `queries.min(1)` since the initial batch
  implementation (`103b41dd`), so there is no supported no-query response
  branch. The queried summary reports the exact persistent source for later
  source-scoped retrieval.
- Restricted mode says request-only/non-persistent on the summary line and
  continues to avoid FTS5 writes.
- Partial timeout and error paths use the same command proof and preserve all
  successfully captured/queryable output.

The batch digest is computed over an unambiguous canonical sequence containing
each full label and command, not by concatenating display previews.

### Index, Search, And Fetch

- `ctx_index`: one result line with source/file/section counts and one
  conditional retrieval hint. Directory caps and denied files remain visible.
- `ctx_search`: preserve query headings and snippets, but remove repeated blank
  lines and generic tips. One no-result or throttle explanation per query/state.
- `ctx_fetch_and_index`: one status line per URL, bounded preview only for newly
  fetched content, and one shared conditional hint for the whole call. Cache
  age, TTL, source identity, partial errors, and force-refresh behavior remain.

### Stats, Doctor, And Checkpoint

- `ctx_stats`: preserve its already capability-bearing minimal result
  byte-for-byte; do not change it merely for cross-tool symmetry.
- `ctx_doctor`: group successful checks into a count/summary; render every WARN
  and FAIL with its remediation. An all-pass result should be short.
- `ctx_checkpoint_report`: preserve the exact typed report; use compact JSON
  text and structured mirror rather than indented JSON.

### RecoveryBrief

Preserve the exact provider result objects and stable error codes for init,
status, and update. Add matching output schemas only if the SDK and strict-client
normalization accept them without changing existing registration. Otherwise,
return `structuredContent` additively and keep compact JSON text. CAS conflict
fields remain complete and explicit.

### Management

- `ctx_upgrade`: one exact action or one exact refusal plus next action.
- `ctx_purge`: preserve its already minimal destructive result byte-for-byte.
  Never shorten target identifiers or counts into ambiguity.
- `ctx_insight`: current one-line success and two-line failure are already
  minimal; retain behavior and add only contract coverage if no duplication is
  found.

## MCP And Host Compatibility

- Do not rely on Codex's host-owned `Called` display to satisfy source-audit
  requirements.
- Do not attempt to control or claim reductions in that host-owned display.
- Keep the first text content item for every tool.
- Preserve current `isError` behavior, annotations, titles, input schemas, and
  strict-client schema normalization.
- Add `structuredContent` only where it is bounded and typed; mirror required
  facts in text.
- Verify the built Codex marketplace asset and offline installed manifest with
  a real stdio initialize/call probe.

## Measurement Contract

Tests expose a helper that reports UTF-8 bytes, Unicode characters, total
lines, non-empty lines, and wrapper/actionable split for deterministic fixture
responses. Check in the fixture expectations or generated task result, not
machine-specific state.

Required gates:

- queried batch wrapper at most two non-empty lines before first query match;
- no verbose per-command five-field suffix;
- actual source/command preview present;
- material aggregate wrapper reduction across all changed tool families;
- unchanged required semantic fields in every response class;
- deterministic repeated output.

## Migration And Rollback

This is a text-presentation compatibility change within the same MCP tools and
input schemas. Consumers parsing undocumented Markdown headings may observe a
change; documented semantic fields and structured state remain stable.

Rollback is a revert of the presentation implementation, tests, docs, and
version commit before release. After release, publish a later patch; never move
or overwrite the annotated release tag.

## Release Topology

1. implementation commits on a task branch from clean
   `c7a098606518a53bfb9a43c0ca11caceb5bd4ed4`;
2. merge/fast-forward through the repository's existing `devel` flow;
3. version synchronization for the next free patch;
4. final source commit with no attestation file;
5. native Codex preflight against that exact source;
6. direct-child evidence commit adding only the attestation JSON;
7. annotated tag at the evidence commit with required metadata;
8. push refs, run Release workflow, wait for CI and Release completion;
9. download every asset and independently verify size, SHA-256, content
   manifest, marketplace install, and MCP initialize/call behavior.
