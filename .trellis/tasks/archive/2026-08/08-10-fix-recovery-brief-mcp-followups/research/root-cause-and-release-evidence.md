# Root-Cause And Release Evidence

## Scope

This note records the evidence gathered during planning. It does not authorize product implementation, remote writes, or release publication.

## Finding 1: RecoveryBrief validation is opaque

- `src/server.ts` registers `ctx_recovery_brief_update` with `brief: z.unknown()` and an example containing only `schema_version`. The MCP schema therefore does not expose the required v1 fields or slot priorities.
- `src/checkpoint/runtime.ts` enforces exact top-level and fact keys, ISO timestamps, 512-byte fact values, 16-item lists, source kinds, lowercase SHA-256 values, and these hard-coded priorities:
  - `objective`, `hard_constraints`, `latest_blocker`, `next_action`: `critical`
  - `decisions`, `open_work`, `project_state`: `important`
  - `completed_work`: `optional`
- `parseRecoveryBriefFact`, `parseRecoveryBriefFactList`, and `parseRecoveryBrief` return only parsed data or `null`/`undefined`. `updateRecoveryBriefProvider` maps every structural failure to `INVALID_RECOVERY_BRIEF` with no field or rule diagnostic.
- The existing v1 reference documents the priorities in prose, but no shared runtime/schema descriptor prevents drift.

Root cause: the authoritative parser discards validation location and reason, while the public MCP schema intentionally accepts an untyped value. The caller cannot construct or repair the wire shape from the tool contract.

Required direction: introduce shared typed field priorities/bounds, preserve runtime authority, and return one deterministic content-free validation issue (`path`, stable rule code, bounded expected contract) while never including the rejected value.

## Finding 2: `briefBytes` has two meanings

- `readRecoveryBriefFile` already obtains the persisted file size with `statSync(resolvedPath).size`.
- `updateRecoveryBriefProvider` writes pretty JSON plus a final newline and returns the byte length of that serialized file.
- `recoveryBriefProviderStatusFromResolution` ignores the persisted byte count and instead returns the byte length of compact canonical `snapshot.recoveryJson`.
- `briefSha256` intentionally hashes the compact canonical JSON and should remain format-insensitive for compare-and-swap identity.

Root cause: provider resolution drops the file-byte observation before constructing status, so status falls back to canonical JSON bytes while update reports persisted bytes.

Required direction: carry persisted file bytes through provider resolution and define `briefBytes` as file bytes on both surfaces. Keep canonical JSON only for digest/CAS and checkpoint snapshotting.

## Finding 3: hidden executor TMPDIR invalidates one indexing fixture

Reproduction through the installed `ctx_execute`:

```text
TMPDIR=/tmp/.ctx-mode-xaxezI
tests/core/server-shared-handler.test.ts:184
expected "Indexed 1 file"; received "Indexed 0 files"
```

The same targeted suite passes when its Vitest process uses `TMPDIR=/tmp`.

- Compatibility execution deliberately creates `.ctx-mode-*` and exports it as child `TMPDIR`.
- `tests/core/cli.test.ts` locks the dot prefix for upstream Issue #186 so VS Code does not auto-open temporary scripts.
- `src/store-directory.ts` intentionally rejects any source path containing a dot-prefixed segment. This protects direct and directory indexing against hidden state and is independent of caller filters.
- `tests/core/server-shared-handler.test.ts` builds its indexable project fixture with `mkdtempSync(join(tmpdir(), ...))`. Under `ctx_execute`, Node resolves `tmpdir()` from the hidden sandbox `TMPDIR`, placing the whole fixture beneath a forbidden hidden ancestor.

Root cause: the test fixture assumes ambient `TMPDIR` is an indexable host path. The executor and indexer each satisfy their own security contract; the fixture combines them incompatibly.

Rejected fixes:

- Renaming `.ctx-mode-*` would regress Issue #186.
- Allowing an explicitly selected descendant of a hidden ancestor would bypass hidden-path isolation.
- Setting compatibility subprocess `TMPDIR` to global `/tmp` would weaken per-call cleanup/isolation and alter runtime semantics for every caller.

Required direction: factor the executor's existing host-temp resolution into a small shared utility and use that utility only for test fixtures that require an indexable root. Add a regression with ambient `TMPDIR` under `.ctx-mode-*` and retain the existing hidden-path tests.

## Release Evidence

- Local package and synchronized manifests are at `1.0.182`; local latest annotated tag is `v1.0.182`.
- GitHub API observation on 2026-08-10:
  - latest fork release: `v1.0.182`, target `devel`, published 2026-08-04
  - current fork `devel`: `5149649888fb4be3be7dc3a6a7c4d4a74c2c9ab8`
  - upstream `mksglu/context-mode` latest release: `v1.0.169`
  - npm registry `context-mode` latest: `1.0.169`
- After `git fetch origin devel`, the task branch and `origin/devel` share merge base `a165593077add6004ea4e0131560729c2b9761dc` and are respectively four and three commits ahead. The three remote commits modify only `stats.json`; there is no changed-path overlap.
- `.github/workflows/release.yml` accepts an existing annotated `v*` tag, fetches `origin/devel`, requires the tag to be reachable from that branch, rebuilds and verifies all assets, verifies the immutable native attestation, and then creates a GitHub Release.
- The workflow does not run `npm publish`. Its npm-shaped `.tgz` is a GitHub Release asset only.
- The release evidence commit must be a direct child of the clean source commit and add only `docs/releases/attestations/v1.0.183.json`. The annotated tag message must bind both the content-manifest digest and the native-delivery attestation metadata.
- The provider-authorized preflight must use a disposable profile and a mode-`0600` provider projection outside the repository. It must not read or copy `/home/penn/.codex`.

## Planning Consequence

The next patch version is `1.0.183`. The safe integration path preserves existing task commit identities, merges the refreshed `origin/devel` state into the task branch after implementation, validates the resulting source commit, then fast-forwards the local/release `devel` line only when external release execution is explicitly approved.

## Post-Implementation Break-Loop Analysis

### Root-Cause Categories

- Findings 1 and 2 are **B: Cross-Layer Contract** plus **C: Change
  Propagation Failure**. Runtime, MCP schema, response types, persisted file
  representation, documentation, and tests described the same Brief with
  duplicated or missing contract data.
- Finding 3 is **E: Implicit Assumption** plus **D: Test Coverage Gap**. The
  indexing fixture assumed ambient `os.tmpdir()` was a visible host path even
  when its test process was itself running under an executor-owned hidden
  `TMPDIR`.
- The quality-gate cleanup failure was **D: Test Coverage Gap**. Scanning every
  `.ctx-mode-*` directory under shared `/tmp` conflated an unrelated concurrent
  sandbox with the directory owned by the test.

### Discriminating Evidence And Rejected Surface Fixes

- Running the shared-handler test through `ctx_execute` failed with one indexed
  file reported as zero; the same test with an outer `/tmp` fixture passed.
  This isolated fixture ancestry from indexer content or source filters.
- Renaming `.ctx-mode-*`, overriding all child temp behavior, or weakening
  hidden-path checks would fix the symptom by breaking established security or
  Issue #186 behavior, so all were rejected.
- The cleanup test passed alone and failed only in a larger parallel set while
  reporting another randomly named directory. Capturing and checking the
  child-reported `TMPDIR` distinguishes actual cleanup failure from concurrent
  activity.

### Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Shared typed RecoveryBrief constants and schema; runtime remains authoritative | Done |
| P0 | Runtime secrecy | Stable first-issue diagnostics contain only fixed code/path/expectation | Done |
| P0 | Test coverage | Real MCP hidden-`TMPDIR` probe and exact child-directory cleanup assertion | Done |
| P1 | Documentation | RecoveryBrief byte/digest and host-temp fixture contracts added to backend specs | Done |
| P1 | Review | Generated MCP `tools/list` shape is inspected by an in-memory client test | Done |

### Systematic Expansion

- Any test that calls `os.tmpdir()` inside an execution sandbox must classify
  whether it needs child-private temporary storage or a host-visible/indexable
  fixture before choosing a path.
- Any cleanup assertion over a shared system directory must identify resources
  owned by that test; global before/after scans are invalid under parallel test
  execution.
- Any bounded wire schema with runtime-only byte rules must document the JSON
  Schema approximation and retain direct runtime regression coverage.
