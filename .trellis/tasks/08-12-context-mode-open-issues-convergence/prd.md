# Context-mode open issues convergence

## Goal

Validate every context-mode-owned premise in root workflow Issues 003, 009, 010,
012, 013, 018, 053, 064, 067, and 068 against the released `v1.0.186` tree,
converge the defects that remain real without reducing context-mode's large-output
aggregation capabilities, and publish the next stable context-mode release with
reproducible evidence for root-workflow acceptance.

## Background And Authority

- The immutable baseline is release `v1.0.186`, tag object
  `f1c9b674a4b3b1f9d25914141517abcd66cebdab`, peeled commit
  `3238b72a28d7b99717ec5f6a35ef21650922d539` on `devel` and `origin/devel`.
- The authoritative issue descriptions are the ten read-only files under
  `../issues/`. Their premises are hypotheses to reproduce, not instructions to
  patch mechanically. A premise that no longer holds must be documented with
  current code and test evidence instead of reimplemented.
- Parent repository files, `/home/penn/.codex`, sibling repositories, installed
  plugin caches, credentials, and the parent Gitlink are read-only in this task.
- Codex dispatch is inline. The current main session exclusively investigates,
  implements, checks, commits, merges, and releases; no native subagents or
  Trellis channel workers may perform implementation or checking.
- context-mode MCP tools are intentionally disabled for this task so the
  component under test cannot influence its own investigation or verification.

## Requirements

### R1. Issue Premise Audit And Reproduction Evidence

- Audit each issue against `v1.0.186` source, generated assets, installed-shape
  fixtures, tests, release history, and relevant upstream contracts.
- Record one of `reproduced`, `partially fixed`, `already fixed`, or
  `premise invalid` for each issue, with concrete reproduction and file anchors.
- For every remaining defect, add a regression test that demonstrably fails on
  the baseline behavior before the implementation is accepted as a fix.

### R2. Issue 003: Mutually Exclusive PreToolUse Matchers

- Every supported bare tool name and fully qualified context-mode MCP tool name
  must match exactly one `PreToolUse` group.
- Preserve bare, `mcp__context_mode__*`, and
  `mcp__plugin_context-mode_context-mode__*` compatibility where supported.
- Add static matcher-intersection coverage and a real hook-dispatch execution
  counter proving one handler invocation per logical call.
- Matcher changes must preserve R3 routing exceptions and Issue 018 aggregation.

### R3. Issues 010, 013, 018, And 067: One Routing And Trust Matrix

- Maintain one shared, auditable semantic matrix across the shipped Skill,
  routing Hook behavior, tool descriptions, and tests:
  - direct protocol calls for lifecycle control, event waits, interactive
    commands, bounded structured results, and tools with specialized errors;
  - context-mode aggregation for tests, logs, long diffs, recursive full-text
    search, dependency output, large files, and unbounded commands without a
    dedicated protocol;
  - original-tool file output followed by `ctx_execute_file` for large
    structured protocol results;
  - explicit failure for forbidden actions.
- Approved CodeGraph indexes remain the first source for local symbols,
  architecture, call relationships, execution paths, impact analysis, and code
  review location. Output size alone must never replace CodeGraph with a source
  scan through context-mode.
- Trellis/Governance lifecycle tools, Fast Context, CodeGraph, and other bounded
  structured MCP tools remain direct protocol calls and retain their native
  status, notifications, and error categories.
- `ctx_search` is documented and tested as a query over previously persisted
  content only, never online search, a live code scan, relationship analysis, or
  an authoritative project fact source. `ctx_index` is not the default whole
  repository indexer.
- Preserve the component-side aggregation capability required by Issue 018,
  including repeat calls, while leaving root `AGENTS.md` and Governance-owned
  global policy for root-workflow acceptance.
- `ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute` expose an explicit
  non-persistent mode. Unverified Fast Context, web, external API, and other
  external candidates default to non-persistent processing.
- Only locally verified content with an explicit persistence request may enter
  persistent FTS5. Persisted provenance must be typed, bounded, attributable,
  and independently removable. Failed execution output must not be promoted as
  verified persistent evidence.

### R4. Issues 009 And 012: Layered Doctor And Version Channels

- Direct CLI doctor, MCP `ctx_doctor`, and `codex plugin list` must agree on
  three distinct Codex states: plugin enabled identity, resolved runtime root,
  and actual Hook registration/asset readiness.
- Diagnostics must use the runtime context and marketplace metadata available
  to each entrypoint without resolving a source checkout or stale cache as the
  active plugin root.
- Version comparison must use semantic ordering and installation-channel
  identity. npm, Codex marketplace, standalone/Git, and unknown installations
  may not be treated as one remote version source.
- A locally newer version never emits a downgrade or generic upgrade warning.
  A newer compatible remote emits one channel-correct update instruction.
- Codex marketplace diagnosis and release-asset fixtures are mandatory, not an
  npm/standalone-only approximation.

### R5. Issue 053: Replayable Archived Measurement Evidence

- The response-measurement script must discover or accept the repository root
  without relying on fixed parent-directory depth and must replay from both an
  active task path and an archived task path.
- MCP startup, request, or close failures must include bounded stderr tail
  diagnostics while excluding credentials and unbounded process output.
- Preserve all existing presentation-budget, three-entrypoint, and zero
  persistent-state assertions from Issues 041 and 054.

### R6. Issue 064: Host-Owned File Read Authorization

- `ctx_execute_file` must not impose a project-root, outside-project, or path
  category permission wall beyond access granted or denied by the host and OS.
- `ctx_execute`, `ctx_execute_file`, and `ctx_index(path)` must have documented,
  coherent path semantics. This requirement does not grant network access or
  weaken restricted execution policy.
- Retain bounded file size, execution time, output size, regular-file checks,
  symbolic-link loop handling, race resistance, and other resource protections.

### R7. Issue 068: Compound Shell Integrity And Truthful Batch State

- On POSIX, batch environment initialization must apply to the entire original
  user script without attaching an assignment to its first command and without
  `eval` or another reparsing layer.
- Serial and parallel batch paths must preserve true exit status for compound
  scripts beginning with `for`, `if`, `while`, `{ ...; }`, or a function
  definition, including preload paths containing spaces and single quotes.
- Syntax errors, ordinary non-zero exits, empty output, errors, and timeouts must
  be represented distinctly. A title-only or error-only index must never be
  advertised as successfully captured body content.
- A real dynamic-file-discovery probe must return same-batch query hits for the
  discovered body through `query_scope=batch`.

### R8. Compatibility, Build, And Release Integrity

- Preserve Issue 041 compact presentation budgets and Issue 054 Codex Plugin
  forwarding of the five presentation environment variables.
- Preserve restricted execution boundaries, source-echo audit semantics,
  supported host adapters, manifests, hooks, skills, and generated bundle
  symmetry except where an audited requirement explicitly changes them.
- Update source, Skill, Hook, diagnostics, tests, generated bundles, release
  manifests, task evidence, specs, and user documentation where their contracts
  change. Do not edit archived historical evidence merely to rewrite history.
- After all gates pass, integrate the reviewed implementation into `devel`,
  publish the next unoccupied stable patch using the repository's existing
  source/evidence commit topology, push the branch and annotated tag, wait for
  CI and GitHub Release completion, and validate npm/marketplace/release assets
  according to the channel's actual publication contract.

## Acceptance Criteria

- [ ] AC1: Each issue has a baseline reproduction/audit record and a supported
  convergence classification; no issue premise is accepted solely because it
  appears in the parent issue file.
- [ ] AC2: All supported context-mode tool names match exactly one PreToolUse
  group, and a real dispatch counter records one handler execution.
- [ ] AC3: Skill, Hook, tool descriptions, and tests share the direct / aggregate
  / file-then-analyze / forbidden matrix, including CodeGraph, Fast Context,
  Trellis/Governance, unknown MCP, and repeat-call cases.
- [ ] AC4: Unverified external candidates remain absent from `ctx_search`; after
  local verification and explicit persistence they become searchable with
  bounded provenance and can be removed independently.
- [ ] AC5: CLI doctor, MCP doctor, and Codex marketplace fixture agree on enabled
  identity, runtime root, Hook registration, local/newer/equal/remote-newer/
  prerelease version semantics, and channel-specific recovery/update guidance.
- [ ] AC6: The Issue 053 measurement script replays from active and archived
  shapes, and failure probes include bounded, credential-free stderr.
- [ ] AC7: A host-readable external file succeeds through `ctx_execute_file`;
  denied/missing/non-regular/oversized/racing/link-loop cases retain bounded
  fail-closed behavior, with path-semantics consistency coverage.
- [ ] AC8: Serial and parallel real batch probes preserve compound script
  semantics and exit statuses, and same-batch queries find actual dynamically
  discovered body content rather than titles or errors.
- [ ] AC9: Targeted tests for every issue, all affected Hook/Skill/Doctor/MCP/
  release-asset tests, full test suite, typecheck, formatting/static checks,
  build, bundle/asymmetric drift, package/manifest checks, and consecutive
  reproducible builds all pass without credentials or generated garbage.
- [ ] AC10: A stable next patch is released from `devel` with verified source
  candidate, direct-child evidence commit, annotated tag object and peeled
  commit, GitHub Release/CI status, content manifest, marketplace/offline asset,
  package asset, and recorded SHA-256 values.
- [ ] AC11: The final handoff names the root-owned portions of Issues 010, 018,
  and 067, plus exact install, restart, and real MCP acceptance steps; parent
  Issue files and status remain untouched.
- [ ] AC12: Final component worktree is clean and contains no unrelated edits,
  credentials, cache databases, local plugin installations, or temporary probes.

## Out Of Scope

- Editing parent `AGENTS.md`, parent `issues/`, the parent Gitlink,
  `/home/penn/.codex`, Governance Plugin, CodeGraph, Fast Context, Trellis, or
  any sibling component.
- Declaring root Issue 018 independently closed; the component supplies only
  its Skill/Hook capability and evidence for root-workflow acceptance.
- Replacing CodeGraph or Fast Context, making `ctx_search` a live/online search
  engine, or default-indexing an entire source repository.
- Reintroducing a project-root sandbox into `ctx_execute_file`, weakening
  restricted execution, expanding network capability, or removing resource
  limits under the label of path consistency.
- Rewriting `v1.0.186`, force-pushing, overwriting an occupied tag, publishing a
  prerelease, changing unsupported host-owned Called-input rendering, or
  modifying installed plugin caches as an implementation technique.

## Open Questions

None at task intake. Technical unknowns must be resolved from repository,
history, upstream contracts, and executable probes before final planning review.
