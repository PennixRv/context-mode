# Codex Native Release Gate

This gate supports one narrow claim: the final installed context-mode
artifact delivered a same-session checkpoint through Codex native compaction.
It does not prove task-semantic recovery, durable model memory, or any
cross-session handoff. Trellis remains the owner of project-semantic
continuity.

## Operator Preflight

Run the provider-authorized preflight locally from the exact source commit,
before creating the release tag. The command creates a fresh temporary project, `CODEX_HOME`,
offline marketplace installation, and validation state. It never reads or
copies the normal profile's credentials and never uploads provider material.

```bash
node scripts/run-codex-native-release-preflight.mjs \
  --tag vX.Y.Z \
  --provider-tuple codex-0.146.0-local \
  --provider-projection /secure-temporary-path/provider-projection.json \
  --output docs/releases/attestations/vX.Y.Z.json
```

For the supported provider tuple, `--provider-projection` is required. It is a
mode-`0600` JSON file outside the repository and must contain exactly the selected provider and its
non-secret configuration:

```json
{
  "model_provider": "provider-id",
  "provider": {
    "name": "Provider Name",
    "base_url": "https://provider.example.invalid/v1",
    "wire_api": "responses",
    "requires_openai_auth": true
  }
}
```

The preflight rejects normal-profile paths, symbolic links, non-`0600` files,
unknown fields, non-HTTPS URLs, unsupported wire APIs, and unsafe values. It
serializes the validated fields as the only initial
`$CODEX_HOME/config.toml`; it does not import normal hooks, plugins, MCP
servers, project trust, history, or arbitrary configuration. The operator
supplies authorization only as an inherited process environment variable (for
this tuple, `OPENAI_API_KEY`) and never through an auth-file option. Delete the
temporary projection after the run; the preflight removes its generated
disposable profile and all raw validator reports on both success and failure.

The operator must authorize only the disposable profile. The preflight builds
and verifies the marketplace archive, installs that archive as
`context-mode-offline`, runs the existing validator for both `manual` and
host-driven `auto` compaction, requires `pending -> confirmed -> claimed`,
and requires the no-tool opaque checkpoint-ID attestation. Raw validator
reports, provider state, prompts, payloads, task artifacts, and the temporary
profile are removed before the command exits. Only the content-free JSON
attestation remains.

The command prints one sanitized tag metadata line. Commit the generated JSON
as the only added path in a direct child of the source commit, then create the
annotated release tag on that evidence commit. Add the exact metadata line to
the tag message together with the existing
`Codex-Content-Manifest-SHA256` line. The metadata binds the direct-child
tracked evidence path, source commit, archive digest, content-manifest
digest, Node/Codex tuple, and declared provider tuple.

`attestation_sha256` in the JSON is the digest of its canonical payload. The
tag's `raw_sha256` is the SHA-256 of the exact tracked JSON file bytes. These
are intentionally separate so the tag does not self-reference its own file.

## CI Check

The release workflow requires the tagged evidence commit to be a one-parent
direct child of the attested source commit and to add only the expected regular
attestation file. It checks out the tagged evidence commit to rebuild the archive
and content manifest. The attestation records the archive and manifest digests
produced from the source commit, while the release payload allowlists exclude
`docs/releases/attestations`; matching the rebuilt evidence-commit digests
therefore proves the evidence-only commit did not alter the published payload.
The verifier also validates the raw-file and canonical-payload digests, checks
the immutable tag bindings and the pinned
Node `26.5.0` / Codex CLI `0.146.0` tuple, and fails before `gh release
create` on any missing, malformed, stale, or mismatched evidence. CI never
runs the provider-authorized native preflight.
