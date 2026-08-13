# Research Evidence Handoff: Issues 009 And 070

## Sources Read

The following parent-repository files were read in full and treated as immutable evidence:

- `../.trellis/tasks/08-12-context-mode-open-issue-acceptance/research/context-mode-combined-handoff-issues-009-070.md`
- `../issues/009-context-mode-plugin-root-diagnostic.md`
- `../issues/070-context-mode-test-command-routing-gap.md`
- `../.trellis/tasks/08-12-context-mode-doctor-consistency/research/context-mode-component-handoff-issue-009.md`
- `../.trellis/tasks/08-12-codex-tool-routing-acceptance/research/context-mode-component-handoff-issue-070.md`

## Local Anchors

- Issue 009 implementation anchors: `src/adapters/codex/diagnostics.ts`,
  `src/adapters/codex/index.ts`, `src/cli.ts`, and `src/server.ts`.
- Issue 070 implementation anchors: `hooks/core/routing.mjs` and its routing tests under
  `tests/core/`.
- Existing adapter fixtures and Plugin-list probes are in `tests/adapters/codex.test.ts`.
- Existing compact presentation and platform forwarding contracts are covered by the
  current source, marketplace, and release-asset tests; they are regression inputs, not
  reasons to change the parent repository.

## Dependency Order

Issue 009 first establishes the shared observation-state vocabulary and cross-surface
diagnostic contract. Issue 070 then changes only command-intent routing and uses existing
execution/persistence outcome contracts. Both changes share the routing boundary tests and
release gates, but neither changes the root-side acceptance or installation procedure.

## Evidence Boundary

This handoff records facts needed for component implementation only. It intentionally does
not copy credentials, session content, database/index contents, cache contents, or runtime
state. Parent Issue files and parent Trellis task files remain read-only.

## Confirmed Design Correction

The requirement to compare CLI Doctor, MCP `ctx_doctor`, and
`codex plugin list --json` means comparing the common fields visible from the
upstream Plugin inventory with the two context-mode Doctor surfaces. The Codex
CLI output itself is not writable by this component. Implementation therefore
uses the Plugin list as a typed input and shares one projection only between the
two context-mode entry points. Tests retain the upstream fixture and assert the
same identity/version/install/enable/source/cache facts without claiming that
context-mode changes Codex's JSON schema.
