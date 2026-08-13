# Issue 009 Results

## Baseline Red Reproduction

Command run from `v1.0.188` source baseline after changing only the temporary test fixture to
project the MCP environment from `.codex-plugin/mcp.json`:

```bash
node_modules/.bin/vitest run tests/plugins/codex-doctor-entrypoints.test.ts
```

Result: expected failure (`1 failed, 1 passed`). CLI Doctor observed the synthetic installed Plugin,
source root, cache root, and `different_matching_release`. MCP Doctor, started with the source
manifest projection, reported standalone/not installed and lost source/cache/alignment facts. The
fixture used only temporary paths and synthetic Plugin output; it did not read a real Codex profile,
credentials, session data, database, or cache.

The first attempt to invoke `pnpm` returned exit 127 because this shell does not currently expose a
global `pnpm` or `corepack`. The repository's existing `node_modules/.bin/vitest` provided the same
locked test runner without changing external state. Release validation must restore the declared
`pnpm@10.23.0` command through an isolated/local mechanism before running package scripts.

## Green Evidence

### Root Cause

The v1.0.188 split had two independent causes:

1. `.codex-plugin/mcp.json` forwarded only the five presentation-budget
   variables. The Plugin-started MCP child therefore did not receive `PATH`,
   `HOME`, or `CODEX_HOME`, even though Codex diagnostics use those values to
   locate the `codex` executable and configuration profile. Direct CLI Doctor
   inherited those discovery inputs from the shell.
2. Hook validation, structured serialization, and MCP-registration validation
   each recollected Plugin facts. An unavailable probe could therefore produce
   several inconsistent repair warnings. The typed projection also lacked a
   machine-readable reason for each non-present observation.

The runtime manifest was not a missing evidence source. It can prove package
contents and declared Hook events, but it cannot prove that the already-running
Codex host loaded those Hooks into the current session.

### Implementation

- `src/adapters/codex/diagnostics.ts` defines a closed reason vocabulary and
  distinguishes confirmed missing, unavailable, and not-applicable observations.
- `src/adapters/codex/index.ts` collects one report snapshot for Hook checks,
  structured JSON, and registration; unavailable inventory no longer emits an
  installation repair warning. A confirmed installation with an omitted cache
  root also reports only an unavailable Plugin root, without a repair action.
- `src/cli.ts` and `src/server.ts` consume the shared report. MCP and CLI render
  unavailable observations separately from warnings and failures.
- `.codex-plugin/mcp.json` forwards exactly `PATH`, `HOME`, `CODEX_HOME`, and the
  existing five presentation variables while retaining fixed
  `CONTEXT_MODE_PLATFORM=codex`.
- `skills/ctx-doctor/SKILL.md`, `README.md`, the release note, and the executable
  Trellis spec document the shared observation and host-session limitations.
- The generated CLI and server bundles and every version-managed manifest are
  synchronized at `1.0.189`.

### Regression Matrix

- Built CLI Doctor and MCP `ctx_doctor` run against the same synthetic Plugin
  installation, while the MCP child receives only the source manifest's
  projected environment. Their structured diagnostics are byte-for-byte equal.
- Projection/adapter tests cover normal installation, not listed, not installed,
  disabled, inventory execution failure, a matching row with omitted fields,
  missing cache manifest, missing runtime manifest, missing Hook events,
  matching releases at different roots, stale releases, and unobservable
  current-session Hook loading.
- Manifest and release-asset tests require exact source/generated/installed
  parity for all eight `env_vars` and reject credential-like names.
- The Skill and MCP description retain the renderer-safe `[UNAVAILABLE]`
  contract and forbid treating observation failure as repair evidence.

### Validation

```text
focused final matrix: 7 files, 696 passed
typecheck: PASS
Hook and release-verifier node --check: PASS
git diff --check: PASS
build: PASS
assert-bundle: PASS (9 bundles)
assert-asymmetric-drift: PASS
final full suite: 243 files, 5175 passed, 41 skipped
Trellis context validation: PASS (4 implement + 4 check entries)
two consecutive final marketplace builds: byte-identical
offline marketplace install and codex mcp list normalization: PASS
offline stdio MCP initialization: PASS
npm package content/version inspection: PASS
```

The repository has no `lint` or `format:check` package scripts and no baseline
ESLint/Prettier executable. The applicable type, build, test, syntax, diff,
bundle, drift, package, and marketplace gates passed.

### Final Pre-Commit Asset Measurements

- Marketplace archive: `context-mode-codex-marketplace-v1.0.189.tar.gz`,
  SHA-256 `c07ca8d1cf609c16321caae241c044f5d8642952ca11dd2fb1d9560e007f116a`.
- Marketplace checksum asset:
  `context-mode-codex-marketplace-v1.0.189.tar.gz.sha256`, SHA-256
  `41574e0697b184bdf16ca8f2f97e45e5d39d54bb936dc40f13c692444a23d46d`.
- Marketplace `CONTENT-MANIFEST.json` SHA-256:
  `71f0afdfd72887dc6737a91f2ca937ce904fac2e331d0005ddead350d4e9c8c0`.
- npm package: `context-mode-1.0.189.tgz`, SHA-256
  `df046370b0cb546ee2edefb0924095422ac45f57408149d01a9d9cb60a4fc8ab`.
- Marketplace manifest entries: `125`.

Release workflow rebuilds remain authoritative; published asset digests must be
checked again after the annotated tag completes.

### Conclusion And Root Handoff

Component behavior satisfies Issue 009's static and synthetic dynamic contract.
The root workflow must install the immutable release through its Hook-safe
Plugin update transaction, restart Codex, and compare in one new session:

```bash
node /home/penn/.codex/plugins/cache/context-mode/context-mode/1.0.189/cli.bundle.mjs doctor
codex plugin list --json
```

It must also call `mcp__context_mode__ctx_doctor({})` in that same new session.
The CLI and MCP `Codex Plugin diagnostic (JSON)` values must agree for Plugin
identity/version, installed/enabled state, source/cache/runtime roots, cache
manifest, runtime/cache alignment, and runtime Hook declarations. Both may
truthfully report `session_hooks_loaded` as unavailable with
`host_session_observation_unavailable`; that is not a Plugin failure.

Issue 009 closure remains pending this root-owned installed-session acceptance.
This component task does not install the Plugin, modify `/home/penn/.codex`,
close the parent Issue, update its Gitlink, or read/copy normal-profile
credentials, sessions, databases, or cache contents.
