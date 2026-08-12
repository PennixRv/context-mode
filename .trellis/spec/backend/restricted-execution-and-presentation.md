# Restricted Execution And MCP Presentation Contract

## 1. Scope / Trigger

Apply this contract whenever changing `ctx_execute`, `ctx_execute_file`,
`ctx_batch_execute`, `PolyglotExecutor`, execution startup, execution-result
storage, MCP source/index-summary formatting, or a platform manifest that
controls which presentation environment values reach the stdio MCP process.

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

Compatibility execution and host-side indexable test fixtures share one
caller-independent temp resolver:

```typescript
resolveHostTempDirectory(): string
HOST_TEMP_DIRECTORY: string
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

The Codex Plugin stdio MCP manifest keeps
`env.CONTEXT_MODE_PLATFORM=codex` fixed and forwards exactly the five
presentation keys above through `env_vars`. The allowlist contains names only:
it must not contain budget values, credentials, prefixes, wildcards, or another
environment key. Codex copies a named value only when the parent process has
set it; absence therefore continues to select the server defaults. Source,
offline marketplace, installed plugin, and normalized `codex mcp list --json`
representations must keep the same ordered list.

The MCP input schemas do not expose `mode`, `readOnly`, an isolation backend,
or another authority-elevation field. Unknown caller fields cannot replace the
server decision.

Response presentation uses these shared signatures:

```typescript
interface PresentationMeasurement {
  utf8Bytes: number;
  unicodeChars: number;
  totalLines: number;
  nonEmptyLines: number;
}

compactTypedResult<T extends object>(value: T, isError?: boolean): ToolResult
addResponseNotice(response: ToolResult, notice: string): ToolResult
hashBatchCommands(commands: readonly { label: string; command: string }[]): string
```

`hashBatchCommands()` hashes the JSON encoding of the complete ordered
`[label, command]` pairs. It never hashes only display previews.

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
- Compatibility execution resolves its host temp root without trusting an
  inherited POSIX `TMPDIR`, then creates a per-call dot-prefixed
  `.ctx-mode-*` directory and exports that private directory as child
  `TMPDIR`. The dot prefix remains required by upstream Issue #186.
- A test fixture that must represent an indexable project root uses
  `HOST_TEMP_DIRECTORY`, not ambient `os.tmpdir()`: real `ctx_execute` children
  intentionally see a hidden `.ctx-mode-*` ancestor, and hidden ancestors must
  remain non-indexable. This is fixture placement, never an indexer exception.

### Presentation

- Presentation is downstream of execution, security, indexing, search,
  persistence, recovery compare-and-swap, and destructive confirmation. It
  may compact wrapper prose but must not globally truncate actionable matches,
  warnings, errors, refusals, conflicts, targets, or counts.
- `renderExecutionSource()` preserves language, actual bounded source,
  original/preview/omitted character semantics, explicit truncation state, and
  a SHA-256 digest of the complete source. Untruncated source may omit redundant
  zero/false labels; truncated source keeps shown/original/omitted facts.
- `renderCommandSource()` returns an actual short command without an accounting
  suffix. A truncated command includes a visible ellipsis, shown/original
  counts, and the complete command digest so the preview cannot look complete.
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
- Normal queried `ctx_batch_execute` output has exactly two non-empty wrapper
  lines before the first query heading: an execution/persistence/index/query
  summary with the exact persistent source, then every bounded command in
  input order plus one canonical batch digest. It does not repeat
  `## Commands`, `## Indexed Sections`, or a five-field ledger per command.
  Restricted mode uses the same command proof, reports `Persisted: no`, keeps
  request-local section discovery after matches, and never writes FTS5.
- `ctx_batch_execute.queries` remains required with `.min(1)`. Do not invent a
  no-query presentation branch without an independently approved protocol
  change and compatibility review.
- Bounded typed checkpoint and RecoveryBrief responses put compact JSON in
  `content[0].text` and the identical object in `structuredContent`. Additional
  notices are appended as later text items; they must not prefix or corrupt the
  JSON compatibility item. Error flags remain unchanged.
- Tools whose visible body is capability-bearing rather than wrapper, including
  `ctx_stats`, destructive `ctx_purge` results, and already-minimal
  `ctx_insight`, are not shortened merely for an aggregate reduction metric.
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
| Indexable test fixture runs under hidden sandbox `TMPDIR` | Resolve the outer fixture from `HOST_TEMP_DIRECTORY`; do not relax hidden-path checks |
| Presentation value is absent, empty, negative, non-numeric, or unsafe integer | Use the documented default |
| Positive presentation value is below/above range | Clamp to the documented minimum/maximum |
| Source is truncated | Keep preview plus shown/original/omitted/truncated/digest facts |
| Command is truncated | Keep actual preview, explicit ellipsis, shown/original counts, and full digest |
| Queried batch succeeds in compatibility mode | Two wrapper lines before matches; exact persistent source and every command remain visible |
| Batch command times out, is skipped, or errors | Preserve its input position and explicit status in the command proof |
| Restricted batch succeeds | Report request-local scope and `Persisted: no`; no FTS5 or stats write |
| Typed state has an update notice | Keep compact JSON in `content[0]`; append notice as later text content |
| Presentation measurement improves only by truncating an actionable result | Reject the change; wrapper and actionable measurements must be separated |
| Codex source, built, installed, or normalized manifest omits, reorders, or adds an `env_vars` name | Fail the manifest or release-asset verification; do not publish the asset |

Errors must be stable, bounded, and must not include the rejected sensitive
path or source body.

## 5. Good / Base / Bad Cases

- Good: Linux server starts with an explicit canonical root and working
  `bubblewrap`; all three entrances read project data, cannot write or reach a
  host listener, use request-only result matching, and return bounded source
  provenance.
- Good presentation: queried batch returns execution/index/source/query facts
  on line one, all actual bounded commands plus canonical digest on line two,
  then complete matches. Typed state returns compact parseable JSON and an
  identical structured object.
- Base: no execution mode is configured. Existing writable, networked,
  persistent behavior remains available and its tool metadata says so. If no
  presentation value is set in the Codex parent, the MCP uses the documented
  defaults rather than receiving a value from the manifest.
- Bad: a handler trusts `cwd`, `readOnly: true`, a deny string scan, or a recent
  transcript as authority; mounts a writable temporary directory; writes
  restricted output to FTS5; silently falls back when isolation fails; or makes
  hidden paths indexable solely to accommodate a test fixture. A Codex manifest
  that hard-codes budgets, forwards a credential, or uses a prefix/wildcard is
  also invalid.
- Bad presentation: remove source echo because one host displays tool input;
  hash only command previews; repeat section inventories before inline matches;
  prefix prose to typed JSON; hide warnings to meet a line budget; or abbreviate
  a destructive target.

## 6. Tests Required

Run policy and presentation unit tests plus real boundary and MCP probes:

```bash
TMPDIR=/tmp pnpm exec vitest run \
  tests/execution-policy.test.ts \
  tests/presentation-policy.test.ts \
  tests/executor/restricted-boundary.test.ts \
  tests/core/restricted-execution-server.test.ts \
  tests/core/echo-commands.test.ts \
  tests/security/project-boundary-852.test.ts \
  tests/plugins/codex-manifest.test.ts \
  tests/plugins/codex-presentation-env-forwarding.test.ts \
  tests/scripts/codex-release-asset.test.ts
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
Codex delivery tests must compare the exact ordered five-name allowlist across
the source manifest, built payload, installed payload, and normalized MCP
transport. A real stdio process must prove both absent-variable defaults and a
configured `64/64/16/0/160` parent environment without using secret values.

Presentation contract tests must enumerate all registered tools, separate
wrapper and actionable measurements, and pin UTF-8 bytes, Unicode characters,
and non-empty lines for deterministic fixtures. They must assert two batch
wrapper lines before matches, every actual command in input order, exact
persistent source, canonical digest stability, status for partial execution,
absence of the repeated five-field command ledger, and byte-for-byte unchanged
actionable fixtures. Typed-state tests must parse `content[0]`, compare it with
`structuredContent`, preserve `isError`, and prove that an added notice becomes
a later text item.

Run the shared indexing fixture through the real `ctx_execute` MCP without
overriding its hidden `TMPDIR`; assert the `.ctx-mode-*` basename and passing
file/test totals. Temp cleanup tests must capture the exact child `TMPDIR` and
assert that path is removed after completion. They must not scan all
`.ctx-mode-*` entries under a shared host temp root because parallel executor
tests legitimately create unrelated live directories.

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

For response presentation:

```typescript
// Wrong: one global slice hides query matches, warnings, or destructive scope.
return { content: [{ type: "text", text: render(result).slice(0, maxChars) }] };

// Correct: compact only the typed wrapper; keep the actionable result intact.
const measured = measureResponsePresentation(compactWrapper, actionableResult);
return {
  content: [{ type: "text", text: `${compactWrapper}\n${actionableResult}` }],
};
```

For bounded typed state:

```typescript
// Wrong: a notice makes the compatibility JSON item unparsable.
response.content[0].text = `${notice}\n${response.content[0].text}`;

// Correct: content[0] stays compact JSON and mirrors structuredContent.
addResponseNotice(compactTypedResult(state), notice);
```

For host-side indexable fixtures:

```typescript
// Wrong: ctx_execute makes this path a descendant of hidden .ctx-mode-*.
const project = mkdtempSync(join(tmpdir(), "indexable-project-"));

// Correct: preserve both sandbox hiding and hidden-path index exclusion.
const project = mkdtempSync(join(HOST_TEMP_DIRECTORY, "indexable-project-"));
```
