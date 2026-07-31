# Codex Checkpoint Quality Evaluation

## Scope

The confirmed-checkpoint lifecycle has five different properties. They must not
be collapsed into one score.

| Property | Evidence | Current implementation |
| --- | --- | --- |
| Lifecycle reliability | `pending -> confirmed -> claimed` | SQLite transitions and `ctx_checkpoint_report` |
| Delivery attestation | The model returns an opaque checkpoint ID without tools | `validate-codex-checkpoint-delivery.mjs` |
| Observable payload recall | The model returns selected facts that actually appear in the final injected projection | `evaluate-codex-checkpoint-quality.mjs` |
| RecoveryBrief semantic recall | The model returns facts from the exact RecoveryBrief projection emitted at recovery | `evaluate-codex-checkpoint-quality.mjs` with `recovery-brief-facts-v1` |
| Task continuation | The model uses recovered facts correctly to complete a task | Future release-candidate corpus |

`claimed` proves that a confirmed checkpoint was emitted for the resumed
session. It does not prove that the model retained or correctly used every
fact. The delivery attestation likewise proves context readability, not task
continuity.

## RecoveryBrief

`CheckpointPayload v1` remains a privacy-minimal lifecycle and audit payload.
It does not contain task semantics. A separately versioned `RecoveryBrief` is
the only semantic source consumed by the checkpoint runtime. A valid active
Trellis pointer is authoritative:

```text
.trellis/tasks/<active-task>/recovery-brief.json
```

The active Trellis task is resolved only through the existing session-specific
runtime pointer:

```text
.trellis/.runtime/sessions/codex_<session-id>.json -> current_task
```

The file must be a materialized regular file beneath that active task; task
pointers outside `.trellis`, symlinks, malformed JSON, oversized files, and
schema failures are rejected. An invalid, stale, or unsafe Trellis pointer
fails closed and never falls back. The runtime never discovers state from
transcripts, tool output, prompts, or Trellis artifact bodies.

When no Trellis runtime pointer exists, a project may explicitly initialize
`.context-mode/recovery-provider.json`; its live Brief is
`.context-mode/recovery-brief.json`. This fallback is never initialized
implicitly. Project `explicit_project_state` facts must match registered source
hashes, and `git` facts must match current Git-status evidence. Later source
drift invalidates only live-provider use; it cannot alter a historical SQLite
snapshot.

Schema version `1` has these exact top-level fields:

```text
schema_version, updated_at, objective, hard_constraints, decisions,
completed_work, open_work, latest_blocker, next_action, project_state
```

Every fact has `value`, `priority`, `source_kind`, `source_sha256`, and
`valid_at`. Source kinds are `trellis_task`, `explicit_project_state`, and
`git`; source hashes are lower-case SHA-256 values. The schema fixes the
priority of semantic groups:

- Critical: `objective`, `hard_constraints`, `latest_blocker`, `next_action`.
- Important: `decisions`, `open_work`, `project_state`.
- Optional: `completed_work`.

`PreCompact` validates and canonicalizes the brief, then stores the JSON and
its SHA-256 in nullable `compact_checkpoints` columns. `PostCompact` only
confirms the already-created row. `SessionStart(compact)` projects only this
stored snapshot; it never rereads the current Trellis file. Thus, a brief
changed after compaction cannot alter the recovered historical state.

An absent or invalid brief is recorded as status metadata but injects no
semantic content. Invalid source text is never stored. Older database rows
receive null recovery columns through the SQLite migration and likewise inject
no brief.

The model-visible form retains a snapshot hash and fact values/priorities but
omits detailed source metadata. This keeps the persisted snapshot auditable
without spending recovery context on source records.

## Projection Budget

The hard additional-context budget remains 1,200 UTF-8 bytes. Pruning is
deterministic and never cuts a fact value mid-string:

1. Remove optional RecoveryBrief facts as complete units.
2. Remove ordinary checkpoint evidence: signals, changed paths, artifact
   listings, and other low-value delivery metadata.
3. Remove important RecoveryBrief facts as complete units.
4. Preserve every critical fact if it fits with checkpoint identity.
5. If critical facts still cannot fit, emit `id_only` with
   `recovery_brief.status = "not_applicable"`; no partial semantic recovery is
   claimed.

The no-RecoveryBrief projection keeps the previous delivery behavior. The
stronger semantic preference applies only when a valid explicit snapshot is
present.

## Runtime Report

`ctx_checkpoint_report` is a local read-only MCP tool. It reports the current
project worktree only, over a one to thirty day window. It aggregates:

- State counts and confirmation/claim rates, globally and by manual or auto
  trigger.
- P50/P95 `created -> confirmed` and `confirmed -> claimed` latency.
- Final projection modes: `full`, `pruned`, and `id_only`.
- Emitted byte totals and averages, old-database compatibility, and overdue
  pending checkpoints.

It does not read or return checkpoint payloads, prompts, tool input or output,
or Trellis artifact contents. The report is delivery reliability telemetry, not
a semantic recovery-quality score.

## Isolated Quality Harness

The release-candidate harness runs only against a prepared disposable
`CODEX_HOME`, a synthetic project, and a materialized installed release
payload. It uses the same constraints as the delivery attestation:

```text
CONTEXT_MODE_VALIDATION_HOME
CONTEXT_MODE_PROJECT_PATH
CONTEXT_MODE_RELEASE_PLUGIN_ROOT
CONTEXT_MODE_CHECKPOINT_TRIGGER=manual|auto
```

Optional quality-specific paths are:

```text
CONTEXT_MODE_CHECKPOINT_QUALITY_FIXTURE_PATH
CONTEXT_MODE_CHECKPOINT_QUALITY_REPORT_PATH
```

The fixture must remain below `scripts/fixtures/checkpoint-quality`; the report
must remain below the disposable validation home. The harness never copies,
reads, or alters the normal `CODEX_HOME`, provider configuration, or
authentication cache.

Run it with:

```sh
pnpm run evaluate:codex-checkpoint-quality
```

The harness first drives a real manual or auto compaction through the Codex App
Server. It waits for the plugin lifecycle, checks the confirmed delivery state
machine, then sends one first-post-compact probe that prohibits tools, files,
and external retrieval. The expected answer is built from the exact final
projection produced by `hooks/checkpoint.bundle.mjs` in the installed release,
not from a hand-maintained copy of the pruning algorithm.

`observable-checkpoint-facts-v1` evaluates only facts that
`CheckpointPayload` can expose: checkpoint identity, trigger,
project/worktree identity, Git evidence, and bounded Trellis metadata. It
requires `"unknown"` for scalar task semantics. This is an intentional
abstention test, not a failed semantic-recovery test.

`recovery-brief-facts-v1` additionally evaluates the exact
`recovery_brief` object that appears in the final installed-release projection.
When no valid snapshot is injected, the expected result for that field is
`"unknown"`; the probe must not infer a substitute from surrounding context.
The harness compares the response to the actual bundle's projection rather
than to a copied pruning implementation.

To exercise that fixture, the disposable validation project must deliberately
contain a valid active Trellis task and its `recovery-brief.json` before the
compaction. The harness does not create, infer, or copy semantic task state.

The harness report is written with mode `0600`. It records the fixture ID and
hash, release/environment fingerprints, checkpoint and response hashes,
projection mode, emitted byte count, JSON validity, no-tool status, and
field-level pass/fail labels. It never stores a raw model response, fixture
body, checkpoint payload, prompt, command, tool output, or Trellis artifact
body.

## Release Policy

CI runs deterministic unit and contract tests for lifecycle behavior, privacy,
fixture validation, pruning, and scoring. The real-host delivery and quality
harnesses are release-candidate or manually triggered gates because they need
an isolated provider-authenticated Codex environment and have model variance.

RecoveryBrief recall is not a continuation benchmark. A later separately
approved release-candidate corpus should compare uncompressed, native compact,
and native compact plus checkpoint conditions. It should report fact recall,
unsupported assertions, critical-fact coverage, task outcomes, byte cost, and
variance as separate measures.
