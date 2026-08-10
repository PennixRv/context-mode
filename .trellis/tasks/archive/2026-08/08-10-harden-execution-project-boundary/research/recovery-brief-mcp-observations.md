# RecoveryBrief MCP Observations

Date: 2026-08-10

These observations were found while running the required post-activation
`trellis-recovery-brief-sync` gate for this task. They are recorded here as
component follow-up evidence; they do not expand ROOT-ISSUE-025 or
ROOT-ISSUE-041 without a separate scope decision.

## 1. Invalid Brief Diagnostics Hide Fixed Priority Requirements

### Reproduction

1. Call `ctx_recovery_brief_status` for an active Trellis task with no Brief.
2. Submit a structurally complete Brief to `ctx_recovery_brief_update`, using
   otherwise valid facts but assigning `important` to `completed_work` or
   `next_action`.
3. Observe `errorCode: "INVALID_RECOVERY_BRIEF"` with no field-level detail.
4. Change priorities to the service's slot-specific requirements and retry the
   same `expected_sha256: "absent"` CAS update.
5. Observe a successful update.

### Confirmed Cause

The MCP tool schema exposes `brief` as `unknown`, while
`parseRecoveryBrief()` enforces priorities that are not visible in that
schema:

- `objective`, `hard_constraints`, `latest_blocker`, and `next_action` require
  `critical`;
- `decisions`, `open_work`, and `project_state` require `important`;
- `completed_work` requires `optional`.

The project-local synchronization skill describes the required fields but does
not state these per-slot priority constraints. The service correctly rejects
the invalid object and does not leave a partial file, but the caller cannot
distinguish a priority mismatch from another structural validation failure.

### Impact And Suggested Follow-Up

This is an API discoverability and diagnostic problem, not an observed
integrity failure. Publish a typed input schema or a complete field-priority
table and return a bounded validation reason such as
`completed_work[0].priority must be optional`. Add a regression test that
starts from the public MCP contract rather than importing internal TypeScript
types.

## 2. `briefBytes` Has Different Meanings In Update And Status Responses

### Reproduction

1. Successfully write the active task Brief with
   `ctx_recovery_brief_update`.
2. Observe `briefBytes: 3756` in the update response.
3. Immediately call `ctx_recovery_brief_status` and observe
   `briefBytes: 3253` for the same `briefSha256`.
4. Run `wc -c` on the Brief file and observe `3756` bytes.

### Confirmed Cause

`updateRecoveryBriefProvider()` reports the byte length of the pretty-printed
serialized file, including indentation and the final newline.
`recoveryBriefProviderStatusFromResolution()` instead reports the byte length
of `snapshot.recoveryJson`, which is the compact canonical JSON produced by
`recoverySnapshot()`. `readRecoveryBriefFile()` already returns the actual file
size as `bytes`, but that value is not used by the status response.

### Impact And Suggested Follow-Up

The field cannot currently be interpreted consistently as either persisted
file size or canonical payload size. This can mislead diagnostics, monitoring,
and tests even though the canonical digest remains stable. Define the field as
one representation and use it consistently; if both measurements matter,
publish separate names such as `fileBytes` and `canonicalBytes`. Add a test
that compares update, status, and the selected documented representation.

## Current State

- The first invalid update was rejected without creating a Brief.
- The corrected update succeeded.
- Follow-up status reported `provider: "trellis"`,
  `recoveryStatus: "available"`, `sourceDrift: false`, and
  `errorCode: "NONE"`.
- No RecoveryBrief implementation change has been made as part of this
  observation record.

## 3. Self-Tests Can Inherit A Hidden `TMPDIR` From `ctx_execute`

### Reproduction

1. Install the repository's frozen dependencies and build the project.
2. Run `tests/core/server-shared-handler.test.ts` through `ctx_execute` without
   overriding `TMPDIR`.
3. Observe that its temporary project is created below
   `/tmp/.ctx-mode-*/...` and the directory-index assertion reports
   `Indexed 0 files` instead of `Indexed 1 file`.
4. Repeat the same command with `TMPDIR=/tmp`.
5. Observe both tests pass.

### Confirmed Cause

The `ctx_execute` sandbox supplies a hidden temporary-directory root. The test
uses the inherited temporary directory for a project fixture, while production
directory indexing deliberately excludes hidden path segments. The hidden
sandbox parent therefore changes the fixture's classification and produces a
false baseline failure.

### Impact And Suggested Follow-Up

Running context-mode's own tests through the recommended context-mode tool can
produce environment-dependent false failures. Keep the production hidden-path
protection intact. Make affected tests choose an explicit non-hidden temporary
root, or provide a documented self-test harness that normalizes `TMPDIR` while
retaining the sandbox's other containment properties. Add a regression test for
the chosen harness behavior.

## 4. A Backend Probe Alone Does Not Prove Language Runtime Availability

### Reproduction

1. Resolve the restricted execution policy on Linux where `bwrap` works.
2. Inspect the detected JavaScript or Python runtime when it is installed by
   nvm, asdf, pyenv, or another user-local runtime manager.
3. Observe that the isolation namespace initially exposes `/usr`, `/bin`, the
   project, and selected system files, but not the runtime's installation path.
4. The backend probe can therefore pass using `/bin/true` while the advertised
   language runtime fails to start inside the resulting namespace.

### Confirmed Cause

The isolation capability probe proves the kernel and `bubblewrap` boundary, but
it does not prove that every selected language runtime is reachable through the
same mount profile. A system runtime such as `/usr/bin/node` works, while an
otherwise valid runtime under a user-local prefix is hidden with the rest of
the home directory.

### In-Task Resolution

Restricted execution now read-only mounts only the selected runtime's install
prefix, at its original absolute path, when the executable is outside the
already visible system and project roots. This preserves compiled-in resource
paths without exposing the rest of the user's home. Real subprocess tests cover
the system runtimes available on this host; non-system runtime prefixes remain
an explicit portability case in the residual-risk report.

## 5. Merged-`/usr` Symlinks Can Produce A False Unsupported Result

### Reproduction

1. Run the initial `bubblewrap` capability probe on a merged-`/usr` Linux
   system where `/bin` is a symbolic link to `usr/bin`.
2. The profile applies `--ro-bind /usr /usr` followed by
   `--ro-bind /bin /bin` and launches `/bin/true`.
3. Observe `bwrap: execvp /bin/true: No such file or directory` and a false
   `CTX_EXEC_ISOLATION_UNAVAILABLE` decision.
4. The same result occurs both through `ctx_execute` and from the main-session
   terminal, disproving the initial hypothesis that nested MCP execution alone
   caused the skipped tests.

### Confirmed Cause And Resolution

The profile treated `/bin`, `/sbin`, `/lib`, and `/lib64` as ordinary bind
sources even when they are merged-`/usr` symbolic links. The capability probe
and runtime launcher now share a helper that read-only binds real paths and
recreates symbolic links with `bubblewrap --symlink`. The probe launches
`/usr/bin/true`, which is guaranteed by the already mounted `/usr` tree on the
supported profile. Real boundary tests must pass after this correction; a skip
is acceptable only when the corrected capability probe genuinely fails.

## 6. The Raw MCP Launcher Can Write Before Restricted Policy Resolution

### Reproduction

1. Start `start.mjs` with `CONTEXT_MODE_EXECUTION_MODE=restricted`, an empty
   temporary `HOME`, and an empty `CONTEXT_MODE_DIR`.
2. Initialize the MCP server and call the three restricted execution tools.
3. Confirm the execution storage root remains empty, but observe
   `~/.claude/hooks/context-mode-cache-heal.mjs` under the temporary home.

### Confirmed Cause

`server.ts` skipped execution indexing, statistics, events, readiness sentinels,
and preload files, but `start.mjs` ran several disk-mutating self-heal layers
before importing the server bundle. Those layers can update plugin registries,
install or register a global hook, normalize plugin files, install missing npm
packages, synthesize bundles, or repair a partial marketplace installation.
The process had therefore already violated the no-write startup contract before
the shared execution policy was consulted.

### In-Task Resolution

The raw launcher now derives the same server-fixed posture: absent or empty is
compatibility; `restricted` and invalid values disable every startup mutation.
Restricted startup requires an existing server bundle and dependencies and
fails instead of building or repairing them. Read-only integrity checks remain
available. The MCP integration fixture asserts that the isolated storage root,
temporary home, and host temporary directory all remain file-free through the
three execution tools.

## 7. The Compatibility Project Resolver Cannot Define A Security Boundary

### Reproduction

1. Start restricted mode without a host workspace environment variable.
2. Follow `currentExecutionPolicy()` into `getProjectDir()` and
   `resolveProjectDir()`.
3. Observe that the compatibility resolver intentionally falls back through a
   recent transcript, `PWD`, and finally `process.cwd()`.
4. The initial restricted implementation canonicalized that result and would
   have treated it as the read-only project boundary.

### Confirmed Cause And Resolution

The existing resolver is designed to keep ordinary project-independent tools
working across many hosts; its total `cwd` fallback is correct for compatibility
but cannot prove restricted authority. Restricted execution now requires the
server-start fixed `CONTEXT_MODE_RESTRICTED_PROJECT_ROOT`. It does not consult
transcripts, `PWD`, or `cwd`; a missing, empty, nonexistent, or non-directory
value produces `CTX_EXEC_PROJECT_ROOT_INVALID`. Compatibility mode retains the
legacy resolver unchanged. The restricted root is not included in child
process environment and cannot be replaced by MCP tool input.
