# Trellis Check: Issue 009 Doctor Runtime Facts

Date: 2026-08-13
Baseline: `v1.0.188` / `f9a817a76a19aa9555e53d8b3d16a38091ab0ab1`
Target branch: `devel`

## Findings

- The defect is a cross-layer contract and integration-test gap, not evidence
  that the Codex host failed to install or load the Plugin.
- v1.0.188 tested CLI and MCP serialization with one complete environment,
  bypassing the Plugin manifest boundary. The new built-entry test projects the
  MCP environment from `.codex-plugin/mcp.json` and reproduces the real split.
- One `PlatformDiagnosticReport` now supplies Hook checks, structured output,
  and registration from one typed snapshot. Other adapters retain their
  existing fallback methods and three-state result behavior.
- Every non-present Codex field has a stable reason. Observation failure has no
  repair action; proven cache corruption and release drift retain their
  respective reinstall and restart actions.
- `session_hooks_loaded` remains unavailable because no current Codex child
  process capability proves host-session Hook loading. Runtime Hook declarations
  remain independently observable.
- The exact MCP allowlist adds only `PATH`, `HOME`, and `CODEX_HOME` to the five
  existing presentation variables. It contains no credentials or fixed local
  paths and keeps `CONTEXT_MODE_PLATFORM=codex` fixed.
- CLI, MCP, Skill, source manifest, generated marketplace, offline installation,
  npm package, and release verifier use one consistent contract.

## Quality Gates

```text
git diff --check: PASS
TypeScript typecheck: PASS
Hook/release script syntax: PASS
focused final matrix: 7 files, 696 passed
build + 9 bundle assertions + asymmetric drift: PASS
full suite: 243 files, 5175 passed, 41 skipped
two final marketplace builds: byte-identical
offline marketplace install/normalize/stdio initialization: PASS
npm pack content and version: PASS
Trellis context validation: PASS
```

No `lint` or `format:check` scripts or baseline executables exist in this
repository; this is an unavailable baseline gate rather than a skipped failing
command. No debug output, type-safety suppression, credential, runtime state,
database, cache, or generated temporary asset was added to Git.

## Break-Loop Capture

- Category: cross-layer contract plus integration test coverage gap.
- Architecture prevention: one diagnostic snapshot and one closed reason type.
- Test prevention: launch the MCP child through the source manifest environment
  projection and verify generated/offline manifest parity.
- Review prevention: any Plugin MCP feature that depends on parent discovery
  must review source manifest, normalized Codex transport, adapter facts, both
  renderers, and release asset together.
- Knowledge capture: `.trellis/spec/backend/codex-diagnostics-and-test-routing.md`
  now records the exact environment and one-report contract. No separate
  template mirror exists for this project-local executable spec.

## Residual Limits

- Linux/WSL is the supported root acceptance target for this issue. Existing
  cross-platform unit coverage remains green, but no claim is made that this
  session dynamically installed the Plugin on macOS or Windows.
- Codex itself owns Plugin inventory schema, process environment projection,
  current-session Hook loading, and host UI rendering. The component reports
  explicit unavailability where those facts are not exposed.
- Final Issue closure remains root-owned after immutable release installation,
  Codex restart, and same-session CLI/MCP comparison.
