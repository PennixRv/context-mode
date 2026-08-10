# Design: Unified Restricted Execution Boundary

Correlation ID: `ROOT-ISSUE-025`

## Current Data Flow

```text
MCP handler
  -> deny-pattern check
  -> PolyglotExecutor.execute / executeFile
  -> runtime process with cwd
  -> stdout/stderr processing
  -> optional or mandatory persistent indexing
```

The current `ctx_execute_file` handler adds an explicit path guard before this
flow. Code execution and batch execution have no equivalent shared entrance.
`PolyglotExecutor.projectRoot` controls path resolution and the process working
directory; it is not a filesystem boundary.

## Target Layers

### 1. Execution Policy

Introduce a shared policy type and decision function that distinguishes at
least these states:

- ordinary main-session execution;
- project-contained, read-only, network-disabled, non-persistent execution;
- restricted execution requested but isolation unavailable.

The policy owns canonical project-root resolution, authority provenance,
allowed side effects, backend selection, and stable error classification.
Handlers validate tool inputs, request a decision, and format results. They do
not reimplement security policy.

Caller input cannot create authority. Acceptable selection mechanisms include a
distinct restricted tool, server-start fixed policy, or an unforgeable host
capability. A boolean parameter or prompt statement is not an authority source.

### 2. Process Isolation

Restricted execution must enforce these properties at the process boundary:

- project files are read-only;
- files outside the project are hidden or unreadable;
- any request-lifetime scratch space cannot become an external persistence path;
- network access is unavailable;
- child processes inherit the same restrictions;
- timeout, cancellation, and parent exit leave no background process.

Reuse one isolation launcher for every language instead of copying policy into
language-specific code. Linux may use an existing verified system sandbox.
macOS or Windows without an equivalent proven backend must return a stable
unsupported-restriction error. Fixed `cwd`, regexes, and command blacklists do
not satisfy this layer.

### 3. Files And Paths

`isPathInsideProject()` may remain part of fast, pure path decisions, while the
process isolation layer remains the final boundary. Path handling must include:

- one canonical root;
- lexical and realpath checks;
- the nearest existing parent for missing targets;
- symlink and replacement-race resistance;
- platform-correct case and volume semantics.

`ctx_execute_file` should continue to reject an explicit bad `path` before
launching a process, with process isolation providing defense in depth. An
ordinary Read allow rule must not widen restricted arbitrary-code authority.

### 4. Ephemeral Aggregation

Ordinary `ctx_batch_execute` may preserve its indexed compatibility behavior.
Restricted batch aggregation stores output only in memory or request-scoped
temporary state, runs current-request `queries` over that state, and destroys it
before returning. It must not call persistent `ContentStore.index()` or emit
persistent session/statistics events.

If the design adds a restricted tool name, its description, annotations, and
response must state the non-persistent contract. If it reuses a handler, a
server-fixed policy must prevent the caller from selecting ordinary storage.

## Compatibility

- Keep the existing ordinary entrance as the default, or provide explicit
  migration documentation and tests for any behavior change.
- Restricted execution fails closed and never degrades to ordinary execution.
- Preserve or strengthen the existing `ctx_execute_file` rejection; unification
  must not reopen issue #852.
- Keep tool lists, platform adapters, bundled server output, and source aligned.
  The existing asymmetric-drift checks must pass after build.

## Validation Matrix

| Dimension | Minimum cases |
| --- | --- |
| Entrance | execute, execute_file, batch_execute |
| Authority | ordinary, restricted, restricted with unavailable backend |
| Language | shell, JavaScript, Python |
| Path | inside, absolute escape, `..`, symlink, prefix sibling, missing target |
| Side effect | read, project write, external write, temporary write, network, background child |
| Storage | ordinary persistent index, restricted current-request query, no later recall |
| Scheduling | single, serial batch, concurrent batch, timeout, cancellation |

Dynamic tests use temporary project and external directories plus a local test
port. They do not read real user files or access the public network. Supported
platforms require real subprocess probes; source-structure assertions are not a
substitute for behavior tests.

## Rollback

- Keep all changes on the task branch. Failure can return to the preparation
  commit without moving `devel`.
- If ordinary compatibility fails, restore the ordinary path before continuing
  work on a distinct restricted entrance.
- If a platform cannot prove isolation, retain a stable fail-closed result
  instead of adding a bypass.
- The integration workflow continues to deny all execution MCP tools until its
  separate acceptance, so component rollback does not widen current authority.
