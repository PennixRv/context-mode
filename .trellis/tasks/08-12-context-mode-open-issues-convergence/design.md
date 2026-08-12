# Design: Context-mode Open Issues Convergence

## 1. Design Goals

1. Correct only premises that remain true on `v1.0.186`; retain existing
   repairs when an issue is already partially fixed.
2. Preserve context-mode's large-output aggregation and compact presentation
   while making persistence explicit and failure state truthful.
3. Centralize facts that are currently inferred independently by the CLI, MCP
   server, Hook and Skill.
4. Keep compatibility execution and restricted execution separate. Host file
   authorization applies to compatibility mode; server-authoritative isolation
   remains mandatory in restricted mode.
5. Produce deterministic source/package/marketplace/release evidence from
   `devel` without mutating installed profiles or parent repositories.

## 2. Architectural Overview

```text
call intent
  -> Skill routing matrix
  -> native protocol | context-mode request
       -> execution policy (compatibility/restricted)
       -> typed execution result
       -> request-local search projection
       -> optional verified persistent write
       -> compact response renderer

Codex plugin list + manifests + filesystem
  -> typed Codex diagnostic projection
  -> CLI Doctor renderer
  -> MCP ctx_doctor renderer

local version + installation channel + channel remote
  -> one semantic comparison
  -> no action | channel-specific update action
```

The renderers do not independently infer roots, persistence, status or version
ordering.

## 3. Hook Matcher And Routing Design

### 3.1 Matcher groups

Define and export the supported Codex tool-name inventory in the Codex adapter:

- native shell/edit names;
- context-mode bare names and the two supported fully qualified MCP prefixes;
- RecoveryBrief capability names.

Generate the three manifest matcher strings from disjoint sets. Native names
remain a pure exact-alternative matcher. Context-mode names use one anchored
regex group because the plugin-qualified prefix contains `-`. RecoveryBrief
continues to use its dedicated capability matcher and is excluded from the
generic context-mode group.

Source and generated manifests must contain the same ordered groups. Tests
implement current Codex matcher semantics: pure `[A-Za-z0-9_|]` matchers are
exact alternatives; other strings use a regex. Every supported canonical name
and alias must match exactly one group. A subprocess test executes the real
Codex PreToolUse handler commands selected by that matcher algorithm and counts
one handler execution for each logical test call.

This is a defensive convergence. Current Codex exact-matcher semantics already
prevent the parent Issue 003's claimed duplicate for fully qualified
`ctx_execute`; tests record that premise correction.

### 3.2 Semantic routing

`skills/context-mode/references/routing-trust-matrix.md` is the human-auditable
contract copied from task research and shipped with the Skill. Hook constants
and test fixtures enumerate the same four routes:

- direct protocol;
- context-mode aggregation;
- original-tool artifact then `ctx_execute_file`;
- explicit failure/native permission path.

The Skill no longer says every command or every MCP result must use
context-mode. Approved CodeGraph queries, lifecycle/wait/interactive calls,
Fast Context candidate retrieval, and bounded structured MCP tools stay direct.
The Hook's external MCP classifier remains an early passthrough. Managed
unbounded Bash data commands continue to receive aggregation guidance on repeat
calls instead of being silently suppressed by the one-shot advisory marker.

The Hook cannot safely infer every external protocol's semantics, so it must
not wildcard-match or rewrite arbitrary MCP tools. The Skill and root workflow
carry those protocol-specific decisions.

## 4. Execution Persistence And Provenance

### 4.1 Input contract

Add a shared discriminated execution persistence input to
`ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute`:

```ts
type ExecutionPersistence =
  | { mode: "none" }
  | {
      mode: "verified";
      source: string;
      provenance: {
        kind: "local-command" | "local-file" | "external-locally-verified";
        reference: string;
      };
    };
```

The field is optional at the wire boundary and normalizes to `{ mode: "none" }`.
`source` and `reference` have small fixed character limits and reject empty
values. Content hashes are computed by the server; the caller cannot supply or
override them. Restricted mode rejects verified persistence because restricted
execution must not write FTS5.

Compatibility-mode output is processed in a request-local store by default.
An explicit verified request persists only successful body content. Errors,
timeouts, empty bodies, titles, command echo and renderer diagnostics are never
persistent candidates.

### 4.2 Store metadata and removal

Extend the `sources` table with backward-compatible provenance columns and a
schema migration for existing databases. Legacy rows receive an explicit
`legacy` classification. New verified execution rows store:

- provenance kind;
- bounded reference;
- verification classification;
- existing server-computed content hash and indexed timestamp.

Expose an exact `removeSource(source)` store operation and extend `ctx_purge`
with `scope: "source"` plus a required source label. Session/project behavior
remains backward compatible. A source purge deletes its porter/trigram chunks
and source metadata in one transaction, making verified candidate content
independently removable.

`ctx_search` continues to read only persistent FTS5. Request-local execution
results are searchable only inside that call (or the same batch call). The
caller can retry with a better intent/query without claiming the prior output
became project knowledge; future cross-call search requires explicit verified
persistence.

### 4.3 External candidates

The shipped Skill prohibits direct persistence of unverified Fast Context,
web/API, or structured external results. Such tools remain direct, preferably
write a host-approved artifact, and use non-persistent `ctx_execute_file` for
local verification. After verification, `ctx_index(path)` is the explicit
persistence operation, or the execution call may use verified persistence with
bounded provenance. `ctx_fetch_and_index` documentation is narrowed to trusted,
explicit indexing and is no longer the default web workflow.

## 5. File Execution Path And Resource Protection

Remove `checkProjectBoundary` only from compatibility `ctx_execute_file`.
Retain host Read deny policy evaluation and OS access errors. Relative paths
continue to resolve against the selected project/call cwd; absolute paths and
`..` are accepted when the host/OS permits them. `ctx_execute` shell path access
and `ctx_index(path)` keep their existing host-authorized semantics.

Before child execution, `PolyglotExecutor.executeFile` opens the target, checks
the opened descriptor is a regular file, enforces a configurable hard input
byte limit, and reads one bounded snapshot. The child language wrapper reads
that snapshot while retaining the original path in `FILE_CONTENT_PATH` and
`file_path`. This avoids an unbounded child read and prevents a path replacement
between preflight and content capture from changing the analyzed bytes.
Directories, FIFOs/devices, missing/denied files, oversized files and symlink
loops fail with bounded typed errors. Existing execution timeout, output cap
and process-tree cleanup remain unchanged.

Restricted mode keeps `validateRestrictedInvocation`, the canonical project
boundary, bubblewrap read-only bind, no-network/no-background guarantees, and
fail-closed isolation probing. The snapshot is exposed read-only inside the
restricted profile; it never grants another host path.

## 6. Batch Execution Integrity

Replace `nodeOptsPrefix` with a shell-specific preamble:

- POSIX: `export NODE_OPTIONS=<single-quoted-value>\n`;
- PowerShell: `$env:NODE_OPTIONS=<single-quoted-value>\n`;
- cmd: `set "NODE_OPTIONS=<escaped-value>"\r\n`.

The original command is appended unchanged after the preamble. There is no
`eval`, `sh -c` nesting or string interpolation of user syntax. The preamble
therefore applies to a complete `for`, `if`, `while`, brace-group or function
script and leaves the script's final exit status intact.

Use a typed per-command result:

```ts
interface BatchCommandResult {
  label: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  status: "completed" | "failed" | "timed_out" | "skipped" | "error";
}
```

Serial and parallel runners return the same type. Only exit code zero with
non-empty stdout contributes searchable body content. `query_scope=batch`
indexes those bodies in a request-local store before querying; verified
persistence additionally writes successful bodies to the persistent store.
`query_scope=global` searches the existing persistent store and includes the
current batch only when verified persistence succeeded. Summary counts and
indexed-section claims derive from the typed results, not promise fulfillment.

## 7. Doctor And Version Design

### 7.1 Shared Codex diagnostic projection

Promote the existing private Codex plugin status into one exported projection:

```ts
interface CodexPluginDiagnostic {
  identity: { enabled: boolean; name: string; version: string | null };
  runtime: {
    configuredRoot: string;
    runtimeRoot: string | null;
    releaseMatches: boolean;
    manifestAvailable: boolean;
  };
  hooks: {
    required: string[];
    registered: string[];
    missing: string[];
    assetsReady: boolean;
  };
}
```

The Codex adapter owns plugin-list parsing and manifest inspection. CLI Doctor
and MCP `ctx_doctor` call that owner and only render the returned facts. Tests
cover normal marketplace, offline marketplace, disabled, stale source root,
same-release/different-root, missing manifest and missing Hook asset states.

### 7.2 Version channels

Add a strict internal semantic-version parser/comparator and a channel-aware
status type. It supports prerelease/build syntax without adding a runtime
dependency. Comparison returns `local-newer`, `equal`, `remote-newer` or
`uncomparable`.

Channel rules:

| Channel | Remote source | Update text |
| --- | --- | --- |
| npm/global | npm `latest` | npm/global update command |
| Codex marketplace | marketplace/plugin manager metadata when comparable | Codex marketplace update/reinstall command |
| standalone/Git | explicit Git/release source only | source-specific command, otherwise informational |
| unknown | none | local identity only |

CLI Doctor, MCP response version warnings, and analytics consume this status.
A local-newer or uncomparable value never emits an update warning.

## 8. Replayable Measurement Probe

Create a canonical measurement script under `scripts/` with importable helpers.
It resolves the repository root using an explicit option or
`git -C <script-dir> rev-parse --show-toplevel`, validates the result against
the package identity, and never relies on parent-depth arithmetic.

The existing archived path becomes a compatibility entrypoint that discovers
the Git root and launches the canonical script. This is a functional replay
repair required by Issue 053, not a rewrite of historical result files.

MCP child stderr is accumulated as a fixed-size tail, sanitized for common
credential assignments/authorization headers, and attached to startup,
request, close or connection errors. Success output contains no stderr. Tests
stage the entrypoint in active and archived directory shapes and inject a
failing child that emits a long secret-like prefix plus a safe tail.

## 9. Compatibility And Generated Assets

- Preserve presentation defaults `240/160/96/20/1200` and the five Codex
  `env_vars` forwarding entries.
- Preserve #717/#736 source/command audit metadata in stored provenance while
  keeping compact response rendering unchanged.
- Build updates tracked TypeScript and Hook bundles. Marketplace and npm
  fixtures verify the same Skill, Hook, manifest and diagnostic behavior.
- No installed cache, normal `CODEX_HOME`, parent issue file or Gitlink is
  modified.

## 10. Rollback

Before publication, rollback is a normal revert of the implementation commits.
After publication, do not move or delete the release tag. Publish a follow-up
patch that reverts the relevant behavior while retaining database migration
compatibility. Provenance columns are additive and safe for older readers;
source-scoped purge must not be used as a schema rollback mechanism.

If any release gate fails, do not tag or push partial evidence. If failure
occurs after the source candidate but before the evidence commit, fix on a new
source candidate and rerun the native preflight. An occupied expected tag stops
release selection; it is never overwritten.
