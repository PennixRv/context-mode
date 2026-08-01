# Codex Checkpoint Attestation

## Scenario: Installed Release Native Delivery Gate

### 1. Scope / Trigger

Use this contract before claiming that a context-mode release is installed and
delivers checkpoint context through native Codex compaction. It covers four
separate facts: tagged source identity, installed-cache identity, plugin
configuration/trust, and actual native delivery. Passing a source-tree test,
archive build, cache hash comparison, or plugin-list command alone does not
prove the other facts.

### 2. Signatures

```sh
CONTEXT_MODE_VALIDATION_HOME=<disposable-codex-home> \
CONTEXT_MODE_PROJECT_PATH=<disposable-git-project> \
CONTEXT_MODE_RELEASE_PLUGIN_ROOT=<disposable-codex-home>/plugins/cache/context-mode-offline/context-mode/<version> \
CONTEXT_MODE_CHECKPOINT_TRIGGER=manual|auto \
node scripts/validate-codex-checkpoint-delivery.mjs
```

Optional `CONTEXT_MODE_REPORT_PATH` must remain below
`CONTEXT_MODE_VALIDATION_HOME`. The quality gate additionally accepts
`CONTEXT_MODE_CHECKPOINT_QUALITY_FIXTURE_PATH` and
`CONTEXT_MODE_CHECKPOINT_QUALITY_REPORT_PATH`; both are constrained by the
existing harness.

### 3. Contracts

- Candidate identity is an annotated release tag and its package version.
- A normal marketplace cache is a full Git checkout. Compare its regular files
  to `git ls-tree -r <tag>`; installer `.git/` metadata is generated and must
  be separately classified.
- A disposable offline cache is a release payload. Compare it to the verified
  offline archive payload, not to the full source tree.
- Each cache comparison enumerates every regular file and produces sorted
  `matched`, `generated`, and `excluded` sets. Every generated or excluded path
  needs a rationale; any unclassified difference fails candidate attestation.
- The native validator accepts only a materialized `context-mode-offline`
  cache below a disposable home. It rejects the normal `CODEX_HOME`, source
  tree, symbolic links, unexpected cache roots, and `node_modules`.
- Reports retain lifecycle IDs/hashes, version, state transitions, projection
  facts, and bounded diagnostics. They must not retain credentials, raw prompts,
  model responses, checkpoint payloads, tool data, or Trellis artifact bodies.
- Context-mode attests same-session checkpoint transport only. Trellis remains
  the sole owner of project-semantic cross-session task continuity.

### 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| Normal cache tracked files differ from tag blobs | Candidate cache mismatch; do not claim installed equivalence |
| Disposable cache differs from verified archive payload | Offline installation mismatch; do not run native gate |
| Normal home, source tree, symlink, or non-offline cache root supplied | Validator fails before Codex runtime work |
| Provider absent in disposable profile | Record non-secret blocker; do not copy normal credentials or substitute a normal-profile run |
| Manual/auto compaction passes | Require completed plugin hooks, `pending -> confirmed -> claimed`, and no-tool opaque-ID attestation |
| Raw report exists after extraction | Delete it with the disposable profile; retain only sanitized evidence |

### 5. Good / Base / Bad Cases

- Good: A detached tagged worktree creates a verified archive, a new profile
  installs `context-mode@context-mode-offline`, both cache comparisons are
  exact, and both native trigger reports pass.
- Base: Archive and cache parity pass, but a disposable profile has no selected
  provider. Record the blocked native gate and leave runtime parity unclaimed.
- Bad: Pointing the validator at the source tree or normal cache, copying
  authentication from normal `CODEX_HOME`, or calling a blocked run a pass.

### 6. Tests Required

- `tests/scripts/validate-codex-checkpoint-delivery.test.ts` asserts the
  installed-offline boundary and source/normal-home rejection contract.
- `tests/scripts/evaluate-codex-checkpoint-quality.test.ts` asserts privacy and
  quality-harness packaging behavior.
- `tests/codex/marketplace-layout.test.ts` asserts marketplace layout.
- `tests/hooks/codex-checkpoint-lifecycle.test.ts` asserts confirmed checkpoint
  injection and raw-content non-persistence.
- Before release claims, run the real manual and automatic validator gates in a
  provider-authenticated disposable profile. CI does not replace this gate.

### 7. Wrong Vs Correct

#### Wrong

```sh
CONTEXT_MODE_VALIDATION_HOME="$HOME/.codex" \
CONTEXT_MODE_RELEASE_PLUGIN_ROOT="$PWD" \
node scripts/validate-codex-checkpoint-delivery.mjs
```

This confuses source code and normal local state with an installed release and
can expose or mutate a real user profile.

#### Correct

```sh
CODEX_HOME="$validation_home" codex plugin marketplace add "$offline_marketplace"
CODEX_HOME="$validation_home" codex plugin add context-mode@context-mode-offline

CONTEXT_MODE_VALIDATION_HOME="$validation_home" \
CONTEXT_MODE_PROJECT_PATH="$validation_project" \
CONTEXT_MODE_RELEASE_PLUGIN_ROOT="$validation_home/plugins/cache/context-mode-offline/context-mode/$version" \
CONTEXT_MODE_CHECKPOINT_TRIGGER=manual \
node scripts/validate-codex-checkpoint-delivery.mjs
```

Run the automatic trigger separately only after the disposable profile has an
explicitly authorized provider. Never solve a missing provider by copying the
normal profile's authentication or configuration.

## Scenario: Immutable Native Compact Release Attestation

### 1. Scope / Trigger

Use this contract before publishing a fork release that claims native Codex
compact delivery. The operator preflight proves the final archive in a fresh,
provider-authorized disposable profile; CI verifies only content-free evidence
and never receives provider credentials. This gate proves bounded same-session
delivery for a pinned compatibility tuple. It does not prove task-semantic
recovery, cross-session continuity, or hostile-operator independence.

### 2. Signatures

The operator command must be run from a clean source commit before creating the
release tag:

```sh
node scripts/run-codex-native-release-preflight.mjs \
  --tag vX.Y.Z \
  --provider-tuple codex-0.145.0-local \
  --output docs/releases/attestations/vX.Y.Z.json
```

The release workflow invokes the check-only verifier with these required
bindings:

```sh
node scripts/verify-codex-native-release-attestation.mjs \
  --archive <rebuilt-archive> \
  --attestation docs/releases/attestations/<tag>.json \
  --content-manifest <rebuilt-content-manifest> \
  --evidence-commit <E> \
  --repository-root "$GITHUB_WORKSPACE" \
  --source-commit <C> \
  --tag <tag> \
  --tag-message <annotated-tag-message-file>
```

`C` is the clean source commit that produced the attestation. `E` is its
one-parent direct child containing only the tracked attestation file; the
annotated release tag must point to `E`.

### 3. Contracts

- The JSON schema is version `1` and has only `schema_version`, `scope`,
  `created_at`, `candidate`, `environment`, `triggers`, and
  `attestation_sha256` at the top level. `scope` is exactly
  `same-session delivery only`.
- `candidate` contains exactly `tag`, `version`, `source_commit`,
  `archive_sha256`, and `content_manifest_sha256`; `tag` must equal `v<version>`
  and every digest/commit uses lowercase hexadecimal SHA-256/40-character Git
  formats.
- `environment` contains exactly `node_version`, `codex_cli_version`, and a
  sanitized `provider_tuple`. The supported release tuple is Node `22.23.2`
  and Codex CLI `0.145.0`; the provider tuple must not contain credentials or
  sensitive identifiers.
- `triggers.manual` and `triggers.automatic` each contain only the ordered
  lifecycle `pending`, `confirmed`, `claimed` and the opaque-ID attestation
  digest. Raw reports, prompts, payloads, transcripts, task artifacts, tool
  output, credentials, and session/thread identifiers are forbidden.
- `attestation_sha256` is the SHA-256 of the canonical JSON payload excluding
  the digest field. The tag metadata separately records `raw_sha256`, the hash
  of the exact tracked JSON bytes; neither digest may self-reference the tag
  message.
- The preflight creates a fresh `CODEX_HOME`, installs the archive payload, and
  removes inherited normal-profile/context-mode paths. Operator-supplied local
  authorization may remain in the environment, but normal `CODEX_HOME` data is
  never read or copied. Raw trigger reports and the temporary root are removed
  in success and failure paths.
- CI checks out `E`, rebuilds the archive and content manifest, then compares
  those bytes with the digests attested from `C`. The evidence commit must add
  only the regular direct-child attestation path, and verification must fail
  before release publication on any mismatch.

### 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| Dirty source tree, malformed commit/tag, or output outside the exact attestation path | Preflight fails before provider work and writes no attestation |
| Output ancestry contains a symbolic link | Preflight fails closed |
| Missing, extra, forbidden, stale, or non-canonical attestation field | Verifier rejects the evidence |
| `C`/`E` are not a one-parent direct-child pair or `E` changes any other path | Verifier rejects before archive publication |
| Rebuilt archive or content manifest differs from the attested digest | Verifier rejects before `gh release create` |
| Node/Codex/provider tuple or tag metadata does not match | Verifier rejects the candidate |
| Manual or automatic trigger lacks `pending -> confirmed -> claimed` or opaque-ID evidence | Preflight fails; no semantic recovery claim is allowed |
| Provider authorization is unavailable | Record a blocked local gate; never copy normal profile state or treat it as a pass |

### 5. Good / Base / Bad Cases

- Good: a clean `C` produces the archive and both native trigger results, the
  attestation is the only file in direct-child `E`, the tag metadata matches,
  and CI rebuilds `E` with identical archive/manifest digests.
- Base: static evidence checks pass but the operator has no authorized
  provider; the release remains unclaimed for native delivery until the local
  preflight succeeds.
- Bad: validating the source tree, using the normal `CODEX_HOME`, putting the
  attestation inside the marketplace payload, tagging before the evidence
  commit, or treating a malformed/blocked run as a recovery pass.

### 6. Tests Required

- `tests/scripts/native-release-attestation.test.ts` must assert exact schema
  keys, canonical-vs-raw digest separation, forbidden content, stale evidence,
  every tag/archive/manifest/commit mismatch, environment scrubbing, clean-tree
  rejection, output-path and symlink rejection, and the restore-platform
  initialization regression.
- `tests/scripts/release-workflow-contract.test.ts` must assert that `E` is
  checked out before asset construction, `C` and `E` are both passed to the
  verifier, and evidence verification precedes release creation.
- Existing archive, tag, marketplace-layout, and installed-delivery tests must
  remain green; direct local `tsc --noEmit`, `node --check` for new scripts,
  and `git diff --check` are required before commit.
- Before advertising a supported tuple, an operator must run the real manual
  and host-driven automatic validators in the disposable authorized profile.
  Static CI evidence cannot substitute for that provider-native run.

### 7. Wrong Vs Correct

#### Wrong

```sh
CONTEXT_MODE_RELEASE_PLUGIN_ROOT="$PWD" \
CODEX_HOME="$HOME/.codex" \
node scripts/validate-codex-checkpoint-delivery.mjs
```

This validates source code and normal user state, and it cannot bind the
published archive to an immutable release evidence commit.

#### Correct

```text
C (clean source) -> local disposable preflight -> attestation JSON
  -> E (direct child, attestation only) -> annotated tag -> CI rebuild E
  -> verify C/E, raw/canonical digests, archive, manifest, and tag metadata
  -> publish only after all checks pass
```

The result supports only the claim that the pinned installed artifact passed
manual and automatic same-session delivery checks under the operator-run model.

## Scenario: Compact SessionStart Content-Free Diagnostics

### 1. Scope / Trigger

Use this contract when modifying Codex `SessionStart(source=compact)` recovery
or `ctx_checkpoint_report`. It covers local diagnostics for same-session
checkpoint transport only. It does not create project handoff, task selection,
task-state writes, RecoveryBrief indexing, or a cross-session continuity path.
Trellis remains the sole owner of project-semantic cross-session continuity.

### 2. Signatures

```ts
recordCheckpointSessionStartDiagnostic(
  input: CheckpointHookInput,
  configDir: string,
  result: {
    outcome: "delivered" | "expected_empty" | "failed";
    code:
      | "DELIVERED"
      | "EMPTY_NO_CONFIRMED_CHECKPOINT"
      | "DEPENDENCY_UNAVAILABLE"
      | "CHECKPOINT_DB_UNAVAILABLE"
      | "PAYLOAD_INVALID"
      | "PROJECTION_FAILED";
  },
): boolean;

getCheckpointReliabilityReport(projectDir, configDir, options)
  .diagnostics;
```

The private sidecar is below the configured profile only:

```text
<configDir>/context-mode/checkpoints/
  <project-sha256>--<worktree-sha256>.sessionstart-diagnostics.jsonl
```

### 3. Contracts

- Each compact SessionStart invocation attempts to write one row using only
  `phase`, `outcome`, `code`, `created_at`, `project_sha256`, and
  `worktree_sha256`; `phase` is always `compact_session_start`.
- `DELIVERED` means the hook emitted `additionalContext`. It is not evidence
  that Codex persisted the context or that a model consumed it.
- `EMPTY_NO_CONFIRMED_CHECKPOINT` is expected empty, not a handler failure.
- All other codes are fixed handler-failure classifications. Exception text,
  stacks, prompts, commands, tool inputs/outputs, checkpoint payloads,
  RecoveryBrief content, credentials, and Trellis artifact bodies are forbidden
  in both the sidecar and report.
- The sidecar has mode `0600`, retains only valid project/worktree-matching rows
  within the retention lower bound, and uses an exclusive lock plus atomic
  replacement so concurrent writers retain every completed write.
- Diagnostics are best effort. Lock, filesystem, parsing, DB, or runtime
  errors must preserve valid zero-exit empty hook output.
- A malformed confirmed payload or projection failure transitions the row
  `confirmed -> invalid`; it must not write `claimed_at`,
  `sessionstart_context_emitted`, or a delivery metric.
- The report reads diagnostics before opening the checkpoint DB. Missing or
  unreadable DBs still return content-free diagnostic aggregates and the normal
  DB warning.

### 4. Validation And Error Matrix

| Condition | Required result |
| --- | --- |
| No confirmed checkpoint | Empty context, `expected_empty`, `EMPTY_NO_CONFIRMED_CHECKPOINT` |
| Dependency/runtime cannot load | Empty context with valid hook JSON, fixed `DEPENDENCY_UNAVAILABLE` code when the sidecar helper is available |
| Checkpoint DB cannot open | Empty context, `CHECKPOINT_DB_UNAVAILABLE`; diagnostics remain fail-open |
| Confirmed payload is malformed | `confirmed -> invalid`, `PAYLOAD_INVALID`, no claim transition or delivery metric |
| Projection throws | `confirmed -> invalid`, `PROJECTION_FAILED`, no claim transition or delivery metric |
| DB is absent/unreadable during report | Existing warning plus sidecar aggregates; no raw diagnostic data is returned |
| Simultaneous writers | Each successful write is retained; no torn sidecar and mode remains `0600` |

### 5. Good / Base / Bad Cases

- Good: two compact SessionStart processes finish together and the sidecar
  contains both fixed-code rows, while a scoped report aggregates only the
  matching project/worktree rows.
- Base: no checkpoint DB exists; the hook still returns valid empty JSON and
  the report shows a database warning plus any already-recorded diagnostics.
- Bad: writing an exception string or prompt to the sidecar, treating expected
  empty as failure, or claiming a malformed payload before validating it.

### 6. Tests Required

- `tests/hooks/codex-checkpoint-lifecycle.test.ts` covers dependency failure,
  expected empty, valid empty hook JSON, file permissions, and secret-content
  exclusion.
- `tests/checkpoint/runtime.test.ts` covers absent-DB report aggregation,
  unreadable-DB report aggregation, project/worktree isolation, malformed
  `payload_json` invalidation without claim/delivery telemetry, and concurrent
  sidecar writers retaining both outcomes.
- `tests/checkpoint/server-checkpoint-report.test.ts` covers report handler
  serialization without semantic diagnostic content.
- `tests/core/server-shared-handler.test.ts` covers registered shared-mode
  `ctx_index -> ctx_search` attribution/isolation and direct controlled
  RecoveryBrief rejection. It must not add public session IDs just for tests.

### 7. Wrong Vs Correct

#### Wrong

```ts
const claimed = database.claim(checkpoint.checkpoint_id, now);
const context = fitContext(JSON.parse(claimed.payload_json), claimed);
```

This records a claim before payload validation or projection. A later failure
leaves incompatible lifecycle and delivery evidence.

#### Correct

```ts
const checkpoint = database.getConfirmed(identity, sessionId);
const payload = parseAndValidate(checkpoint.payload_json);
const delivery = fitContextDelivery(payload, checkpoint);
const claimed = database.claim(checkpoint.checkpoint_id, now);
```

On parse or projection failure, invalidate the still-confirmed row with a fixed
reason and return empty context. The diagnostic sidecar records only the fixed
outcome classification.
