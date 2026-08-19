# Issue 119 Evidence

## Conclusion

ROOT-ISSUE-119 is reproducible in context-mode v1.0.190 and is owned by the
component runtime. The defect is not a caller-only Skill problem: the provider
itself accepts an inactive task and the public update function writes to it.

## Fixed Inputs

- Root handoff: `context-mode-issue-119-component-handoff-prompt.md`
- Root Issue: `119-context-mode-recovery-brief-accepts-non-active-trellis-task.md`
- Root audit: `context-mode-fork-audit.md`
- Reviewed release: `v1.0.190`
- Reviewed release commit: `547851d4109396b4729e83723b815265a9599128`
- Task baseline after install-stat updates:
  `384cb779574812d4aea7883d5b2d20cdc5918e8a`

The root repository owns these source documents. This component task records
the bounded facts needed for implementation and does not modify the originals.

## Source Findings

- `src/checkpoint/runtime.ts:346`: `safeTaskPath` accepts any path whose
  canonical target remains under `.trellis`; it does not require a direct child
  of `.trellis/tasks`.
- `src/checkpoint/runtime.ts:443`: `readTrellisEvidence` uses the same broad
  helper and labels any parseable manifest as active.
- `src/checkpoint/runtime.ts:960`: `trellisProviderResolution` reads the runtime
  pointer and task manifest but never checks `task.json.status`.
- `src/checkpoint/runtime.ts:1040`: every parseable task reaches
  `health=available`, `task=active`, and `errorCode=NONE` unless its Brief is
  independently malformed or stale.
- `src/checkpoint/runtime.ts:1340`: `updateRecoveryBriefProvider` consumes that
  resolution, then reaches the existing atomic write path.
- `tests/checkpoint/recovery-brief-provider.test.ts:103`: the active task helper
  omits `status`, so existing tests encode the defective behavior as a valid
  fixture.

## Isolated Reproduction

The fixture created a temporary project containing:

```text
.trellis/.runtime/sessions/codex_issue-119.json
.trellis/tasks/task-1/task.json  # status=completed, phase=done
```

Observed content-free result before cleanup:

```json
{
  "before": {
    "provider": "trellis",
    "health": "available",
    "task": "active",
    "errorCode": "NONE",
    "hasSourceSha": true
  },
  "update": {
    "ok": true,
    "provider": "trellis",
    "errorCode": "NONE"
  },
  "recoveryBriefCreated": true
}
```

The fixture was removed immediately. No real task, RecoveryBrief, checkpoint
database, profile, credential, cache, or session body was read or modified.

## Existing Protection To Preserve

- A present but malformed Trellis runtime already returns a Trellis failure and
  prevents project-provider fallback.
- RecoveryBrief input validation is bounded and content-free.
- Active-task writes use expected-SHA CAS, source-bound facts, bounded
  serialization, and atomic rename.
- Explicit project providers are selected only when a Trellis runtime pointer
  is absent.

## Required New Evidence

Implementation evidence must show both public provider entry points reject all
noncanonical and inactive cases, active status CAS remains valid, existing
Brief bytes remain unchanged after rejection, checkpoint/evidence surfaces do
not claim invalid tasks are active, and the published bundle contains the same
runtime behavior as the tested source.
