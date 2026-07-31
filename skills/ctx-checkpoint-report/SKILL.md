---
name: ctx-checkpoint-report
description: |
  Show local reliability metrics for confirmed Codex compaction checkpoints in the current project worktree.
  Reports lifecycle state counts, confirmation and claim rates, latency, payload projection modes, and warnings.
  Trigger: /context-mode:ctx-checkpoint-report
user-invocable: true
---

# Checkpoint Reliability Report

## Instructions

1. Call the `mcp__context-mode__ctx_checkpoint_report` MCP tool.
2. Render the complete JSON response without omitting fields.
3. State clearly that this is a delivery-reliability report, not a semantic recovery-quality score.
4. When `available` is `false` or `warnings` is non-empty, report those conditions before interpreting rates.

## Boundaries

- The report is local and read-only.
- It never returns checkpoint payloads, prompts, tool input, tool output, or Trellis artifact contents.
- `claimed` proves confirmed context delivery. It does not prove that the model retained or correctly used every recovered fact.
