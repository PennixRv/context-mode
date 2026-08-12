# Diagnostics And Version Channels

## Current v1.0.186 findings

`src/adapters/codex/index.ts` already contains useful root-aware logic from the
v1.0.173 repair: it parses `codex plugin list`, compares the configured and
runtime marketplace roots, and verifies the runtime manifest's Hook entries.
The CLI and MCP entrypoints still choose/assemble these facts independently.

The live state is:

```text
plugin: context-mode@context-mode, enabled
marketplace root: /home/penn/.codex/.tmp/marketplaces/context-mode
version: 1.0.186
CLI Doctor: root and active hooks PASS; npm/plugin version checks WARN
npm latest observed by Doctor: 1.0.169
```

The version warning is invalid because `1.0.169` is older than the local
`1.0.186` and because npm is not a universal update source for a Codex
marketplace installation.

## Target model

All diagnostic entrypoints consume the same typed Codex diagnostic projection:

| Layer | Required facts | Failure meaning |
| --- | --- | --- |
| Plugin identity | name, enabled/disabled, installed version, marketplace/source channel | Plugin manager state unavailable or disabled |
| Runtime root | configured root, resolved runtime root, release identity match, manifest availability | Source/stale cache mismatch or missing runtime asset |
| Hook registration | required event entries, command targets, asset existence and readability | Plugin enabled but execution hook is not actually registered/ready |
| Version channel | channel, local version, remote version if that channel supports comparison, semantic relation, action | Only newer compatible channel emits update; local newer/equal is informational |

`codex plugin list` remains the Codex CLI's authoritative plugin-manager source;
the component can only consume and cross-check it. Marketplace fixtures model
the installed offline wrapper and runtime manifest without touching the normal
`CODEX_HOME`.

## Semantic version rules

- Parse strict `major.minor.patch` plus optional prerelease identifiers.
- Compare numeric identifiers numerically, string identifiers lexically, and
  release versions after prerelease versions.
- Ignore build metadata for ordering.
- Never use equality as an update predicate.
- npm latest is comparable only for npm/global installations. A Codex
  marketplace installation reports its marketplace identity and the
  marketplace-specific update command; it does not compare against npm.
- Standalone/Git installations report source identity and do not emit a
  generic npm upgrade hint.
