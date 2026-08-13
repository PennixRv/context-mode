# Trellis Check: Issues 009 And 070

Date: 2026-08-13
Baseline: `v1.0.187` / `a60080e82fb57adf77b119cab84bd92408ede1b9`
Branch: `fix/issue-009-070-diagnostics-test-routing`

## Review Findings

- Issue 009 root cause: the previous Codex adapter treated the Plugin-manager
  cache path as the current runtime root, used filesystem observations to infer
  current-session loading, and exposed only boolean Hook status. The new model
  keeps upstream inventory, installed cache, current process root, manifests,
  Hook declarations, and host-session loading independent.
- Issue 070 root cause: PreToolUse had no command-position grammar for common
  test executors, so first and repeated test commands passed through. The new
  lexical classifier recognizes explicit test commands and compound branches;
  it does not route a free-form `test` substring and does not execute or rewrite
  user shell text.
- No issue evidence supports calling this a security sandbox. Permission and
  host execution semantics remain owned by the existing executor and host.

## Validation Completed Before Release

```text
focused issue/adapter/hook matrix: 11 files, 926 passed
focused routing matrix after outcome expansion: 80 passed
typecheck: PASS
Hook syntax check: PASS
git diff --check: PASS
Trellis task validate: PASS
build: PASS
assert-bundle: PASS
assert-asymmetric-drift: PASS
two consecutive full builds: identical bundle SHA-256 values
full test suite: 243 files, 5170 passed, 41 skipped
```

The package has no `lint` or `format:check` script; invoking those names is a
known unavailable baseline gate and did not create a substitute tool or change
the package scripts.

## Release Checks Still Required

- Version-sync all manifests for the next free stable patch.
- Rebuild and verify two deterministic marketplace archives, npm pack output,
  CONTENT-MANIFEST, forwarded Codex MCP environment variables, and offline
  stdio MCP boot.
- Run the existing disposable native Codex release preflight without printing
  credentials, commit only its attestation as the direct child evidence commit,
  create the annotated tag, push `devel` and the tag, and wait for CI/GitHub
  Release asset verification.
- Finish the Trellis task only after the component worktree is clean.

## Root-Owned Acceptance

The root workflow must install the immutable release using its Plugin update
procedure, restart Codex, and validate the real CLI Doctor, MCP `ctx_doctor`,
`codex plugin list --json`, and PreToolUse behavior. This component task does
not modify root Issues, Gitlinks, `/home/penn/.codex`, or other repositories.
