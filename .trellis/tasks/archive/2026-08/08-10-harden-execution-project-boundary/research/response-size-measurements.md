# Restricted MCP Response Size Measurements

Date: 2026-08-10

## Method

Run the task-local SDK probe after a successful build:

```bash
node .trellis/tasks/08-10-harden-execution-project-boundary/research/measure-response-sizes.mjs
```

The probe starts a fresh restricted `start.mjs` server for each scenario with a
temporary project, home, storage root, and host temporary directory. It calls
`ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute`, counts Unicode code
points and logical lines in the complete MCP text result, then confirms all
three state roots contain zero files before cleanup.

Inputs were a 4,020-character, 2-line JavaScript source; a 4,027-character
execute-file source; and a 1,550-character batch shell command. The
`legacy-proxy` scenario uses the new metadata framing with the prior 2,000 code
preview budget and maximum summary budgets. It isolates budget impact but is
not represented as a byte-for-byte replay of an older release.

## Results

| Scenario | `ctx_execute` | `ctx_execute_file` | `ctx_batch_execute` | Storage/home/tmp files |
| --- | ---: | ---: | ---: | ---: |
| 2,000 preview proxy | 2,234 chars / 10 lines | 2,251 chars / 11 lines | 2,166 chars / 25 lines | 0 / 0 / 0 |
| Default policy | 473 chars / 10 lines | 490 chars / 11 lines | 1,342 chars / 25 lines | 0 / 0 / 0 |
| Configured compact (80/80/32/5/200) | 312 chars / 10 lines | 329 chars / 11 lines | 938 chars / 25 lines | 0 / 0 / 0 |
| Zero policy (64/64/16/0/160 effective) | 296 chars / 10 lines | 313 chars / 11 lines | 764 chars / 23 lines | 0 / 0 / 0 |

Compared with the 2,000-preview proxy, the default complete response is 78.8%
smaller for `ctx_execute`, 78.2% smaller for `ctx_execute_file`, and 38.0%
smaller for this batch fixture. The configured compact response is 86.0%,
85.4%, and 56.7% smaller respectively. The zero-policy minimum is 86.7%,
86.1%, and 64.7% smaller respectively.

## Host-Owned Input Display

The same 4,020-character source and 1,550-character command remain MCP input
arguments. Codex constructs its `Called` display from those arguments before
the MCP server result is available. Context-mode cannot reduce that payload or
its host-dependent terminal wrapping. Consequently this measurement quantifies
only context-mode return content and does not claim any reduction in the
`Called` area.
