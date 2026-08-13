# Result: Issues 009 And 070

Date: 2026-08-13

## Identity

- Baseline: `v1.0.187` / `a60080e82fb57adf77b119cab84bd92408ede1b9`
- Implementation branch: `fix/issue-009-070-diagnostics-test-routing`
- Implementation commit: `be50f61727e993b13e486a5e24de753a1d74837c`
- Release version: `1.0.188` / `v1.0.188`
- Source candidate: the clean `devel` commit created after this task archive and
  the remote `origin/devel` fast-forward integration; record the exact hash below
  before release tagging.

## Issue 009

Root cause was a conflation of the Codex Plugin-manager cache path with the
package root loaded by the current Doctor/MCP process, plus boolean Hook checks
that treated an unavailable probe as absence. `src/adapters/codex/diagnostics.ts`
now defines the typed projection and stable check IDs. `src/adapters/codex/index.ts`
collects the upstream `codex plugin list --json` facts, bounded legacy fallback,
config state, cache manifest, loaded runtime manifest, and Hook declarations while
keeping source, cache, configured, and runtime roots separate. `src/cli.ts` and
`src/server.ts` serialize the same content-free JSON projection. Unobservable
current-session Hook loading remains `unavailable`.

Regression coverage includes normal installation, wrong root, matching/different
release roots, missing cache, disabled Plugin, missing cache/runtime manifest,
missing Hook event, empty/unavailable Plugin-list output, and CLI/MCP fixture
serialization equality in `tests/adapters/codex-diagnostic-projection.test.ts`,
`tests/adapters/codex.test.ts`, and `tests/plugins/codex-doctor-entrypoints.test.ts`.

Conclusion: component-side Issue 009 is fixed. Codex host session loading and the
Codex CLI's own JSON schema remain upstream facts; context-mode only consumes and
projects them.

## Issue 070

Root cause was the absence of command-position grammar for common test executors;
the existing generic output guidance therefore returned `null` for valid first
and repeated test commands. `hooks/core/routing.mjs` now lexically recognizes
package-manager scripts, Vitest/Jest, Pytest/Tox, Gradle/Maven/SBT, Go, and Cargo,
including supported wrappers, paths, options, environment prefixes, and compound
branches. It never evaluates or reparses user text and never matches only because
an argument or filename contains `test`.

`tests/core/test-command-routing.test.ts` and `tests/hooks/core-routing.test.ts`
cover family matrices, first/repeat calls, host tool aliases, false positives,
success/non-zero/syntax-error/timeout/output-cap results, success-only searchable
bodies, direct lifecycle/process/navigation controls, and bounded external MCP
protocols.

Conclusion: component-side Issue 070 is fixed. Routing is an output aggregation
hint, not a permission sandbox; host execution and result status remain
authoritative.

## Validation

```text
focused issue/adapter/hook matrix: 11 files, 926 passed
focused routing matrix after outcome expansion: 80 passed
version/manifest/marketplace regression matrix: 4 files, 51 passed
typecheck: PASS
Hook node --check: PASS
git diff --check: PASS
Trellis task validate: PASS
full candidate test suite: 243 files, 5170 passed, 41 skipped
build, assert-bundle, assert-asymmetric-drift: PASS
two consecutive full builds: identical bundle SHA-256 values
two consecutive marketplace archives: identical SHA-256
offline Codex marketplace install, manifest and stdio MCP boot: PASS
```

The repository has no `lint` or `format:check` package script; those named gates
are unavailable in the baseline and no substitute tool was added. The applicable
type/build/test/diff gates passed.

## Release Asset Measurements

- Marketplace archive: `context-mode-codex-marketplace-v1.0.188.tar.gz`,
  SHA-256 `e0f44ebacc00f31dc13004249d3e157e8f840ff97e9752fd2b0f178008fd30ab`.
- Marketplace `CONTENT-MANIFEST.json` SHA-256:
  `b257399c639ce3c8dac4f52f36ef0a2a5f88fc12334499b8767ba57bb62f3b04`.
- npm archive: `context-mode-1.0.188.tgz`, SHA-256
  `4f02b524ea5228a6afb2089bc6dfacbff53b2feb37b6dc14f6d5c2313cfa4ec1`.
- Marketplace manifest entries: `125`.
- Codex MCP `env_vars`: exactly
  `CONTEXT_MODE_CODE_ECHO_MAX`, `CONTEXT_MODE_COMMAND_ECHO_MAX`,
  `CONTEXT_MODE_TITLE_PREVIEW_MAX`, `CONTEXT_MODE_SEARCHABLE_TERMS_MAX`,
  `CONTEXT_MODE_RESULT_PREVIEW_MAX`; fixed `CONTEXT_MODE_PLATFORM=codex`.

The offline verifier passed with the host defaults and with the configured
non-sensitive presentation values `64/64/16/0/160`; it did not install into the
normal Codex profile. Codex host-owned Called input rendering is not claimed to
be shortened.

## Root Handoff And Remaining Risk

The root workflow must fast-forward/update its Gitlink only after independently
verifying the published `devel` source and release, install the immutable Plugin
using `$codex-plugin-update`, restart Codex, and run real CLI Doctor, MCP
`ctx_doctor`, `codex plugin list --json`, and PreToolUse tests. Issue 010's global
CodeGraph precedence, Issue 018's cross-repository aggregation routing, and
Issue 067's global tool-routing policy remain root-owned acceptance work; this
component preserves their approved direct-protocol and aggregation boundaries.

No component change modifies parent Issues, `/home/penn/.codex`, Governance
Plugin, sibling repositories, Gitlinks, credentials, session data, databases,
caches, or runtime state.
