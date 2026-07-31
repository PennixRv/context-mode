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
