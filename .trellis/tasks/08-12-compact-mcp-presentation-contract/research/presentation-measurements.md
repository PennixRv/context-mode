# Deterministic MCP Wrapper Measurements

The table is enforced by `tests/presentation-policy.test.ts`. Measurements use
UTF-8 bytes, Unicode code points, and non-empty lines. The fixture separates
wrapper from actionable output and asserts that actionable output is identical
before and after the presentation change.

| Tool | Before bytes/chars/lines | After bytes/chars/lines | Decision |
| --- | ---: | ---: | --- |
| `ctx_execute` | 249 / 249 / 4 | 215 / 215 / 4 | Compact proof; fenced source unchanged |
| `ctx_execute_file` | 267 / 267 / 5 | 235 / 235 / 4 | Path folded into proof |
| `ctx_index` | 137 / 137 / 2 | 98 / 98 / 1 | Exact source and search call retained |
| `ctx_search` | 167 / 165 / 1 | 72 / 72 / 1 | Throttle guidance compacted; matches unchanged |
| `ctx_fetch_and_index` | 290 / 286 / 4 | 127 / 127 / 1 | Cache, age, TTL, search, refresh retained |
| `ctx_batch_execute` | 828 / 828 / 10 | 303 / 303 / 2 | Commands, exact indexed source, and batch digest retained |
| `ctx_stats` | 19 / 19 / 1 | 19 / 19 / 1 | Capability-bearing result intentionally unchanged |
| `ctx_checkpoint_report` | 163 / 163 / 7 | 142 / 142 / 1 | Compact JSON plus structured parity |
| `ctx_recovery_brief_init` | 200 / 200 / 9 | 171 / 171 / 1 | Compact JSON plus structured parity |
| `ctx_recovery_brief_status` | 212 / 212 / 9 | 183 / 183 / 1 | Compact JSON plus structured parity |
| `ctx_recovery_brief_update` | 205 / 205 / 9 | 176 / 176 / 1 | Conflict/error fields retained |
| `ctx_doctor` | 203 / 201 / 7 | 200 / 198 / 3 | Successful checks grouped; WARN/FAIL remain separate |
| `ctx_upgrade` | 371 / 371 / 9 | 147 / 147 / 4 | Exact command and restart action retained |
| `ctx_purge` | 19 / 19 / 1 | 19 / 19 / 1 | Destructive scope/result intentionally unchanged |
| `ctx_insight` | 19 / 19 / 1 | 19 / 19 / 1 | Already minimal |

Aggregate wrapper measurements:

- UTF-8 bytes: `3349 -> 2126`, a `36.52%` reduction.
- Unicode characters: `3341 -> 2124`, a `36.43%` reduction.
- Non-empty lines: `79 -> 27`, a `65.82%` reduction.
- Representative queried batch wrapper: `828 -> 303` characters and
  `10 -> 2` non-empty lines, a `63.41%` character reduction.

These figures measure context-mode MCP return wrappers only. They exclude the
actionable result fixture because it is byte-for-byte unchanged, and they do
not measure or claim a reduction in the Codex host-owned `Called` input area.

## Query Schema Finding

The planned no-query batch fixture was rejected by source history. The initial
batch implementation in commit `103b41dd` and the current schema both define
`ctx_batch_execute.queries` as required with `.min(1)`. A no-query handler path
is therefore not a supported or reachable protocol surface, and this
presentation task does not broaden the input schema. The queried response now
reports the exact persistent source (`batch:<labels>`) so later
`ctx_search(..., source: ...)` remains discoverable.

