# Converge Issue 009 Doctor runtime facts

## Goal

Release the patch after `v1.0.188` that makes the direct CLI Doctor and MCP
`ctx_doctor` report the same explainable Codex Plugin installation and runtime facts when
they run against the same installation. Preserve truthful uncertainty for host-session facts
that a child process cannot observe.

The user value is operational: an operator must be able to distinguish a real installation,
enablement, cache, manifest, runtime-version, or Hook defect from a missing diagnostic
capability. Doctor must not recommend reinstalling or restarting merely because its own process
cannot observe Codex Plugin inventory.

## Confirmed Facts

- The release baseline is `v1.0.188` at
  `f9a817a76a19aa9555e53d8b3d16a38091ab0ab1` on `devel`.
- Root-workflow dynamic acceptance ran the installed `v1.0.188` CLI Doctor and MCP Doctor in
  the same restarted Codex session. CLI observed the installed and enabled plugin, source and
  cache roots, runtime root, matching release, and four runtime Hook events. MCP observed its
  version and runtime root but downgraded Plugin inventory facts to `unavailable` and emitted
  Plugin-root, MCP-registration, and current-session-Hook warnings.
- Both entry points call `CodexAdapter`, but the MCP manifest forwards only the five
  presentation-budget variables. The adapter discovers Codex configuration through `HOME` or
  `CODEX_HOME` and invokes `codex plugin list` through `PATH` inherited by its process.
- `tests/plugins/codex-doctor-entrypoints.test.ts` currently supplies the same complete
  environment directly to the CLI and MCP children. It therefore proves shared serialization
  only after bypassing the real Plugin manifest environment projection.
- Doctor currently recollects Plugin facts independently in Hook validation, structured
  serialization, and MCP-registration validation. Unavailable Plugin inventory can consequently
  produce repeated warnings that look like installation failures.
- A process-local manifest proves runtime files and Hook declarations, but it does not prove
  that Codex inserted those Hooks into an already-running host session.

## Requirements

### R1. Shared diagnostic observation

- CLI Doctor and MCP `ctx_doctor` MUST consume one typed Codex diagnostic observation contract
  with the same field normalization and one fact snapshot per Doctor invocation.
- The contract MUST cover `plugin_id`, `version`, `installed`, `enabled`, `source_root`,
  `cache_root`, `cache_manifest`, `runtime_root`, `runtime_cache_alignment`, `runtime_hooks`, and
  `session_hooks_loaded`.
- Values derived from `codex plugin list`, Codex configuration, the current package root, and
  Plugin manifests MUST retain their source semantics. One source MUST NOT silently overwrite a
  conflicting source.

### R2. Codex Plugin environment capability

- The source Plugin manifest, generated marketplace artifact, and offline installation manifest
  MUST project the minimal non-sensitive parent environment required for the MCP child to locate
  Codex configuration and invoke `codex plugin list` on Linux/WSL and supported existing hosts.
- Environment variable values MUST come from the parent process through `env_vars`; no user path,
  version, marketplace source, cache path, or display budget may be hardcoded.
- Credentials, tokens, auth files, provider configuration, broad wildcard environment forwarding,
  and runtime cache contents MUST NOT be added to the manifest, fixtures, logs, or release assets.
- The five Issue 041/054 presentation-budget variables and fixed
  `CONTEXT_MODE_PLATFORM=codex` behavior MUST remain intact.

### R3. Truthful availability and reasons

- Every non-present typed observation MUST carry a stable machine-readable reason that
  distinguishes confirmed absence, not-applicable state, and observation failure.
- Missing Plugin inventory, a Plugin not listed, disabled state, missing cache manifest, stale
  runtime release, missing runtime manifest or Hook event, and host-session Hook state unavailable
  MUST remain separate outcomes.
- `session_hooks_loaded` MUST remain unavailable with an explicit host-observation reason unless
  the process has direct evidence. Runtime manifest presence MUST NOT be promoted to session load.
- Plugin-root and MCP-registration checks MUST NOT be rendered as failures or repair warnings when
  the necessary Plugin inventory is merely unavailable. The report MUST state the unavailable
  capability and reason without claiming installation failure.
- A proven runtime/cache release mismatch MAY recommend restarting. A proven absent, disabled, or
  corrupt installation MAY recommend installation repair.

### R4. Entry-point and fixture coverage

- A regression test MUST launch CLI Doctor with a complete temporary Codex environment and MCP
  Doctor with the environment projected from `.codex-plugin/mcp.json`. It MUST fail against the
  `v1.0.188` manifest and pass after the fix.
- Tests MUST prove CLI and MCP serialize equal values and check states when Plugin inventory,
  config, cache manifest, runtime manifest, and Hook declarations are observable.
- Tests MUST separately cover unavailable Plugin inventory, Plugin not listed, disabled Plugin,
  missing cache manifest, different matching release, different stale release, missing runtime
  manifest/Hook events, and unobservable current-session Hook loading.
- Source, generated marketplace, and offline-install manifests MUST expose the same allowlisted
  diagnostic and presentation `env_vars` and no credential-like names.
- Fixtures MUST use temporary directories and synthetic values and MUST not inspect or print the
  operator's real credentials, session history, database, or cache contents.

### R5. Compatibility, documentation, and release

- Existing CLI, MCP, Hook, version-channel, presentation-budget, marketplace, package-content, and
  native-release contracts MUST remain green.
- Repository diagnostics documentation and the executable Trellis specification MUST document the
  observation sources, reason semantics, environment allowlist, and host-session limitation.
- Version-bearing source and generated assets MUST be synchronized to the next available patch,
  expected `1.0.189`, without changing product defaults or publishing a prerelease.
- Release MUST follow the repository's source-commit, disposable native preflight, direct-child
  attestation-only evidence commit, annotated tag, immutable tag metadata, CI rebuild, GitHub
  Release, npm/marketplace, content-manifest, and SHA-256 verification contract.

## Out of Scope

- Installing the new Plugin into `/home/penn/.codex`, restarting Codex, or performing the root
  workflow's final dynamic acceptance.
- Modifying the parent repository, its Issue ledger or Trellis tasks, its Gitlink, Governance
  Plugin, sibling repositories, or any normal-profile configuration/cache.
- Proving that Codex injected Hooks into the current host session when Codex exposes no such
  observation to the MCP process.
- Reworking test-command routing or any root-workflow Issue other than Issue 009.
- Treating Doctor prompt guidance or process-local inspection as a security sandbox.

## Acceptance Criteria

- [ ] A red regression reproduces the `v1.0.188` CLI/MCP split by applying the source MCP
      manifest's real environment projection to the MCP child.
- [ ] With a fully observable temporary installation, CLI and MCP return identical values for all
      required Plugin fields; `installed`, `source_root`, `cache_root`, `cache_manifest`, and
      `runtime_cache_alignment` are not spuriously `unavailable`.
- [ ] Every unavailable or not-applicable field includes a stable reason, and confirmed missing,
      disabled, corrupt, stale, and unobservable cases remain distinguishable in structured output.
- [ ] An unavailable Plugin inventory produces an observation notice rather than Plugin-root or
      MCP-registration repair warnings; a proven stale runtime still emits a restart action.
- [ ] `session_hooks_loaded` remains explicitly unobservable unless direct host evidence exists,
      while runtime Hook declarations are reported independently.
- [ ] Source, consecutively rebuilt marketplace, and offline-install manifests contain the same
      exact non-sensitive `env_vars` allowlist and preserve all five presentation variables.
- [ ] Focused Doctor/manifest tests, formatting, lint, typecheck, Hook syntax checks, build, full
      tests, bundle and asymmetric drift checks, marketplace build/verify, offline stdio Doctor,
      package-content verification, and native release preflight all pass.
- [ ] The next unoccupied patch is published from `devel` through a source commit plus a direct
      attestation-only child, annotated tag, successful CI/Release workflow, and verified assets;
      the component worktree is clean afterward.
- [ ] The handoff includes root cause, files, test matrix, commands/results, source and evidence
      commits, annotated tag object and peeled commit, release asset SHA-256 values, provenance,
      install/restart instructions, root-side CLI/MCP comparison commands, residual limitations,
      and an explicit statement that root Issue closure remains pending root dynamic acceptance.

## Notes

- Root-workflow evidence is copied into `research/root-issue-009-v1.0.188-evidence.md` so component
  implementation does not depend on mutable parent files.
