# Harden Execution MCP Project Boundary

Correlation ID: `ROOT-ISSUE-025`

## Goal

Remove the inconsistent project-path, process-permission, and persistence
semantics across `ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute`.
Provide a server-enforced restricted execution capability that callers cannot
elevate. The restricted capability is intended for externally governed
read-only investigation sessions. Compatibility execution for normal main
sessions must remain distinguishable and must not be represented as a
project-read-only sandbox.

## Confirmed Facts

- The source baseline is `devel@a165593077add6004ea4e0131560729c2b9761dc`.
  The task branch is `fix/issue-025-execution-boundary`.
- `isPathInsideProject()` and `evaluateProjectContainment()` in
  `src/security.ts` are consumed only by the `ctx_execute_file` path guard in
  `src/server.ts`. `tests/security/project-boundary-852.test.ts` pins absolute
  path, parent traversal, and symlink rejection for that explicit file path.
- `PolyglotExecutor.execute()` in `src/executor.ts` only selects the project
  root or caller-provided `cwd` as the child process working directory. A
  working directory does not constrain absolute paths, command-internal `cd`,
  child processes, writes, or network access.
- `ctx_execute` accepts arbitrary supported-language code and an optional
  `cwd`. `ctx_batch_execute` accepts arbitrary shell commands and an optional
  `cwd`. Both apply deny-pattern checks but no shared project boundary.
- `ctx_batch_execute` always writes complete output to persistent FTS5.
  `ctx_execute` can also persist large output when `intent` is supplied.
  Persistent indexing is not an allowed side effect of read-only investigation.
- The context-mode MCP server does not inherit the filesystem sandbox of the
  Codex process that calls it. External hooks that inspect a tool name or code
  string cannot replace component-side process isolation.
- The integration workflow denies all three execution tools to read-only work
  nodes until this component fix and separate live acceptance are complete.
  A component commit does not change that allowlist.

## Requirements

### R1. One Policy Owner

- All three execution entrances must consume one typed, unit-testable security
  policy. Project-root normalization, privilege level, isolation availability,
  persistence, and network decisions must not remain scattered across handlers.
- Policy authority must come from server-fixed configuration, a distinct tool
  surface, or an unforgeable host capability. Tool input may request a stricter
  policy but cannot elevate restricted execution to compatibility execution.
- Decision failures must return stable, non-sensitive, testable error classes.
  They must never silently downgrade.

### R2. Project Containment

- Restricted execution may read only the allowed view under the canonical
  project root. It must reject out-of-project absolute paths, parent traversal,
  prefix-similar siblings, and symlink escapes.
- The boundary must hold for shell, JavaScript, TypeScript, Python, and child
  processes created by those runtimes. Fixed `cwd` and code-string scanning are
  not acceptable enforcement mechanisms.
- The design must address missing targets, symlinked existing parents, race
  replacement, and Windows/macOS case semantics.
- Existing host Read allow-rule compatibility for `ctx_execute_file` must be
  evaluated explicitly. A Read rule cannot automatically authorize arbitrary
  code, writes, or network access outside the restricted boundary.

### R3. Restricted Read-Only Execution

- Restricted execution must not create, overwrite, rename, or delete files
  inside or outside the project, and must not write to ordinary temporary paths.
- Restricted execution must not create network side effects, leave background
  processes, or spawn a child process outside the same restrictions.
- When the required operating-system isolation backend is unavailable or
  cannot prove the boundary, restricted execution must fail closed with a
  diagnosable result that does not disclose sensitive path content.
- If normal main sessions retain test, build, or index capability, the ordinary
  mode must be audibly distinct through its tool surface or server policy. It
  must not claim `readOnlyHint: true` or enter a read-only work-node allowlist.

### R4. No Persistent Side Effects

- Restricted execution must not write FTS5, session databases, statistics,
  recovery state, or any other persistent store.
- Restricted batch queries over newly produced output must use an in-memory or
  request-lifetime temporary structure. No result may remain searchable through
  a later `ctx_search` request.
- Tool responses and metadata must state whether output is persisted. They must
  not blur non-persistent restricted aggregation with ordinary indexed mode.

### R5. Compatibility And Platform Support

- Preserve and test a documented compatibility strategy for ordinary main
  sessions, including behavior changes, configuration, migration, and rollback.
- Linux, macOS, and Windows support claims must come from a real backend or an
  explicit fail-closed result. One platform's implementation does not prove
  another platform safe.
- Do not modify the parent repository, `/home/penn/.codex`, Governance Plugin,
  or another component to complete this task.
- Do not publish a release, push a remote branch, or update the parent Gitlink.

### R6. Verification

- Add cross-entrance tests for in-project reads, out-of-project absolute paths,
  parent traversal, symlinks, prefix siblings, `cwd`, command-internal `cd`,
  child processes, and at least shell, JavaScript, and Python.
- Add rejection tests for writes, network, background processes, and persistent
  indexing. Also test ordinary-mode compatibility.
- Cover concurrent batch execution, encoded or indirect paths, unavailable
  isolation backends, and stable error classification.
- Run targeted Vitest, full `pnpm test`, `pnpm run typecheck`, and
  `pnpm run build`.

## Acceptance Criteria

- [ ] All three entrances consume one execution policy and isolation decision.
- [ ] On supported platforms, restricted execution contains absolute paths,
      traversal, symlinks, command-internal directory changes, and child
      processes; an unavailable backend fails closed.
- [ ] Restricted execution cannot write project, external, or temporary files,
      use the network, or leave a background process.
- [ ] Restricted execution writes no FTS5 or other persistent state, and later
      searches cannot recall its output.
- [ ] Callers cannot elevate restricted execution through tool parameters,
      inherited environment, or nested commands.
- [ ] Ordinary main-session compatibility and tool metadata are explicit, with
      no undocumented regression in existing test, build, or index workflows.
- [ ] Cross-entrance, language, concurrency, path, write, network, persistence,
      and missing-backend tests pass.
- [ ] Full tests, type-check, and build pass without unexpected source/bundle
      drift.
- [ ] The component result is committed, the worktree is clean, and the final
      report includes `ROOT-ISSUE-025`, commits, checks, and residual risks.

## Out Of Scope

- Changing the external Governance work-node allowlist or claiming that the
  integration workflow has passed live acceptance.
- Modifying the parent repository, global Codex configuration, Trellis,
  OpenViking, or another component.
- Refactoring context-mode modules unrelated to execution security, persistence
  side effects, or required documentation.
- Publishing npm artifacts, installing the candidate plugin, pushing a remote,
  or using real sensitive files as test fixtures.

## Key Decisions And Risks

- The implementation session may select the isolation backend and compatibility
  API without weakening the security or acceptance requirements above.
- If current platform capabilities cannot satisfy the restricted contract,
  preserve ordinary execution and fail the restricted entrance closed.
- Cross-platform support may be delivered incrementally, but every unsupported
  platform must reject restricted execution explicitly rather than pass through.
