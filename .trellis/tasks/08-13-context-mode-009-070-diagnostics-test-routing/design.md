# Design: Issue 009 Diagnostics And Issue 070 Test Routing

## Boundaries

Issue 009 belongs in the Codex adapter's diagnostic fact collection and projection. The
direct CLI Doctor and MCP `ctx_doctor` are consumers of one typed projection; neither
reconstructs Plugin state independently. `codex plugin list --json` is an upstream,
read-only inventory source consumed by that projection, not output owned by context-mode.
Hook execution remains owned by the existing Hook/runtime integration.

Issue 070 belongs in `hooks/core/routing.mjs` as a command-intent classifier. It decides
whether a command has unbounded test output; it does not execute commands, alter exit
codes, create a permission boundary, or change persistent-index trust rules. The existing
executor and result presentation remain authoritative for outcomes and bounded previews.

## Issue 009 Data Flow

```text
codex plugin list --json/text + config + current package manifests
        -> CodexPluginDiagnosticFacts
        -> projectCodexPluginDiagnostic
        -> CLI Doctor / MCP ctx_doctor
```

The fact model will carry independently observed values for Plugin identity/version,
installed/enabled state, configured/source root, cache root, runtime root, manifest, Hook
manifest and required Hook registrations, plus current-session loading. Each observation
uses a typed state such as `present`, `missing`, `unavailable`, or `not_applicable`, with
optional bounded detail and probe provenance. Enabled/loaded must remain tri-state where
the process cannot prove a boolean.

Stable check identifiers will make CLI and MCP results comparable, for example:
`codex.plugin.identity`, `codex.plugin.installation`, `codex.plugin.source_root`,
`codex.plugin.cache_root`, `codex.plugin.runtime_root`, `codex.plugin.manifest`,
`codex.plugin.hooks`, and `codex.session.hooks_loaded`. A missing object is emitted only
when the relevant root or manifest was successfully observed and the object is absent.
An unavailable probe is emitted as `unavailable`; a check that does not apply, such as
runtime/session loading for a disabled installation, is `not_applicable`.

The adapter will prefer `codex plugin list --json` for structured identity/root state and
retain a bounded text fallback for older CLIs. The common projection will be serialized
directly by CLI and MCP. Runtime/cache/source paths remain separate even when equal, and
path comparisons use the existing platform-aware normalization. Session Hook loading is
reported as proven only when an existing safe probe supplies evidence; otherwise it is
explicitly unobservable rather than inferred from manifest presence.

## Issue 070 Classification

The classifier will normalize only syntactic prefixes needed to identify the command:
environment assignments, supported wrappers (`env`, command-launch wrappers, and existing
safe wrapper conventions), executable paths, and shell compound boundaries. It will then
apply family-specific grammar:

- package managers require a test subcommand in the command position;
- Vitest/Jest and Python runners require the runner executable/module form;
- Gradle/Maven/SBT require their test task/goal;
- Go and Cargo require their test subcommand.

An arbitrary substring or filename named `test` is insufficient. Each shell branch is
classified independently, so a compound command can preserve direct handling for one
branch and route the unbounded test branch. Known test intent must remain a routing result
even after the once-per-session guidance marker has fired; guidance suppression may reduce
text but cannot turn the decision into `null`.

The classifier returns a structured decision consumed by the existing route flow. Result
status, timeout and truncation continue through the existing execution protocol. Tests
will assert that failed or syntax-invalid commands are not reported as completed or as
trusted persistent candidates, connecting the routing change to the Issue 013 boundary.

## Compatibility And Release

Keep public MCP tool names and existing Doctor fields compatible where possible, adding
typed nested state rather than changing successful field meaning. Preserve #041/#054
compact response budgets, Codex environment forwarding, platform-specific manifests, and
the existing bundle/content-manifest generation path. Linux/WSL remains the supported
runtime for this release.

Rollback is by reverting the implementation/release commits and returning the component
to the v1.0.187 source candidate; no installed Plugin cache or root settings are modified
by this task.
