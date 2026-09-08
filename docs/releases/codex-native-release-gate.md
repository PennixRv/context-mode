# Codex Release Gate

The Codex release gate verifies installable artifact integrity, not model-memory
behavior. A release tag points directly to the release commit, is annotated,
matches `package.json`, and contains the existing
`Codex-Content-Manifest-SHA256` value for the rebuilt offline marketplace
payload.

CI installs dependencies, typechecks, builds, rejects generated-bundle drift,
runs tests, rebuilds the npm and Codex assets, verifies the content manifest,
and creates the GitHub release. It does not require a provider, a disposable
profile, a custom hook-trust state, a second evidence commit, or a claim that a
model consumed compaction context.

The Codex compact hooks record only `PreCompact -> pending` and
`PostCompact -> confirmed` local audit state. Trellis task artifacts and the
project workflow remain responsible for semantic continuity and formal handoff.
