# Restricted Execution And MCP Presentation Contract

## 1. Scope / Trigger

Apply this contract whenever changing `ctx_execute`, `ctx_execute_file`,
`ctx_batch_execute`, `PolyglotExecutor`, execution startup, execution-result
storage, or MCP source/index-summary formatting.

These tools share one security decision. A working directory, deny-pattern
scan, tool annotation, or caller-provided field is not an execution boundary.
The contract also prevents restricted provenance from being implemented by
writing source or output to FTS5.

## 2. Signatures

The server resolves one `ExecutionPolicyDecision` and validates each entrance
with `validateRestrictedInvocation()` before launching a process:

```typescript
type ExecutionMode = "compatibility" | "restricted";

interface ExecutionPolicyDecision {
  ok: boolean;
  mode: ExecutionMode;
  authoritySource: "server-default" | "server-environment";
  projectRootSource: "compatibility-resolver" | "restricted-server-environment";
  projectRoot: string;
  isolation: BubblewrapIsolation | null;
  persistence: "persistent" | "request-only";
  network: "allowed" | "disabled";
  filesystem: "read-write" | "project-read-only";
  background: "allowed" | "forbidden";
  errorCode: ExecutionPolicyErrorCode | null;
}
```

Server environment:

| Key | Contract |
| --- | --- |
| `CONTEXT_MODE_EXECUTION_MODE` | Empty/absent means `compatibility`; `restricted` enables the enforced boundary; every other value fails closed. |
| `CONTEXT_MODE_RESTRICTED_PROJECT_ROOT` | Required in restricted mode; absolute, existing directory, canonicalized once for policy use. |
| `CONTEXT_MODE_CODE_ECHO_MAX` | Default 240, minimum 64, maximum 2,000 Unicode code points; `0` means 64. |
| `CONTEXT_MODE_COMMAND_ECHO_MAX` | Default 160, minimum 64, maximum 500; `0` means 64. |
| `CONTEXT_MODE_TITLE_PREVIEW_MAX` | Default 96, minimum 16, maximum 240; `0` means 16. |
| `CONTEXT_MODE_SEARCHABLE_TERMS_MAX` | Default 20, range 0-80; `0` disables optional terms. |
| `CONTEXT_MODE_RESULT_PREVIEW_MAX` | Default 1,200, minimum 160, maximum 3,000; `0` means 160. |

The MCP input schemas do not expose `mode`, `readOnly`, an isolation backend,
or another authority-elevation field. Unknown caller fields cannot replace the
server decision.

## 3. Contracts

### Execution Modes

- Compatibility mode retains the historical resolver, writable subprocesses,
  network, background execution, statistics, SessionDB events, and persistent
  FTS5 indexing. Its tool annotations must remain explicitly non-read-only.
- Restricted mode takes authority only from
  `CONTEXT_MODE_RESTRICTED_PROJECT_ROOT`; it never falls back to transcripts,
  `PWD`, or `process.cwd()`.
- Restricted mode is supported only on Linux with a successful real
  `bubblewrap` probe. macOS, Windows, missing `bwrap`, and failed namespace
  setup return `CTX_EXEC_ISOLATION_UNAVAILABLE` without launching user code.
- The isolated view read-only mounts the canonical project and the minimum
  system/runtime support needed to launch the selected interpreter. External
  project data, host temporary directories, and the rest of the user's home
  remain hidden. Merged-`/usr` symlinks must be recreated as symlinks rather
  than incorrectly bind-mounted.
- Restricted languages are `shell`, `javascript`, `typescript`, and `python`.
  Scripts enter the namespace through stdin/`--ro-bind-data`; no host script
  file is created. `/tmp` and the project mount are read-only.
- Network namespaces, cleared environment variables, capability dropping,
  process groups, and namespace teardown apply equally to nested processes.
  Caller-requested background execution is rejected before launch.

### Persistence And Lifecycle

- Restricted execution results bypass `trackResponse()`, `ContentStore`,
  SessionDB event writes, statistics files, tool-call counters, and version
  network checks.
- Restricted batch queries use request-memory section splitting and matching.
  They report `Persisted: no` and cannot later be retrieved by `ctx_search`.
- `start.mjs` must determine restricted or invalid posture before any cache
  repair, dependency installation, hook normalization, shim generation, build,
  or marketplace repair. A restricted release with missing bundles or
  dependencies fails instead of healing itself.
- Startup and shutdown cleanup must be mode-aware. Restricted mode must not
  create or delete compatibility preload or readiness-sentinel paths, including
  paths left by a previous PID owner.

### Presentation

- `renderExecutionSource()` and `renderCommandSource()` preserve language,
  original character count, preview character count, omitted count, explicit
  truncation state, and a SHA-256 digest of the complete source.
- Truncation iterates Unicode code points and uses a Markdown fence longer than
  any backtick run in the preview. A truncated command includes an explicit
  marker and cannot look complete.
- A source/command preview value of zero is not suppression. Upstream Issues
  #717 and #736 require visible executed source/commands for audit and pattern
  inspection, so zero maps to the tested 64-character minimum. Optional
  `Searchable terms` may be disabled with zero.
- Indexed and request-local result titles, query headings, term values, and
  result snippets consume the shared `PresentationPolicy`; handlers must not
  introduce independent response limits for the same concepts.
- These limits affect context-mode MCP return content only. The Codex host owns
  its `Called` argument display and may still render the complete MCP input.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Mode absent or empty | Compatibility decision from `server-default` |
| Unknown mode | `CTX_EXEC_POLICY_INVALID`; startup remains non-mutating |
| Restricted root absent, relative, missing, or not a directory | `CTX_EXEC_PROJECT_ROOT_INVALID` |
| Platform is not Linux or `bubblewrap` probe fails | `CTX_EXEC_ISOLATION_UNAVAILABLE` |
| Restricted language is outside the four-language set | `CTX_EXEC_LANGUAGE_UNSUPPORTED` |
| Restricted call asks for background execution | `CTX_EXEC_BACKGROUND_FORBIDDEN` |
| `cwd`/file path is outside, missing, or escapes through a symlink | `CTX_EXEC_PATH_OUTSIDE_PROJECT` or `CTX_EXEC_PATH_INVALID` before launch |
| Restricted batch asks for `query_scope: "global"` | `CTX_EXEC_GLOBAL_QUERY_FORBIDDEN` |
| Presentation value is absent, empty, negative, non-numeric, or unsafe integer | Use the documented default |
| Positive presentation value is below/above range | Clamp to the documented minimum/maximum |
| Source or command is truncated | Keep preview plus original/preview/omitted/truncated/digest metadata |

Errors must be stable, bounded, and must not include the rejected sensitive
path or source body.

## 5. Good / Base / Bad Cases

- Good: Linux server starts with an explicit canonical root and working
  `bubblewrap`; all three entrances read project data, cannot write or reach a
  host listener, use request-only result matching, and return bounded source
  provenance.
- Base: no execution mode is configured. Existing writable, networked,
  persistent behavior remains available and its tool metadata says so.
- Bad: a handler trusts `cwd`, `readOnly: true`, a deny string scan, or a recent
  transcript as authority; mounts a writable temporary directory; writes
  restricted output to FTS5; or silently falls back when isolation fails.

## 6. Tests Required

Run policy and presentation unit tests plus real boundary and MCP probes:

```bash
TMPDIR=/tmp pnpm exec vitest run \
  tests/execution-policy.test.ts \
  tests/presentation-policy.test.ts \
  tests/executor/restricted-boundary.test.ts \
  tests/core/restricted-execution-server.test.ts \
  tests/core/echo-commands.test.ts \
  tests/security/project-boundary-852.test.ts
pnpm run typecheck
pnpm test
pnpm run build
```

Assertions must cover all three tool entrances, caller elevation fields,
project reads, absolute/traversal/prefix/symlink/indirect paths, command-internal
`cd`, create/overwrite/rename/delete, host and project temporary paths, nested
children, network, concurrency, timeout cleanup, background survival, later
`ctx_search` non-recall, missing isolation, compatibility metadata, invalid and
zero presentation values, Unicode, digest stability, and generated bundles.

For generated drift, run `build` twice and require stable hashes for
`server.bundle.mjs` and `cli.bundle.mjs`, then run `git diff --check`.

## 7. Wrong Vs Correct

### Wrong

```typescript
// cwd and caller intent do not constrain arbitrary code.
await executor.execute({ code, cwd: callerCwd });
return readOnly ? response : persistentIndex(response);
```

### Correct

```typescript
const decision = currentExecutionPolicy();
const invocation = validateRestrictedInvocation(decision, {
  language,
  cwd,
  background,
});
if (!invocation.ok) return executionPolicyErrorResult(decision, toolName, invocation.errorCode!);

const result = await executor.execute({
  language,
  code,
  cwd: invocation.cwd ?? undefined,
  isolation: decision.isolation ?? undefined,
});
return finalizeExecutionResponse(decision, toolName, render(result));
```

The decision and isolation object originate at the server, and restricted
finalization bypasses every persistent accounting path.
