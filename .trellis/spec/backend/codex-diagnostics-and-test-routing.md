# Codex Diagnostics And Test Routing

## 1. Scope / Trigger

Apply this contract when changing the Codex Plugin Doctor projection, Codex
marketplace diagnostics, or PreToolUse routing for test commands. The contract
spans upstream Plugin inventory parsing, the TypeScript adapter, CLI/MCP output,
and the shipped Hook manifest.

## 2. Signatures

```ts
parseCodexPluginList(raw: string): CodexPluginListEntry
projectCodexPluginDiagnostic(facts: CodexPluginDiagnosticFacts): CodexPluginDiagnostic
serializeCodexPluginDiagnostic(diagnostic: CodexPluginDiagnostic): string
isTestExecutionCommand(command: string): boolean
```

The CLI Doctor and MCP `ctx_doctor` collect one diagnostic report and render
its Hook checks, structured projection, and registration result. `codex plugin
list --json` is an upstream input, with bounded legacy text fallback;
context-mode does not rewrite the Codex CLI's own schema.

## 3. Contracts

### Doctor observations

Every diagnostic check uses exactly one of `present`, `missing`,
`unavailable`, or `not_applicable`. Shared top-level fields are:

- `plugin_id`, `version`, `installed`, `enabled`
- `source_root` (marketplace/source inventory)
- `cache_root` (installed Plugin cache)
- `runtime_root` (package root loaded by this MCP/CLI process)
- stable `checks` for identity, version, installation, enabled state, source
  root, cache root/manifest, runtime root/cache alignment, runtime manifest,
  runtime Hooks, and current-session Hook loading

`unavailable` means the host or probe did not expose evidence. It must not be
converted to `missing`. A filesystem manifest proves package contents only; it
does not prove that an already-running host session loaded the Hook.

Nested Codex CLI probes must pass an explicit, existing working directory. The
candidate order is `CODEX_HOME`, `HOME`, then the operating-system home
directory; `process.cwd()` is never a diagnostic fallback because a Plugin MCP
process may inherit a deleted update-backup directory. If all candidates are
unusable, the probe reports `codex_cli_cwd_unavailable`. Command startup,
non-zero exit, timeout, and generic invocation failures retain separate reason
codes. This is a component-side diagnostic mitigation; it does not repair the
Codex host's Plugin update cleanup or guarantee the host process itself has a
stable cwd.

The Codex MCP manifest forwards the exact read-only discovery variables
`PATH`, `HOME`, and `CODEX_HOME`, plus the five bounded presentation variables.
It keeps `CONTEXT_MODE_PLATFORM=codex` fixed and does not forward credentials or
an open-ended environment. This gives the CLI and MCP processes the same
Codex executable and profile discovery inputs without hard-coding a root.

### Test routing

The classifier recognizes command-position grammar for package-manager test
scripts, Vitest, Jest, Pytest, Tox, Gradle, Maven, SBT, `go test`, and
`cargo test`. It unwraps only bounded syntactic wrappers and prefixes:
environment assignments, `env`, `npx`, `npm/pnpm/yarn exec`, `command`, `exec`,
`time`, `sudo`, `timeout`, `sh`/`bash`/`zsh -c`, `corepack`, executable paths,
common path/option values, and compound shell branches.

An arbitrary `test` substring in an argument, filename, package name, output,
or command description is not sufficient. Direct lifecycle, wait, interactive,
mutation, navigation, bounded observation, and structured MCP protocols remain
outside this classifier.

### Outcome and persistence

`runBatchCommands` remains authoritative for results: `completed`, `failed`,
`timed_out`, `skipped`, and `error` are distinct, with exit codes preserved.
Only successful stdout bodies are eligible for request-local search or explicit
verified persistence. Failed, timed-out, skipped, empty, and executor-error
output is response evidence only.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Plugin list is empty/unparseable | `unavailable` |
| Plugin list explicitly has no matching Plugin | `missing` |
| Matching Plugin omits an inventory field | that field is `unavailable` with a stable field-specific reason |
| Plugin disabled | `enabled: missing`; session Hook loading `not_applicable` |
| Plugin is confirmed absent | cache and current-session observations are `not_applicable` |
| Cache path/manifest cannot be observed | `unavailable` or `not_applicable`, never false `missing` |
| Runtime/cache roots differ but release matches | alignment `present: different_matching_release` |
| Runtime/cache roots differ and release differs | alignment `missing: different_release` |
| Test command exits non-zero | `failed`, never `completed` or searchable candidate |
| Test command times out | `timed_out`, never `completed` or searchable candidate |
| Output hard cap kills command | retain non-zero/error evidence; never mark completed |

## 5. Good / Base / Bad Cases

- Good: CLI and MCP Doctor serialize the same fixture facts while preserving
  source/cache/runtime roots separately.
- Good: `env CI=1 pnpm test`, `timeout -s TERM 30s go test ./...`,
  `bash -lc 'pytest -q'`, and compound branches route to context-mode.
- Base: `git status --short`, `touch test-output.txt`, and `npm view test-package`
  pass through directly.
- Bad: treating an absent cache path as an absent Plugin, or routing `echo test`
  because its text contains the word `test`.

## 6. Tests Required

- Projection unit tests assert every observation state and stable check ID.
- Built CLI/MCP fixture test parses both entry points and compares all shared
  fields byte-for-byte, with an unobservable current-session state. A fake
  `codex` executable must provide both POSIX and Windows launchers around one
  implementation and preserve the host command-interpreter/runtime search
  path; otherwise the fixture tests shell discovery rather than diagnostics.
- Routing tests cover command families, wrappers, paths, prefixes, arguments,
  compounds, first/repeated calls, host tool aliases, and false positives.
- Batch tests assert success, non-zero, timeout, cap, exit codes, and
  success-only searchable bodies.
- Bundle/manifest tests assert each supported shell tool name belongs to one
  PreToolUse group.

## 7. Wrong vs Correct

### Wrong

```ts
const runtimeRoot = enabled ? parseCodexPluginList(text).cacheRoot : null;
return { hooks: existsSync(join(runtimeRoot, "hooks.json")) };
```

This treats an install cache as the currently loaded process root and turns
probe failure into a false Hook failure.

### Correct

```ts
const runtimeRoot = resolve(loadedPackageRoot);
const cacheRoot = pluginList.cacheRoot ?? null;
return projectCodexPluginDiagnostic({
  runtimeRoot,
  cacheRoot,
  runtimeManifestAvailable: inspect(runtimeRoot),
  cacheManifestAvailable: cacheRoot ? inspect(cacheRoot) : null,
  sessionHooksLoaded: null,
});
```

The same typed projection is serialized by both Doctor surfaces, while
unobservable host state stays explicitly unobservable.
