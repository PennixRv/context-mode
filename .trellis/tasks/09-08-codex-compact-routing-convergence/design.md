# Design: audit without compact delivery

## Boundary

Codex Remote Compaction v2 owns continuity within a live session. The smallest
gap is the installed context-mode compact hook that still claims a confirmed
checkpoint and returns it as `additionalContext`. The fix belongs at that
delivery path, rather than at every caller or in a new coordinator.

## Change Shape

1. Remove the compact `SessionStart` registration and its dedicated hook.
2. Delete the claim/delivery-only runtime, diagnostics, metrics, report fields,
   fixtures, and tests after checking their callers.
3. Leave pending/confirmed checkpoints, PreCompact/PostCompact, and the
   RecoveryBrief provider intact. Old `claimed` records remain tolerated as
   historical data.
4. Correct routing instructions so component protocol calls remain direct and
   context aggregation is limited to unbounded local text or explicit direct
   HTTP/API response inspection.

## Explicit Non-Goals

- No schema migration or database cleanup.
- No compact summary injection, automatic resume search, recovery coordinator,
  new Hook, routing matcher, or web-search fallback.
- No merge or rebase of upstream changes unless a release preflight reveals a
  concrete required defect.

## Validation

Focused hook/runtime/provider/routing tests establish the deletion boundary.
Existing project typecheck, test, build, marketplace assertion, and release
preflight establish packaging integrity. A host probe may only demonstrate the
installed hook wiring; it is not evidence of model behavior.
