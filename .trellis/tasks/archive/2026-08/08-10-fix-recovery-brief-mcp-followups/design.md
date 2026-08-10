# Design: RecoveryBrief MCP Follow-Ups And v1.0.183 Release

## 1. Boundaries

This task changes only the `context-mode` component repository. It does not modify the parent repository, any Gitlink, `/home/penn/.codex`, the Governance Plugin, sibling repositories, or the upstream repository.

The current main session is the sole implementer and checker. No Codex native subagent, built-in multi-agent facility, or Trellis channel participates in implementation or review.

The product patch has three independent behavioral changes:

1. make RecoveryBrief v1 discoverable and diagnosable without echoing semantic content;
2. make `briefBytes` consistent without changing canonical digest identity;
3. make the shared indexing test independent of the executor's hidden `TMPDIR` without weakening either security contract.

Release execution is a separate external-state phase after the source patch is complete. The repository can be made release-ready without authorizing a push or publication.

## 2. Shared RecoveryBrief Contract

### 2.1 Contract values

Move the values currently duplicated as runtime-local constants into exported, immutable, typed constants in the checkpoint contract layer:

```ts
RECOVERY_BRIEF_SOURCE_KINDS
RECOVERY_BRIEF_SLOT_PRIORITIES
RECOVERY_BRIEF_LIMITS
```

`RECOVERY_BRIEF_SLOT_PRIORITIES` maps every semantic slot to its only accepted priority. `RECOVERY_BRIEF_LIMITS` owns the 512-byte fact value limit, 16-item list limit, and 12,000-byte persisted Brief limit. Type aliases continue to derive or remain assignable to the exported literal values.

Both the manual runtime validator and the MCP Zod schema consume these constants. This avoids pulling Zod into the checkpoint hook bundle while preventing priority and bound drift.

### 2.2 MCP input schema

Define an exported strict `recoveryBriefV1Schema` in a checkpoint schema module used by `src/server.ts`. It contains:

- literal `schema_version: 1`;
- required `updated_at` timestamp string;
- strict fact objects with `value`, slot-specific `priority`, enumerated `source_kind`, lowercase SHA-256 `source_sha256`, and `valid_at`;
- list maximums of 16;
- nullable `latest_blocker`, `next_action`, and `project_state`;
- no unknown fields at either the Brief or fact level.

JSON Schema cannot express UTF-8 byte length exactly. The public string descriptions state the byte/control-character rules, while the runtime remains authoritative. No top-level Zod `.refine()` is used because the MCP SDK's strict-client schema projection requires an object with a visible `.shape`.

The tool example becomes a complete minimal Brief instead of the currently misleading `{ "schema_version": 1 }` example.

### 2.3 Runtime validation diagnostics

Refactor the parser into a discriminated validation result while preserving a nullable parser wrapper for existing internal callers:

```ts
type RecoveryBriefValidationResult =
  | { ok: true; brief: RecoveryBrief }
  | { ok: false; issue: RecoveryBriefValidationIssue };

interface RecoveryBriefValidationIssue {
  code: RecoveryBriefValidationIssueCode;
  path: string;
  expected: string;
}
```

The diagnostic has no `received`, `value`, body excerpt, source path, or caller input. `path` is assembled only from known field names and bounded list indexes. `expected` is selected from static contract strings. The update result adds optional `validationIssue` only when `errorCode` is `INVALID_RECOVERY_BRIEF`, avoiding response growth on successful and unrelated failures.

Validation returns the first issue in deterministic order:

1. expected container type;
2. missing fields in canonical contract order;
3. unexpected fields in sorted order;
4. field rules in canonical slot/fact order;
5. aggregate persisted-byte limit.

Stable issue codes distinguish object/array shape, missing or unexpected fields, literal/priority mismatch, timestamp, empty/control/oversized value, source kind, SHA-256, list count, and total Brief bytes. The top-level provider code remains `INVALID_RECOVERY_BRIEF` for compatibility.

The MCP transport may reject a structurally malformed payload before the handler through its typed schema; that standard error supplies a field path. The runtime diagnostic remains required for direct callers and constraints such as UTF-8 aggregate size that JSON Schema cannot faithfully express.

## 3. Byte And Digest Semantics

Add `briefFileBytes: number | null` to the internal provider resolution. Populate it from `readRecoveryBriefFile(...).bytes` only for an available, valid Brief. Every absent, malformed, unsafe, or source-drifted resolution retains `null`.

Status maps `briefBytes` from `briefFileBytes`. Update continues to return the bytes of the exact pretty JSON plus final newline it wrote. Tests compare both values with `statSync(path).size`.

The canonical compact JSON remains unchanged:

```text
RecoveryBrief object -> JSON.stringify(brief) -> briefSha256 / CAS / checkpoint snapshot
RecoveryBrief object -> JSON.stringify(brief, null, 2) + newline -> file / briefBytes
```

This explicitly separates content identity from storage representation. No migration is required because existing files are reread and measured directly.

## 4. Host Temporary Directory

Extract the existing executor logic that ignores a POSIX `TMPDIR` override into `src/util/system-temp.ts`. Export a resolved host-temp constant/function and use it in `src/executor.ts`; the executor still creates a per-call `.ctx-mode-*` child directory and still exports that child as subprocess `TMPDIR`.

Use the same host-temp resolver in `tests/core/server-shared-handler.test.ts` for the outer indexable project fixture. This changes only fixture placement. It does not change `ctx_index`, `walkDirectoryDetailed`, hidden-segment detection, Git-ignore enforcement, executor cleanup, or child environment semantics.

A utility regression runs with ambient `TMPDIR` beneath `.ctx-mode-*` and proves the resolved host temp is outside that hidden override on POSIX. The real MCP probe runs the shared-handler suite through `ctx_execute` without manually replacing `TMPDIR` and must pass.

## 5. Compatibility And Security

- Adding optional `validationIssue` is backward-compatible for consumers that use the existing top-level provider error code.
- The full MCP schema may reject malformed calls earlier than v1.0.182. This is intentional and gives callers actionable field paths before any provider lookup or write.
- No diagnostic contains semantic fact values or submitted source material.
- No RecoveryBrief path becomes indexable and no task provenance is written to FTS5.
- Canonical digests remain stable for identical semantic Brief objects.
- `.ctx-mode-*` remains dot-prefixed for Issue #186 and is removed with the existing retrying cleanup path.
- The patch does not increase compatibility execution authority or alter restricted execution.

## 6. Release Shape

The next patch version is `1.0.183`. The release line is the fork's `devel`, currently `origin/devel@5149649888fb4be3be7dc3a6a7c4d4a74c2c9ab8`. The task branch and refreshed release line have no changed-path overlap, so preserve existing commit identities by merging `origin/devel` into the task branch instead of rebasing delivered commits.

The final source tree includes:

- product source, tests, docs/spec updates, and tracked bundles;
- archived task evidence/result;
- synchronized `1.0.183` manifests;
- no release attestation yet.

If publication is authorized, fast-forward local `devel` to the clean source commit and run the provider-authorized native preflight from exactly that commit. The preflight uses only a disposable profile, a mode-`0600` provider projection outside the repository, and inherited authorization. It must not inspect or copy `/home/penn/.codex`.

The preflight creates `docs/releases/attestations/v1.0.183.json`. Commit that file alone as the direct evidence child, create an annotated `v1.0.183` tag carrying the content-manifest and attestation metadata, push `devel` and the tag, and wait for the GitHub Release workflow. The workflow publishes GitHub assets; it does not and must not publish `context-mode@1.0.183` to the npm registry.

## 7. Rollback

- Before external publication, rollback is normal Git history correction on the task branch; do not rewrite already delivered pre-task commits.
- After pushing `devel` but before a tag, fix forward with a new reviewed commit and rerun the preflight from the new source commit.
- After pushing the annotated tag, do not move or replace it. A failed workflow is repaired with a new patch version and new attestation/tag.
- Never delete or recreate a published GitHub Release/tag to hide failed evidence.
