# Codex Marketplace Release v1.0.191

## ROOT-ISSUE-119: Active Trellis RecoveryBrief Boundary

- Trellis RecoveryBrief provider resolution now accepts only ordinary direct
  children of the canonical `.trellis/tasks` directory.
- Archive descendants, nested/non-task paths, direct manifest pointers,
  missing targets, traversal, non-directory targets, and symbolic-link task
  directories fail closed with `TRELLIS_TASK_INVALID`.
- A trusted task manifest must report exactly `planning` or `in_progress`.
  Missing, malformed, unknown, completed, archived, cancelled, and blocked
  states fail with the content-free `TRELLIS_TASK_INACTIVE` diagnostic.
- Provider status, checkpoint Trellis evidence, and CAS updates share one task
  resolver. A present invalid Trellis pointer cannot fall through to a project
  provider or expose a fabricated Brief path/source digest.
- Trellis updates revalidate task activity, provider path, source digest, and
  expected Brief SHA immediately before the atomic write. Rejected updates do
  not create or modify `recovery-brief.json`.

## Compatibility

Legitimate `planning` and `in_progress` tasks retain the existing Brief schema,
canonical digest, source-bound facts, first-write/repeated-CAS behavior, and
canonical project/path aliases. This patch does not change Codex compaction,
create or activate Trellis tasks, install itself into the active Codex profile,
or complete root-side dynamic acceptance.

Root workflow acceptance must install this release through the Hook-aware
Plugin transaction, fully restart Codex, then verify both active-task positive
cases and completed/archive/noncanonical negative cases before closing
ROOT-ISSUE-119.
