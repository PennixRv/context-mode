# MCP Presentation Matrix

The registry in `src/server.ts` exposes fifteen context-mode MCP tools. The
matrix separates the tool's actionable result from visible wrapper that may be
compacted. "Wrapper target" applies before actionable content; it is not a cap
on query matches, errors, or state needed by the caller.

| Tool | Current visible shape | Required semantics | Compact direction | Wrapper target |
| --- | --- | --- | --- | --- |
| `ctx_execute` | source accounting line, fenced source, result or indexed/search result, occasional tips | language, actual bounded source, exact truncation provenance, output/error/timeout/background state, persistence mode | compact execution-proof line; keep fence and actionable output; make follow-up conditional | 1 proof line plus source fence |
| `ctx_execute_file` | path plus source accounting, fenced source, result/search output | path, language, actual bounded source, provenance, file/security errors, result | share execute proof grammar with path; keep result | 1 proof line plus source fence |
| `ctx_batch_execute` | summary, `## Commands`, per-command verbose presentation suffix, `## Indexed Sections`, matches, terms, tips | every actual bounded command, per-command security, execution/timeouts, persisted/request-only state, section/query scope, matches, later retrieval | compact summary and command previews into at most two lines; suppress repeated section inventory when matches are inline; bounded discovery summary without queries | 2 lines before matches |
| `ctx_index` | indexed counts/source plus two imperative search instructions | success/error, source identity, file/chunk/code counts, caps/denials, retrieval affordance | one result line; include follow-up only where needed | 1-2 lines |
| `ctx_search` | per-query headings, match headings/snippets, repeated no-result or throttle guidance | query identity, ranking/snippets/source, stale flags, throttle/block state, empty-index/error state | retain matches; compact repeated headings and global tips; one shared follow-up only when actionable | 1 line per query plus matches |
| `ctx_fetch_and_index` | per-source cached/fetched summaries, previews, refresh and mandatory search instructions | cache state/age/TTL, source identity, chunk/byte counts, fetch errors, bounded previews, retrieval | compact per-source status; remove repeated imperative paragraphs; one conditional follow-up | 1 line per source plus preview |
| `ctx_stats` | multi-section report with explanatory prose | all counters, savings math, versions, warnings, index/session state | shorten labels and repeated explanation; preserve values and warnings | data dependent |
| `ctx_checkpoint_report` | pretty-printed JSON | all content-free reliability fields, warnings, stable codes | compact JSON or concise text plus identical structured object | bounded by fields, no pretty-print whitespace |
| `ctx_recovery_brief_init` | pretty-printed JSON | provider/storage, evidence count, digest/size/time, stable error code | compact JSON text and structured mirror | one compact record |
| `ctx_recovery_brief_status` | pretty-printed JSON | provider health, task/path state, digest/size/time, drift, stable error code | compact JSON text and structured mirror | one compact record |
| `ctx_recovery_brief_update` | pretty-printed JSON | CAS result, digest/size/time/source count, conflict/error code | compact JSON text and structured mirror; conflicts remain explicit | one compact record |
| `ctx_doctor` | one line per check plus warnings/remediation | every check result, warning/failure, remediation | keep failed/warned checks; compact successful groups without hiding failed details | summary plus findings |
| `ctx_upgrade` | command or platform-specific refusal/explanation | exact safe command or marketplace action, unsupported/refusal reason | one actionable line; errors retain reason | 1-2 lines |
| `ctx_purge` | cancellation, ambiguity, or deletion summary | explicit confirmation, resolved target, deleted counts, errors, recoverability | one status line plus errors; never abbreviate target | 1-2 lines |
| `ctx_insight` | opened URL or failure plus manual URL | launch status, failure reason, URL | already near-minimal; normalize only | 1-2 lines |

## Shared Response Classes

Each affected tool must be tested against the classes it supports:

1. successful action with a small result;
2. successful action with bounded/truncated content;
3. successful empty result;
4. validation failure;
5. operational failure;
6. security or policy refusal;
7. partial batch success or timeout;
8. destructive cancellation/ambiguity;
9. recovery compare-and-swap conflict;
10. compatibility and restricted execution modes.

## Non-Negotiable Data Flow

```text
tool input
  -> validation and security policy
  -> execution/index/search/state operation
  -> typed semantic result
  -> compact renderer
  -> MCP text content (self-sufficient)
  + optional structuredContent mirror (enhancement only)
  -> response accounting and host adapter
```

The compact renderer is downstream of all semantic work. It cannot decide
whether commands run, what is indexed, how search ranks, whether state is
persisted, or whether an operation is allowed.
