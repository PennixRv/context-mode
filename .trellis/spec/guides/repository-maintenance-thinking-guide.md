# Repository Maintenance Thinking Guide

Use this guide before changing fork branches, default-branch settings, release
refs, or workflows that can write repository contents.

## Fork Branch Model

For this fork, keep two managed branches:

- `main` is an exact mirror of the designated `upstream/main`. Do not add
  fork-specific code, Trellis assets, or automation-generated commits there.
- `devel` carries fork development history, shared Trellis assets, and approved
  cross-session task handoffs. It is the public fork's default branch.

Track a Trellis task only when it is an approved implementation or acceptance
handoff that must travel with a task branch. Personal workspace journals,
developer identity, runtime state, generated backups, and ad hoc local tasks
remain local-only. Follow
[`../backend/trellis-task-delivery.md`](../backend/trellis-task-delivery.md) for
the exact path and validation contract.

Fork-specific installations must explicitly select `devel` or a fork release
tag. Installing from `main` intentionally selects the upstream mirror.

## Fork Release Ref Contract

When `main` is an upstream mirror and `devel` carries fork releases, a release
workflow must validate a tag against `devel` or one explicitly configured fork
release ref. It must not use `origin/main` merely because it is the conventional
default branch name.

- Fetch the annotated tag and the selected release ref in the release job.
- Require `git merge-base --is-ancestor <tag-commit> <release-ref>` before
  packaging.
- Require the tag version to equal the package version, as before.
- Fail the job if the release ref is absent, the tag is not annotated, or the
  tag is unreachable from the selected release ref.

Good: `vX.Y.Z` points to a commit reachable from `origin/devel`, while `main`
continues to equal `upstream/main`.

Bad: a workflow requires the same tag to be an ancestor of `origin/main`; this
makes a valid `devel` release impossible unless fork commits are copied into the
upstream mirror.

Before changing a release workflow, dry-run its ancestry check with one existing
fork tag and one deliberately invalid tag/ref pair. Confirm the success case
does not move `main` and the failure case stops before packaging or publishing.

## Before Changing Branch Topology

- [ ] Record the local, `origin`, and `upstream` branch heads.
- [ ] Verify the current GitHub default branch, open pull requests, and branch
      protections.
- [ ] Inspect workflows with `contents: write` and identify which branch their
      scheduled or default-branch runs can update.
- [ ] Verify the target upstream ref immediately before any ref rewrite.
- [ ] Confirm that the active installed plugin or marketplace checkout is not
      a worktree that the operation would alter.

## Safe Transition Order

When restoring `main` as an upstream mirror while a write-capable scheduled
workflow exists:

1. Publish and verify `devel` first.
2. Set the fork's default branch to `devel` and verify the setting through the
   hosting API.
3. Confirm that no queued or in-progress scheduled workflow still targets
   `main`.
4. Restore `origin/main` only with `--force-with-lease` using the just-verified
   remote tip. If the lease fails, stop and investigate rather than using an
   unconditional force push.
5. Fetch the remote, set its symbolic `HEAD`, and verify that local `main`,
   `origin/main`, and `upstream/main` have zero divergence.

## Trellis Channel Capacity Recovery

When a named Trellis channel worker reports a transient provider-capacity
failure such as `Selected model is at capacity`, continue the same worker
directly before replacing it.

1. Preserve the worker's channel, app-server process, thread, event log, and
   any task-local report it already wrote.
2. Send a concise continuation instruction to the **same** worker through the
   existing channel. Tell it to use evidence already gathered, avoid restarting
   broad discovery, and finish its assigned task-local report.
3. Do not kill, respawn, rename, or duplicate the worker solely because of the
   first capacity error. Those actions discard useful thread-local evidence and
   create duplicate research ownership.
4. Inspect the raw event log and report path after the continuation. Escalate
   only if direct continuation also cannot make progress, and record the
   provider failure separately from product behavior.

Good: `trellis channel send <channel> --as main --to <same-worker> \
--text-file <continuation-brief> --delivery-mode requireRunningWorker`.

Bad: kill the worker and spawn a fresh replacement immediately, then repeat
the entire investigation without its collected evidence.

## Final Verification

- [ ] Only `main` and `devel` are fork-managed local and `origin` branches.
- [ ] The fork default branch and `origin/HEAD` both point to `devel`.
- [ ] `main`, `origin/main`, and `upstream/main` resolve to the same commit.
- [ ] `devel` contains fork history, shared assets, and only explicitly approved
      task handoffs; it contains no workspace, identity, runtime, or backup paths.
- [ ] The scheduled automation is active on its intended default branch and
      does not have an active run that can write `main`.
