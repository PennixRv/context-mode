# ROOT-ISSUE-025 Evidence Snapshot

## Reproduction

In a Codex session started from the integration project, context-mode `1.0.182`
behaved inconsistently:

1. `ctx_batch_execute` accepted an absolute `cwd` outside the project and
   successfully ran read-only commands against source files there.
2. `ctx_execute_file` returned `File access blocked` for a file in that same
   external directory.
3. The reproduction used only self-maintained source fixtures. It did not read
   credentials, session databases, or other sensitive content.

## Verified Source Paths

- `src/security.ts`: `isPathInsideProject()` and
  `evaluateProjectContainment()`.
- `src/server.ts`: `checkProjectBoundary()` is called by the
  `ctx_execute_file` handler only; `ctx_execute` and `ctx_batch_execute` call
  the executor without that boundary.
- `src/executor.ts`: `PolyglotExecutor.execute()` uses
  `cwdOverride ?? projectRoot`; `executeFile()` wraps content from
  `resolve(projectRoot, filePath)`.
- `tests/security/project-boundary-852.test.ts`: pins only the explicit
  `ctx_execute_file` path guard.
- The batch handler in `src/server.ts`: calls persistent
  `ContentStore.index()` after execution.

## Integration Constraint

The external integration workflow has removed every execution MCP tool from
the read-only work-node allowlist. It will consider restoring capability only
after all of these conditions hold:

- this component implements and commits a unified boundary;
- the integration session independently checks the diff, component tests, and
  temporary-fixture probes;
- the candidate fails closed in a real read-only work node;
- the Governance Plugin update path satisfies its separate safe-upgrade
  prerequisite.

The component session does not modify or restore the external allowlist and
must not treat component unit tests as integration acceptance.

## Implemented Boundary

- `CONTEXT_MODE_EXECUTION_MODE=restricted` fixes one policy for all three
  execution handlers; MCP input has no mode or read-only authority field.
- `CONTEXT_MODE_RESTRICTED_PROJECT_ROOT` is mandatory and is the only project
  authority in restricted mode. The compatibility resolver's transcript,
  `PWD`, and `cwd` fallbacks are never used as the boundary.
- Linux uses a verified `bubblewrap` profile with a read-only project, isolated
  network and PID namespaces, dropped capabilities, read-only temporary paths,
  bounded environment, and process-group teardown. merged-`/usr` symlinks are
  recreated instead of incorrectly bind-mounted.
- Shell, JavaScript, TypeScript, Python, and their child processes use the same
  launcher. macOS, Windows, a missing backend, or a failed capability probe
  return a stable fail-closed result.
- Restricted execution bypasses ContentStore, FTS5, session/statistics/event
  writes, readiness/preload files, and raw-launcher self-heal mutations.
  Restricted batch search uses request-local memory only.
- Compatibility mode remains the default and keeps its existing writable,
  network-enabled, persistent behavior with non-read-only tool metadata.
