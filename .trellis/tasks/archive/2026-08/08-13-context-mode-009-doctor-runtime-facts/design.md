# Issue 009 Doctor Runtime Facts Design

## Problem Statement

The released Plugin starts its MCP server with a narrower environment than an interactive shell.
The Codex adapter currently treats `codex plugin list` and `config.toml` as ambient capabilities,
while the Plugin manifest does not request the corresponding non-sensitive environment variables.
The existing cross-entry test bypasses that boundary by passing one complete environment to both
children. Doctor then compounds an observation failure by collecting the same facts multiple times
and rendering unavailable inventory as Plugin-root and MCP-registration repair warnings.

## Boundaries

- The Plugin manifest may forward only named non-sensitive variables needed to locate Codex and its
  config root. It must not forward provider, authentication, proxy, credential, or arbitrary
  variables.
- The diagnostic provider may inspect only the Codex config path, bounded `codex plugin list`
  output, the package root loaded by the current process, and the named Plugin manifests.
- Runtime manifest observations and current-session Hook loading remain separate. No filesystem
  observation can prove that a host already loaded a Hook.
- All changes remain inside this component repository. Installation and root dynamic acceptance
  belong to the parent workflow.

## Observation Contract

`CodexDiagnosticObservation<T>` remains the field-level machine contract and gains a stable
`reason` for every state other than `present`. Reasons are a closed union, not free-form exception
text. The initial reason vocabulary will cover:

- Plugin inventory command unavailable or invalid;
- Plugin not listed or not installed;
- Plugin disabled;
- source or cache root not reported by the inventory;
- cache or runtime manifest missing/unreadable;
- runtime and cache roots/releases not comparable or mismatched;
- required runtime Hook events missing;
- current host session state not exposed to the process; and
- a field not applicable because the Plugin is absent or disabled.

Present observations retain their typed values. Top-level compatibility fields keep their existing
`null` representation when unavailable, while `checks` supplies the state and reason. This avoids a
breaking top-level shape change and makes uncertainty machine-readable.

The Plugin-list probe will preserve a bounded reason for execution failure, nonzero exit, empty or
invalid output, and a confirmed list without context-mode. It will never include stderr, config
contents, or environment values in the serialized report.

## Shared Snapshot

The Codex adapter will expose one Doctor report collected from one `CodexPluginDiagnostic`
snapshot. That report contains:

- the typed diagnostic and its serialized form;
- Hook/config validation results derived from that snapshot; and
- Plugin/MCP registration status derived from the same snapshot.

CLI Doctor and MCP `ctx_doctor` will use this report when available. Other adapters retain the
existing `validateHooks` and `checkPluginRegistration` fallback. Codex upgrade/configuration paths
may continue to collect fresh state when they are not part of one Doctor invocation.

This removes time-of-check drift and prevents one unavailable probe from being rendered several
different ways.

## Plugin Environment Projection

`.codex-plugin/mcp.json` will keep fixed `CONTEXT_MODE_PLATFORM=codex` and the five Issue 041/054
presentation variables. It will additionally request the smallest cross-process discovery set
confirmed by the implementation:

- `PATH`, for the bounded `codex plugin list` child process;
- `CODEX_HOME`, for explicit Codex profiles; and
- `HOME`, for Codex's default profile when `CODEX_HOME` is unset.

No values are embedded in the manifest. Marketplace generation and offline installation copy this
manifest through the existing build pipeline, and tests compare all three views exactly. Tests also
reject credential-like names.

## Rendering Semantics

- `pass`: the stated fact is directly observed and healthy.
- `warn`/`fail`: the stated mismatch, absence, corruption, or stale release is directly observed and
  has an actionable repair.
- `unavailable`: the process lacks the capability or evidence to decide. CLI renders this as an
  informational unavailable observation; MCP uses a distinct renderer-safe prefix. It is not
  counted as a failed or warning check.

When Plugin inventory is unavailable, Doctor still reports runtime root, runtime manifest, and
runtime Hook events from the current package. It does not emit a Plugin-root drift warning or claim
MCP registration is broken. When cache and runtime releases are both observed and differ, Doctor
emits the restart warning. `session_hooks_loaded` remains unavailable with the host-session reason
unless a future Codex protocol supplies direct evidence.

## Test Design

The principal regression fixture models the Plugin host boundary rather than sharing one process
environment:

1. A temporary parent environment contains synthetic `HOME`, `CODEX_HOME`, and a fake `codex` on
   `PATH`.
2. CLI Doctor receives that parent environment.
3. MCP Doctor receives only fixed `env` plus names requested by source `env_vars`, along with
   content-free test controls.
4. Before the manifest change, MCP cannot observe the inventory and the equality assertion fails.
5. After the change, both entry points serialize the same installed Plugin facts.

Adapter-level table tests cover absent, disabled, unavailable, corrupt, matching-release, stale,
and host-session-unobservable cases. Manifest tests cover source, two consecutive generated
marketplace builds, and offline extraction.

## Compatibility And Rollback

- Existing top-level diagnostic values and check keys remain stable.
- Added reason fields and an unavailable result status are additive.
- No presentation default, execution policy, Hook routing matcher, or persistent index behavior
  changes.
- Rollback is the source commit before the diagnostic change. A published annotated tag is never
  moved or overwritten; a release defect requires a new patch.
- Root installation uses the existing transactional Plugin update flow and requires a new Codex
  session because the MCP environment is fixed when the Plugin process starts.
