# Forward Codex Presentation Environment

## Identity

- Root issues: `ROOT-ISSUE-054`, `ROOT-ISSUE-041`
- Baseline: `f13ee081296c3bc96404c551cdeecbb110c8643c`
- Branch: `fix/issue-054-codex-plugin-env-forwarding`
- Base branch and fork release ref: `devel`
- Current version: `1.0.184`
- Expected next patch: `1.0.185` / `v1.0.185`, subject to a fresh local and
  remote tag-availability check immediately before release preparation

## Goal

Make the Codex Plugin stdio MCP inherit the five existing, non-sensitive
presentation-policy variables selected by the parent Codex process. Preserve
all current defaults when a variable is absent, retain the fixed Codex platform
identity, and prove that the same forwarding contract survives source,
marketplace construction, offline installation, normalized Codex registration,
and a real stdio MCP execution.

## Confirmed Failure

- The host process sees:
  `CONTEXT_MODE_CODE_ECHO_MAX=64`,
  `CONTEXT_MODE_COMMAND_ECHO_MAX=64`,
  `CONTEXT_MODE_TITLE_PREVIEW_MAX=16`,
  `CONTEXT_MODE_SEARCHABLE_TERMS_MAX=0`, and
  `CONTEXT_MODE_RESULT_PREVIEW_MAX=160`.
- The currently installed `1.0.184` MCP process sees all five values as unset.
- A real 365-character `ctx_execute` source is therefore reported as
  `preview=240`, `omitted=125` instead of using the requested 64-character
  source preview.
- Source `.codex-plugin/mcp.json`, the installed `1.0.184` manifest, and the
  normalized `codex mcp list --json` transport contain only fixed
  `env.CONTEXT_MODE_PLATFORM=codex`; normalized `env_vars` is empty.
- The marketplace builder copies `.codex-plugin/mcp.json` from the publishable
  package into the offline payload and hashes it through
  `CONTENT-MANIFEST.json`. The existing verifier performs a real offline Codex
  installation and MCP initialize probe but does not assert presentation
  forwarding.
- `v1.0.185` is currently absent locally and remotely. This observation is not
  a reservation and must be repeated before version synchronization and tag
  creation.

## Requirements

### R1. Exact Codex forwarding allowlist

The `context-mode` entry in `.codex-plugin/mcp.json` must declare exactly these
five `env_vars`, in a stable order:

1. `CONTEXT_MODE_CODE_ECHO_MAX`
2. `CONTEXT_MODE_COMMAND_ECHO_MAX`
3. `CONTEXT_MODE_TITLE_PREVIEW_MAX`
4. `CONTEXT_MODE_SEARCHABLE_TERMS_MAX`
5. `CONTEXT_MODE_RESULT_PREVIEW_MAX`

The fixed `env.CONTEXT_MODE_PLATFORM=codex` entry must remain unchanged.

### R2. No value or authority expansion

- Do not hardcode presentation budget values into manifest `env`.
- Do not forward `WINDSURF_API_KEY`, another credential, wildcard, prefix,
  caller-defined list, or broad process environment.
- Do not change presentation parsing, clamping, defaults, or the server's
  security authority.
- Parent absence must continue to resolve to defaults `240/160/96/20/1200`.

### R3. Delivery parity

The source manifest, built marketplace payload, installed plugin manifest, and
normalized Codex MCP registration must expose the same exact five-item
`env_vars` list. The payload's `CONTENT-MANIFEST.json` must cover the manifest
bytes, and offline verification must reject any mismatch.

### R4. Real stdio behavior

A manifest-driven real MCP process must prove both cases with non-sensitive
fixtures:

- Parent variables absent: presentation uses `240/160/96/20/1200`; a
  365-character source reports a 240-character preview.
- Parent variables set to `64/64/16/0/160`: the MCP execution environment reads
  the same values; the same source reports a 64-character preview while
  preserving source audit metadata and a visible source echo.

Record complete MCP return character and line counts for both probes in the
task result. These measurements cover context-mode return content only and do
not claim any change to Codex's host-owned `Called` input display.

### R5. Regression boundaries

- Preserve the upstream `#717` / `#736` visible-source audit contract and its
  tested 64-code-point minimum for source and command echo.
- Preserve restricted execution authorization, isolation, read-only,
  non-persistence, network, and background-process boundaries.
- Preserve all non-Codex platform manifests byte-for-byte unless a generated
  version-only change is required by the normal release process.
- Do not include or fix `ROOT-ISSUE-053`.
- Do not modify an installed Plugin cache or treat a Codex restart as the fix.

### R6. Documentation and release

Document the Codex-specific forwarding contract and defaults. After all source
and release gates pass, synchronize the next available patch version and use
the repository's existing source commit, provider-authorized native preflight,
attestation-only direct child evidence commit, annotated tag, remote ancestry,
Release workflow, and downloaded-asset verification contracts. Do not publish
to npm unless a separate user instruction explicitly expands scope.

## Out Of Scope

- Codex host rendering or shortening of the `Called` tool-input region.
- Changes to default presentation budgets or general presentation semantics.
- Credential forwarding, arbitrary environment inheritance, or secret probes.
- Changes to other component repositories, the parent repository or Gitlink,
  `/home/penn/.codex`, Governance Plugin, or another platform's configuration.
- `ROOT-ISSUE-053` and unrelated cleanup.

## Acceptance Criteria

- [ ] Source `.codex-plugin/mcp.json` retains fixed
  `CONTEXT_MODE_PLATFORM=codex` and declares exactly the five approved
  `env_vars`, with no budget values or credentials in `env`.
- [ ] Source, built marketplace payload, installed plugin manifest, and
  `codex mcp list --json` normalize to the same five-item list.
- [ ] With no parent values, a real stdio MCP process uses defaults
  `240/160/96/20/1200` and a 365-character source reports `preview=240`.
- [ ] With parent values `64/64/16/0/160`, a real stdio MCP process reads those
  values and the same source reports `preview=64` with correct original,
  omitted, truncation, language, and digest audit fields.
- [ ] Focused manifest, marketplace, stdio, presentation, `#717/#736`, and
  restricted-boundary tests pass.
- [ ] Full typecheck, build, test, all bundle/asymmetric drift checks,
  marketplace build/verify, and two consecutive deterministic builds pass.
- [ ] The final source commit is on remote `devel`; the native attestation is
  its only-change direct child; the annotated tag is unoccupied, valid, and
  reachable from the configured release ref.
- [ ] CI and Release workflow complete successfully; every downloaded release
  asset matches its declared SHA-256; npm `latest` remains unchanged.
- [ ] Task results, applicable specs, release evidence, and final clean status
  are committed without touching any forbidden repository or cache path.

## Rollback

- Before publication: revert the scoped source/version commits or delete only
  an unpushed local candidate tag after resolving its exact object. Never
  overwrite or force-push a remote tag.
- If any native preflight, ancestry, attestation, CI, asset, or tag-availability
  gate fails: stop before tag publication, preserve diagnostics in the task,
  fix forward on the same branch, and regenerate evidence from the new exact
  source commit.
- After publication: treat the release and tag as immutable. Correct a defect
  with a new patch version and new evidence rather than deleting or rewriting
  published assets.
- Runtime fallback is the existing default-budget behavior when parent
  variables are absent; direct edits to installed Plugin cache are prohibited.
