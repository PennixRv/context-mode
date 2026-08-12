# v1.0.186 Issue Audit

Baseline: `v1.0.186`, peeled commit `3238b72a28d7b99717ec5f6a35ef21650922d539`.

This is a premise audit, not a mechanical acceptance of the parent issue text.
The parent issue files are read-only integration inputs. The classifications
below are based on the shipped source, tests, manifests, and executable probes
available during planning.

| Issue | Classification | Evidence and consequence |
| --- | --- | --- |
| 003 | Premise invalid for current Codex execution, configuration risk real | `.codex-plugin/hooks.json` and `configs/codex/hooks.json` put bare `ctx_execute` in the first exact matcher and fully qualified names in a regex matcher. A JavaScript regex probe reports two groups, but Codex's current matcher implementation treats strings containing only ASCII letters/digits/underscore/pipe as exact alternatives, so `ctx_execute` does not match `mcp__...__ctx_execute`. This is verified by the upstream `codex-rs/hooks/src/events/common.rs` matcher implementation and the repository's `tests/adapters/codex.test.ts` exact-matcher contract. The configuration remains fragile if it gains regex characters or the upstream matcher semantics change. Converge to one explicit exact matcher inventory and test it with a real dispatch counter. |
| 009 | Partially fixed | Since v1.0.173, the Codex adapter parses plugin-manager output, distinguishes configured and runtime roots, and validates installed hook assets. Live `codex plugin list` reports `context-mode@context-mode` enabled at the marketplace root and v1.0.186. CLI Doctor reports the same root and active hooks. However, CLI Doctor, MCP `ctx_doctor`, and plugin-list data are assembled through separate paths and have no shared typed layered result. The remaining work is consistency and fixture coverage, not a second root parser. |
| 010 | Reproduced | `skills/context-mode/SKILL.md` currently says to use context-mode for all commands and routes CodeGraph-sized questions through context-mode based on output size. It has no approved `.codegraph/` precedence contract. This can cause a source scan to replace an available symbol/call graph. The component can correct the Skill and component routing contract; the parent AGENTS/global CodeGraph policy remains root-owned. |
| 012 | Reproduced | CLI Doctor compares versions with equality and warns when local v1.0.186 is different from npm v1.0.169, which is a downgrade warning. `src/server.ts` and `src/session/analytics.ts` contain separate simplistic comparators or equality checks. Channel identity is not carried through the diagnostic result, so npm, Codex marketplace, standalone/Git, and unknown installs can be mixed. |
| 013 | Reproduced | Compatibility `ctx_execute` and `ctx_execute_file` automatically persist intent/large output into FTS5, and compatibility `ctx_batch_execute` indexes its combined output unconditionally. Restricted mode already has request-local formatting, but compatibility mode has no explicit non-persistent input. Failed output can therefore become persistent candidate content. |
| 018 | Component portion partially fixed; global premise remains open | The root issue is cross-repository. The component already has managed Bash aggregation guidance and exact external-MCP passthrough, but `guidanceOnce` throttles repeated aggregation advice and the Skill's all-command rule conflicts with a stable direct/aggregate exception matrix. This task will preserve and test component aggregation; it will not close or edit root-owned global enforcement. |
| 053 | Reproduced | The archived measurement script resolves the repository root by four fixed parent traversals, which is wrong for an archived task path. Its MCP child stderr is discarded, so startup/request/close failures collapse to a generic connection failure. |
| 064 | Reproduced in compatibility mode | `ctx_execute_file` calls `checkProjectBoundary` before the host Read deny policy and rejects external paths. The executor resolves the path relative to the project root but does not preflight a bounded regular file before injecting it into the child runtime. Restricted mode separately enforces its project-root isolation and must keep doing so. |
| 067 | Partially fixed | The Hook already passes names classified as external MCP directly through and context-mode-owned MCP execution tools bypass shell policy routing as intended. The shipped Skill still routes all tools through context-mode, lacks lifecycle/structured-protocol exceptions, and overstates `ctx_search`, `ctx_index`, web and Fast Context behavior. The missing work is one shared semantic routing/trust matrix across Skill, Hook, tool descriptions and tests. |
| 068 | Reproduced | POSIX `buildBatchNodeOptionsPrefix` returns `NODE_OPTIONS='...' ` directly before the user command, so a script beginning with `for`, `if`, `while`, a brace group or a function definition is parsed incorrectly. Batch status code only distinguishes timeout from completion and does not propagate ordinary non-zero exits. Compatibility batch indexing also accepts error/title-only output as collected content. |

## Baseline Probes

- Branch/head/remote baseline: `devel` at `3238b72...`, equal to
  `origin/devel`, clean before task creation; tag `v1.0.186` is annotated and
  peels to the same commit.
- Live marketplace: `codex plugin list` reports the plugin enabled at
  `/home/penn/.codex/.tmp/marketplaces/context-mode`, version `1.0.186`.
- Live MCP registry: `codex mcp list --json` reports the context-mode stdio
  entry with `CONTEXT_MODE_PLATFORM=codex` and all five Issue 054
  `env_vars`; this is installed-release evidence only and is not modified by
  this task.
- Live CLI Doctor: local/plugin v1.0.186 versus npm v1.0.169 emits two WARN
  lines with `ctx_upgrade`, demonstrating the Issue 012 downgrade bug.
- Upstream matcher contract: current Codex `matches_matcher` uses exact
  alternatives when all matcher characters are ASCII alphanumeric, `_`, or
  `|`; only other matcher strings use the Rust regex engine. Source reference:
  `https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/common.rs`
  (`validate_matcher_pattern`, `matches_matcher`, `is_exact_matcher`).

## Scope Decisions

- Issue 003 receives a defensive manifest/test fix even though the exact
  current Codex matcher makes the reported duplicate execution impossible.
- Issue 009 receives a shared diagnostic model and Codex marketplace fixtures;
  existing root-aware parsing is retained and extended rather than replaced.
- Issue 018 is reported as a component evidence contribution only. The parent
  workflow must decide the global policy and issue status.
- Issue 010 and 067 are implemented through one routing matrix so CodeGraph,
  Fast Context, direct structured MCP, and context-mode aggregation cannot drift
  into separate prose contracts.
