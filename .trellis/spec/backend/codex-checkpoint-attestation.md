# Codex Compact Audit Release Boundary

## Scope

Codex Remote Compaction v2 owns live conversation continuity. context-mode's
Codex hooks record only a local, content-free compact audit:

```text
PreCompact(manual|auto) -> pending
PostCompact(manual|auto) -> confirmed
```

There is no `SessionStart(compact)` registration, `additionalContext` delivery,
claim transition, delivery telemetry, or provider-authorized compaction gate.
Do not describe this audit as evidence of model memory or task recovery.

## Release Contract

The release tag points directly at the release commit. It must be annotated,
match `package.json`, and contain exactly one existing
`Codex-Content-Manifest-SHA256` line. CI rebuilds the offline marketplace
archive, verifies its content manifest against that tag line, runs typecheck
and tests, then publishes the assets.

No extra evidence commit, runtime provider, copied profile state, hook-trust
mutation, or custom attestation artifact is part of the release procedure.

## Required Checks

- `tests/checkpoint/runtime.test.ts` covers pending/confirmed audit state and
  historical read-only compatibility for old `claimed` rows.
- `tests/hooks/codex-checkpoint-lifecycle.test.ts` proves the packaged manifest
  has only `PreCompact` and `PostCompact` for this audit and that the legacy
  generic handler is inert for compact input.
- Archive tests prove retired delivery-only files are absent from the payload.

## Boundaries

`ctx_checkpoint_report` may aggregate local state counts, confirmation latency,
and RecoveryBrief snapshot status without exposing checkpoint payloads. It does
not provide a continuation protocol. RecoveryBrief writes are controlled by the
project's Trellis workflow and use the low-level provider only at its semantic
gates; compact hooks and ordinary resumes never create that authority.
