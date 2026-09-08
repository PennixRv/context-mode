---
name: ctx-checkpoint-report
description: |
  Show local reliability metrics for confirmed Codex compaction checkpoints in the current project worktree.
  Reports lifecycle state counts, confirmation rates, lifecycle latency, RecoveryBrief snapshot availability, and warnings.
  Trigger: /context-mode:ctx-checkpoint-report
user-invocable: true
---

# Checkpoint Reliability Report

## Instructions

1. Call the `mcp__context-mode__ctx_checkpoint_report` MCP tool.
2. Render the complete JSON response without omitting fields.
3. State clearly that this is a local lifecycle-audit report, not a delivery or semantic recovery-quality score.
4. Render the content-free `recoveryBrief` telemetry: snapshot state and provider origin. Treat it as structural availability data only.
5. When `available` is `false` or `warnings` is non-empty, report those conditions before interpreting rates.

## Boundaries

- The report is local and read-only.
- It never returns checkpoint payloads, prompts, tool input, tool output, or Trellis artifact contents.
- Historical `claimed` rows may appear in state counts, but current versions do not create or interpret them as delivery.
