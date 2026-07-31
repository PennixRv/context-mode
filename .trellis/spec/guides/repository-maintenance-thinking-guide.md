# Repository Maintenance Thinking Guide

Use this guide before changing fork branches, default-branch settings, release
refs, or workflows that can write repository contents.

## Fork Branch Model

For this fork, keep two managed branches:

- `main` is an exact mirror of the designated `upstream/main`. Do not add
  fork-specific code, Trellis assets, or automation-generated commits there.
- `devel` carries fork development history and shared Trellis assets. It is the
  public fork's default branch.

Treat raw Trellis task records, personal workspace journals, developer
identity, and runtime state as local-only. They must stay ignored and never be
published with `devel`.

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

## Final Verification

- [ ] Only `main` and `devel` are fork-managed local and `origin` branches.
- [ ] The fork default branch and `origin/HEAD` both point to `devel`.
- [ ] `main`, `origin/main`, and `upstream/main` resolve to the same commit.
- [ ] `devel` contains fork history and shared assets, but no local Trellis
      task, workspace, identity, or runtime paths.
- [ ] The scheduled automation is active on its intended default branch and
      does not have an active run that can write `main`.
