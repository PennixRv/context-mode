# Quality Check: Execution Boundary Hardening

Date: 2026-08-10

Correlation IDs: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`

## Outcome

PASS. The implementation, restricted subprocess probes, MCP integration,
compatibility regressions, type checking, full suite, build, bundle assertions,
generated drift checks, response measurements, task validation, and spec sync
are complete. No Codex subagent or Trellis channel performed implementation or
checking.

The repository has no `lint` script, so there is no independent lint command to
run. `tsc --noEmit`, Vitest, build assertions, source-form contract tests, and
`git diff --check` provide the available project checks.

## Baseline

The original command transcript was not retained before the first edit. To
avoid inventing a baseline, the exact start commit was extracted with
`git archive 3f3114d5bad90f94577ab40729da6ecbc9d9df57` into a temporary directory,
built using the same frozen dependencies, and tested retrospectively:

```text
Test Files  7 passed (7)
Tests       259 passed | 25 skipped (284)
```

The temporary baseline covered issue #852, security, executor, cwd override,
shared server handlers, and source/command echo tests. The archive and generated
files were removed after the run.

## Review Findings And Resolutions

1. Restricted startup correctly skipped preload and readiness-file creation,
   but top-level and shutdown handlers still attempted to unlink those paths.
   A stale file with a reused PID could therefore be deleted. Both deletion
   paths are now compatibility-only, and a real restricted child-server test
   creates colliding files before shutdown and proves they remain.
2. Initial bubblewrap profiles mishandled merged-`/usr` symlinks and could fail
   capability detection on a supported Linux host. Probe and execution now
   share symlink-aware read-only path construction.
3. The compatibility project resolver falls back to transcripts, `PWD`, and
   `cwd`; it cannot authorize restricted execution. Restricted mode now requires
   an explicit absolute canonical `CONTEXT_MODE_RESTRICTED_PROJECT_ROOT`.
4. `start.mjs` previously ran self-heal writes before server policy resolution.
   Restricted and invalid startup now skip repair/install/build mutations and
   require shipped bundles.
5. Existing static startup and tool-description contracts initially failed
   after the new guards/prefixes. The implementation retains their ordering and
   real-newline source form while preserving the restricted gates.

Detailed RecoveryBrief MCP observations are recorded separately in
`research/recovery-brief-mcp-observations.md`; they do not expand the two root
issues in this task.

## Cross-Layer Review

- Authority flow: server environment -> `resolveExecutionPolicy()` ->
  `validateRestrictedInvocation()` -> `PolyglotExecutor` isolation object.
  MCP input never supplies authority.
- Result flow: restricted output -> request-local formatter ->
  `finalizeExecutionResponse()` without `trackResponse`, ContentStore, SessionDB,
  statistics, event, or FTS5 writes.
- Presentation flow: environment -> typed `PresentationPolicy` -> source,
  command, title, searchable-term, and result-preview renderers.
- Dependency flow is acyclic: presentation is independent; ephemeral search
  depends on presentation; execution policy is independent; executor depends on
  policy; server composes all three.
- Compatibility flow remains writable, network-enabled, background-capable,
  and persistent, with non-read-only MCP metadata.

## Validation

```text
Targeted matrix
  12 test files passed
  295 passed | 25 skipped (320)

Restricted real subprocess and MCP probes after lifecycle fix
  2 test files passed
  17 passed (17)

Source-form and startup contracts
  3 test files passed
  784 passed (784)

Full suite (`TMPDIR=/tmp pnpm test`)
  230 test files passed
  4970 passed | 41 skipped (5011)

`pnpm run typecheck`
  PASS

`pnpm run build`
  PASS
  assert-bundle: all declared bundles OK
  assert-asymmetric-drift: OK

Second build reproducibility
  server.bundle.mjs sha256
    4c8d8671bdf75032cd6e7f1baea5c71c8005d481ceaaab7ee63803d2ef4209e6
  cli.bundle.mjs sha256
    ab5a605faff609c2fc54062382a35a4fa63040258c5c4732a5e865e880853340
  both unchanged across consecutive builds

`git diff --check`
  PASS
```

The task-local SDK measurement probe also returned zero files under its
temporary storage, home, and host-temp roots for every default/configured
restricted scenario.

## Residual Risk

- Enforced restricted execution is supported only on Linux hosts where the
  real bubblewrap probe succeeds. macOS and Windows deliberately fail closed.
- User-managed nvm/asdf/pyenv-style runtime prefixes are mounted read-only when
  selected, but this host's real probes exercised only its installed runtime
  layout. Additional Linux distributions and runtime managers remain release
  portability coverage.
- The system interpreter/runtime support view is readable by design; the
  project-data boundary does not claim to hide files required to launch the
  selected interpreter.
- Component completion does not restore any external integration allowlist.
  The integration repository still requires its separate live read-only-node
  acceptance.
- Codex owns MCP input rendering. The full `Called` argument area is unchanged
  and cannot be bounded by this component.
