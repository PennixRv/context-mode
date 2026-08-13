# PRD: Converge Issue 009 Diagnostics And Issue 070 Test Routing

Date: 2026-08-13
Baseline: `v1.0.187` / `a60080e82fb57adf77b119cab84bd92408ede1b9`

## Goal

Deliver one installable Linux/WSL context-mode release that makes Plugin diagnostics
consistent across the direct CLI Doctor, MCP `ctx_doctor`, and `codex plugin list --json`,
and routes common test-execution commands through context-mode when their output is
unbounded. The component must retain direct-call semantics for lifecycle, interaction,
navigation, file modification, bounded structured protocols, and explicitly excluded
external tools.

## Confirmed Facts

- Root-side v1.0.187 evidence shows the direct Doctor can identify the configured and
  runtime Plugin roots, while MCP `ctx_doctor` cannot prove the same runtime facts and
  can incorrectly project absent Hook state as `missing`.
- The diagnostic contract must distinguish `present`, `missing`, `unavailable`, and
  `not_applicable`; lack of observation is not proof of absence.
- Root-side v1.0.187 routing evidence shows `pnpm test`, `npm test`, `./gradlew test
  --info`, `pytest`, and `go test ./...` are not currently recognized, while existing
  long-output routing remains active.
- The authoritative combined handoff and the two Issue files are read-only integration
  evidence. This task does not change them or any parent-repository state.

## Requirements

### Issue 009: layered Plugin diagnostics

1. Define a typed, shared diagnostic fact model used by the direct CLI Doctor, MCP
   `ctx_doctor`, and `codex plugin list --json` projection. It must include `plugin_id`,
   version, installed/enabled state, source/configured root, cache root, runtime root,
   manifest state, Hook registration/presence state, and whether the current session's
   Hook loading can be proven.
2. Preserve separate roots and provenance instead of inferring one root from another.
   Normal installation, configured/runtime root mismatch, missing manifest or Hook,
   absent cache installation, disabled Plugin, and unobservable current-session loading
   must each be represented by structured, stable states.
3. Use `unavailable` or `not_applicable` when a fact cannot be observed or does not apply;
   never report `missing` solely because a probe was unavailable. Diagnostics must be
   bounded and must not include credentials, session content, databases, caches, or
   runtime state dumps.
4. Keep the diagnostic output actionable while maintaining compatibility with existing
   callers and the compact presentation contracts from Issues 041 and 054.

### Issue 070: structured test-command routing

1. Recognize common test execution families: `pnpm test`, `npm test`, `yarn test`,
   Vitest/Jest, `pytest`/`tox`, Gradle/Maven/SBT, `go test`, and `cargo test`.
2. Match command position and execution grammar, including executable paths, wrappers,
   argument forms, environment-variable prefixes, and compound shell commands. Support
   first and repeated calls without a guidance-throttle marker changing the routing
   decision. Do not route arbitrary commands merely because a token contains `test`.
3. Preserve command outcome semantics for success, ordinary non-zero exit, syntax error,
   timeout, and bounded/truncated output. A routed command must not be reported as
   completed when execution failed or only a title/error was indexed.
4. Keep short observation, file modification, navigation, process control, Trellis and
   Governance lifecycle/wait-next, CodeGraph, Fast Context, OpenViking, unknown MCP
   tools, and other bounded structured protocols on their direct routes. This is a
   routing/presentation contract, not a security sandbox.

## Acceptance Criteria

- [ ] `AC-009-1`: shared structured diagnostics produce identical field meanings for
  direct CLI Doctor, MCP `ctx_doctor`, and `codex plugin list --json`; normal installation
  reports the correct identity, version, roots, manifest, Hook state, and session-loading
  observation state.
- [ ] `AC-009-2`: fixture tests cover root mismatch, missing manifest/Hook, absent cache,
  disabled Plugin, and unobservable session loading; none mislabel an unavailable fact as
  `missing`.
- [ ] `AC-009-3`: actual CLI/MCP/plugin-list integration paths serialize the same model,
  and existing #041/#054 presentation budgets, `CONTEXT_MODE_PLATFORM`, and other platform
  manifests do not regress.
- [ ] `AC-070-1`: classifier tests cover all listed test families, wrappers, executable
  paths, arguments, environment prefixes, compound shell commands, first/repeated calls,
  and both POSIX/Linux and WSL-supported behavior.
- [ ] `AC-070-2`: success, non-zero, syntax error, timeout, truncation, and indexed-body
  assertions preserve the underlying execution result and do not create false successful
  candidates.
- [ ] `AC-070-3`: non-test commands containing `test`, plus direct lifecycle, bounded
  protocol, and excluded-tool routing controls remain direct.
- [ ] `AC-CROSS-1`: formatting, lint, typecheck, build, focused tests, full tests, bundle
  and manifest/provenance checks pass; repeated builds show no unexplained drift.
- [ ] `AC-RELEASE-1`: a new non-prerelease Linux/WSL release is published through the
  repository's existing release workflow, with annotated tag metadata, peeled commit,
  source candidate, asset SHA-256 values, provenance, CI/Release status, and a clean
  component worktree recorded for root-side installation/restart/MCP acceptance.

## Out Of Scope And Boundaries

- No changes to the parent repository, parent Issues, parent Trellis tasks, `/home/penn/.codex`,
  Governance Plugin, sibling components, Gitlinks, or Plugin installation state.
- No Windows/macOS support expansion, no real credentials, and no reading or committing
  session content, databases, caches, or runtime state.
- No claim that Codex-host-owned Called input rendering has been shortened, and no change
  to root-side global routing policy. Issue 018 remains a root-side acceptance item.

## Root-Side Handoff

After release, the root workflow must install the published component using its own Plugin
update procedure, restart Codex, and perform the real CLI Doctor, MCP `ctx_doctor`,
`codex plugin list --json`, and PreToolUse routing acceptance. The component session stops
after release and does not close root Issues or update the root Gitlink.
