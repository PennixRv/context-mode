# Retired: Codex Checkpoint Quality Experiment

This document records a retired experiment. Beginning with v1.0.192,
context-mode no longer injects compact checkpoint context, claims checkpoints,
or runs a model-recall quality harness. The retained Codex behavior is a local
`PreCompact -> pending -> PostCompact -> confirmed` audit only.

Use Trellis task artifacts and the project workflow for semantic continuity;
use Codex Remote Compaction v2 for live conversation continuity.
