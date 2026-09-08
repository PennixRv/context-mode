# Retired: Codex Confirmed Checkpoint Experiment

The former `pending -> confirmed -> claimed` compact delivery protocol is
retired in v1.0.192. The package no longer registers
`SessionStart(source=compact)`, emits `additionalContext`, records delivery
metrics, or makes a model-recall claim from local hook execution.

The retained `PreCompact -> pending -> PostCompact -> confirmed` state is a
privacy-bounded local audit. It is not a RecoveryBrief, handoff, or memory
mechanism.
