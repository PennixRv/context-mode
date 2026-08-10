# Codex Trellis Recovery Boundaries

## Scenario: Independent Trellis SessionStart Orientation

### 1. Scope / Trigger

Use this contract when changing the project-local Codex SessionStart hook in
`.codex/hooks.json` or `.codex/hooks/session-start.py`. It supplies compact,
read-only Trellis task orientation. It coexists with, but does not alter, the
context-mode plugin's same-session checkpoint lifecycle.

### 2. Signatures

The project-local registration has exactly one bounded entry:

```json
{
  "matcher": "^(startup|resume|clear|compact)$",
  "hooks": [
    {
      "type": "command",
      "command": "python3 -X utf8 .codex/hooks/session-start.py",
      "timeout": 10,
      "additionalContextLimit": 900
    }
  ]
}
```

The hook emits the standard Codex response shape:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<trellis-session>...</trellis-session>"
  }
}
```

### 3. Contracts

- The local context contains only a workflow-phase index, active task path and
  status, present artifact names, and present spec-index paths. It does not
  read or emit task prose, RecoveryBrief bodies, transcripts, tool I/O,
  credentials, journal content, or checkpoint payloads.
- The output is capped at 900 UTF-8 bytes, including stale pointer paths. An
  unavailable Trellis runtime returns valid empty context with zero exit
  status; it must not block Codex startup or compaction.
- `.codex-plugin/hooks.json` remains independent: its compact matcher is
  `^compact$`, its command remains `checkpoint-sessionstart.mjs`, and its
  `additionalContextLimit` remains 1500. Do not proxy, chain, merge, or edit
  plugin hook declarations through the Trellis hook.
- The local hook never writes task artifacts, task runtime state, or a
  RecoveryBrief, and it never determines post-compaction continuation behavior
  or instruction precedence.
- Shared active-task resolution treats filesystem errors while probing a task
  pointer as a stale pointer. The hook keeps its bounded, zero-exit orientation
  response instead of allowing an overlong or inaccessible path to erase all
  context through the outer fail-open handler.

### 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| `startup`, `resume`, `clear`, or `compact` with a valid task | Bounded orientation with task status and artifact-name index only |
| No active task | Bounded orientation with `Task: none; status=none.` |
| Active pointer is stale | Bounded orientation with `status=stale-pointer`; no task write |
| Active pointer cannot be probed (`OSError`, including an overlong path) | Bounded orientation with `status=stale-pointer`; no task write |
| Trellis runtime or script dependency is unavailable | Valid zero-exit SessionStart JSON with empty `additionalContext` |
| Task pointer or status field is unusually long | UTF-8 output remains at or below 900 bytes |
| Plugin checkpoint hook fails or is empty | Trellis hook makes no transport claim and does not alter plugin behavior |

### 5. Good / Base / Bad Cases

- Good: compact SessionStart receives a bounded current task orientation from
  Trellis and a separately generated historical checkpoint projection from
  context-mode; neither hook writes project state.
- Base: there is no active task or Trellis files are temporarily unavailable;
  the local hook returns valid empty or no-task output and Codex remains
  unblocked.
- Bad: adding a RecoveryBrief write to the hook, outputting task bodies,
  reintroducing a first-reply/continuation directive, or modifying the plugin
  manifest to combine the two hook responsibilities.

### 6. Tests Required

- `tests/hooks/trellis-session-start.test.ts` asserts one local bounded
  registration, unchanged plugin compact registration, all four source values,
  no-active and stale-pointer behavior, no task/Brief body exposure, no task
  writes, unavailable-runtime fail-open output, and an overlong pointer cap
  that remains a stale-pointer response.
- `tests/plugins/codex-manifest.test.ts` continues to assert the packaged
  context-mode plugin lifecycle and its 1500-byte compact budget.
- Run `python3 -m py_compile .codex/hooks/session-start.py`, the focused Vitest
  contract tests, TypeScript no-emit checking, and `git diff --check` before
  commit. A disposable multi-hook Codex host smoke is separate native evidence,
  not a replacement for these deterministic tests.

### 7. Wrong Vs Correct

#### Wrong

```text
Trellis SessionStart hook -> write RecoveryBrief -> call context-mode compact hook
```

This couples semantic task state to a best-effort transport lifecycle and
makes a hook failure capable of corrupting or blocking project continuity.

#### Correct

```text
Trellis SessionStart hook      -> bounded read-only current-task orientation
context-mode plugin hook       -> bounded same-session checkpoint projection
Trellis coordinator workflow   -> semantic RecoveryBrief synchronization
```

The three paths have separate outputs and authority. A model-facing global
continuation policy remains outside all three hook/provider paths.

## Scenario: Codex RecoveryBrief Identity Bridge

### 1. Scope / Trigger

Use this contract when validating or changing the Codex-only identity bridge
for explicit `ctx_recovery_brief_status` or `ctx_recovery_brief_update` calls.
The bridge transports same-session identity; Trellis remains the semantic task
and RecoveryBrief owner. The provider path must retain the canonical project
root and trusted-file rules in [Codex Checkpoint Attestation](./codex-checkpoint-attestation.md).

### 2. Signatures

```text
Codex PreToolUse(tool_name, session_id, cwd)
  -> updatedInput.__context_mode_recovery_brief_capability
  -> ctx_recovery_brief_status/update
```

The Trellis activation command is:

```sh
TRELLIS_CONTEXT_ID=codex_<session-id> \
python3 ./.trellis/scripts/task.py start <task-dir>
```

The update result may add one structural diagnostic while retaining the stable
provider error code:

```typescript
interface RecoveryBriefValidationIssue {
  code: RecoveryBriefValidationIssueCode;
  path: string;
  expected: string;
}

interface RecoveryBriefProviderUpdateResult {
  errorCode: RecoveryBriefErrorCode;
  briefSha256: string | null;
  briefBytes: number | null;
  validationIssue?: RecoveryBriefValidationIssue;
}
```

### 3. Contracts

- The static matcher is exact for the two owned names
  `mcp__context_mode__ctx_recovery_brief_status` and
  `mcp__context_mode__ctx_recovery_brief_update`; `ctx_recovery_brief_init`,
  external MCPs, and native tools are outside the bridge.
- The hook uses the authoritative `session_id` and canonical `cwd` to issue a
  private, short-lived, one-use capability. The MCP child consumes it before
  provider selection and runs the existing provider/CAS operation under the
  bound project/session override.
- A valid capability is meaningful only when the same Codex session has an
  active Trellis runtime pointer. A status result with `errorCode: "NONE"`,
  `provider: "trellis"`, `task: "active"`, and `health: "available"` proves
  attribution; `SESSION_UNAVAILABLE` is the required fail-closed result when
  the pointer is absent, stale, invalid, or the capability is missing.
- A native host smoke must activate the task before the MCP call. A new
  unactivated or unrelated Codex session must not be treated as a bridge
  failure merely because it returns `SESSION_UNAVAILABLE`.
- Capability records contain no task prose, Brief body, tool I/O, credentials,
  or provider configuration. They are consumed atomically and removed after
  one use.
- Host-side capability fixtures use `HOST_TEMP_DIRECTORY`, which resolves a
  trusted POSIX temp root to its existing canonical path before a fixture is
  created. This handles macOS system aliases such as `/var -> /private/var`
  without weakening the rule that caller-supplied capability storage and every
  existing descendant ancestor must be free of symbolic links. Windows keeps
  its native `TEMP`/`TMP` spelling; do not convert it to a `\\?\` namespace
  path that downstream `path.resolve()` callers do not accept as equivalent.
- Private capability persistence and capability-backed PreToolUse routing are
  POSIX-only while their security contract depends on owner UID and exact
  `0700`/`0600` modes. Node mode bits do not prove Windows ACL privacy, so the
  bridge fails closed there. Exact owned-tool matching remains cross-platform;
  tests must not turn an unproved Windows ACL into a positive capability.
- `ctx_recovery_brief_update.brief` uses a strict, fully shaped Zod object with
  slot-specific priority literals, source-kind values, list bounds, timestamp
  and digest shapes. The runtime validator independently enforces exact UTF-8
  byte, canonical timestamp, control-character, aggregate-size, provenance,
  and CAS rules for every caller.
- Invalid direct updates retain `INVALID_RECOVERY_BRIEF` and may return only the
  first deterministic `validationIssue`. Its path is built from known schema
  fields and bounded list indexes; its code and expectation are fixed contract
  text. Never include a received value, unknown caller field name, Brief body,
  source path/content, prompt, or tool input/output.
- `briefBytes` always means persisted UTF-8 RecoveryBrief file bytes, including
  formatting and the final newline. `briefSha256` hashes canonical compact JSON
  and remains the compare-and-swap identity, so formatting-only file changes
  may change `briefBytes` without changing `briefSha256`.

### 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| Active Trellis pointer and valid capability | Trellis status/CAS operation with `errorCode: "NONE"` |
| No pointer for this exact session | Content-free `SESSION_UNAVAILABLE`; no provider fallback or mutation |
| Missing, malformed, expired, replayed, cross-project, or wrong-session capability | Content-free `SESSION_UNAVAILABLE`; no provider/task mutation |
| External or similar-name MCP | No context-mode bridge invocation or argument rewrite |
| Hook/server capability storage differs in an isolated profile | Mark the probe invalid; do not interpret it as provider or Trellis failure |
| Trusted OS temp root is exposed through a platform alias | Canonicalize the trusted root through `HOST_TEMP_DIRECTORY` before creating the fixture; retain fail-closed checks for explicit descendant links |
| Windows cannot prove private capability ACLs through Node mode bits | Capability issuance/persistence and capability-backed routing fail closed; exact tool-name matching remains available |
| Submitted Brief violates a runtime structural/byte rule | `INVALID_RECOVERY_BRIEF` plus one bounded content-free `validationIssue`; no write |
| Existing Brief is absent, malformed, unsafe, or source-drifted | `briefBytes: null`; do not report canonical JSON length as file size |
| Successful update followed by immediate status | Update bytes, status bytes, and persisted file size are equal |
| Valid file is reformatted without semantic changes | Canonical `briefSha256` remains stable; status reports the new file byte size |

### 5. Good / Base / Bad Cases

- Good: `task.py start` activates the exact Codex session, the status call
  returns the Trellis provider with `NONE`, and the consumed capability leaves
  no pending record.
- Base: a fresh session calls status before task activation and receives
  `SESSION_UNAVAILABLE` without creating a local provider.
- Bad: infer a task from the latest SessionDB event, add a project fallback,
  claim bridge success from hook completion alone, expose an untyped
  `brief: z.unknown()`, echo a rejected fact value in diagnostics, construct a
  capability fixture directly below raw `tmpdir()` on macOS, or relax storage
  ancestry validation to make that fixture pass.

### 6. Tests Required

- Hook tests assert exact matcher names, authoritative `session_id`/`cwd`, and
  opaque capability injection only for the two owned tools.
- Server tests assert atomic consume, exact Trellis pointer binding, CAS
  routing, replay/cross-session rejection, and no local-provider fallback.
- Schema tests must inspect MCP `tools/list`, not only TypeScript types: all ten
  top-level fields, nested strict fact fields, required arrays/nullables,
  slot-specific priority literals, source kinds, and list maximums must survive
  JSON Schema projection.
- Provider tests must compare successful update/status `briefBytes` with
  `statSync(...).size`, prove formatting-only digest stability and CAS behavior,
  and use sentinels to prove invalid diagnostics never echo semantic content.
- Capability security suites must create host fixtures below
  `HOST_TEMP_DIRECTORY`, assert on POSIX that it equals its `realpathSync()`
  result, and retain separate explicit symlink-directory and symlink-ancestor
  rejection cases. Windows tests must retain the native temp spelling. The
  three RecoveryBrief/MCP capability suites must pass on macOS, Linux, and
  their existing bounded Windows coverage.
- Windows coverage asserts exact capability tool-name ownership and skips
  positive private-storage/routing cases. Shared-store handler tests must call
  `ctx_purge` before deleting fixture roots so FTS5 handles are closed on
  Windows rather than relying on POSIX open-file unlink behavior.
- Release smoke must use a disposable profile for manual/automatic compact and
  a normal-profile fresh session for the explicit bridge. Record only status,
  provider, task, health, and error code; never retain raw tool input/output.
- When a capture probe is needed, keep it in a temporary profile and ensure
  hook and MCP processes share the same capability storage root.

### 7. Wrong Vs Correct

#### Wrong

```text
start a fresh Codex process -> call status -> treat SESSION_UNAVAILABLE as a
product regression
```

This tests a session with no Trellis semantic owner and ignores the fail-closed
ownership boundary.

#### Correct

```text
start Codex -> activate the same session's Trellis task -> call status once
-> assert provider=trellis, task=active, health=available, errorCode=NONE
```

The bridge transports identity only; task activation and RecoveryBrief meaning
remain under Trellis workflow control.

For host-side capability fixtures, preserve the trust-boundary distinction:

```typescript
// Wrong: macOS may spell this through the system /var symbolic-link alias.
const root = mkdtempSync(join(tmpdir(), "ctx-recovery-capability-"));

// Correct: canonicalize only the trusted host temp source, then keep all
// production checks for caller-created descendants unchanged.
const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-recovery-capability-"));
```

For update validation, the corresponding implementation pattern is:

```typescript
// Wrong: no discoverable wire contract and no repairable failure detail.
brief: z.unknown();
return { errorCode: "INVALID_RECOVERY_BRIEF" };

// Correct: shared typed shape plus an independent authoritative validator.
brief: recoveryBriefV1Schema;
const validation = validateRecoveryBrief(input.brief);
if (!validation.ok) {
  return {
    errorCode: "INVALID_RECOVERY_BRIEF",
    validationIssue: validation.issue,
  };
}
```
