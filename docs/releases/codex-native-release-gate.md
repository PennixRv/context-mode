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
The package's `engines.node >=22.5.0` remains an API capability prerequisite;
it is not a fixed release or deployment version.

```bash
node scripts/run-codex-native-release-preflight.mjs \
  --tag vX.Y.Z \
  --provider-tuple codex-native-local \
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
supplies authorization only as the preflight process's inherited
`OPENAI_API_KEY`. The preflight derives a fresh one-field
`$CODEX_HOME/auth.json` from that value only after the generated configuration
exists; it is a regular mode-`0600` file and is removed with the disposable
profile. No auth-file option exists, no normal auth file is read or copied, and
Codex child processes do not inherit `OPENAI_API_KEY`. Delete the temporary
projection after the run; the preflight removes its generated disposable
profile and all raw validator reports on both success and failure.

Before native validation, the preflight starts a temporary `app-server` with
`-c features.hooks=true` and calls `hooks/list`. It accepts only untrusted hook
records from the archive-installed `context-mode@context-mode-offline` plugin,
whose source path is the installed `.codex-plugin/hooks.json` and whose
Codex-supplied `currentHash` is a SHA-256 value. It writes those exact returned
hashes into the disposable profile's `hooks.state`; it never calculates,
copies, or reads hook trust from the normal profile. Manual and automatic
validators use the same invocation-scoped hook feature override and the
derived temporary trust state. A normal user installation retains the standard
Codex hook-trust workflow.

The operator must authorize only the disposable profile. The preflight builds
and verifies the marketplace archive, installs that archive as
`context-mode-offline`, runs the existing validator for both `manual` and
host-driven `auto` compaction, requires `pending -> confirmed -> claimed`,
and requires the no-tool opaque checkpoint-ID attestation. Raw validator
reports, provider state, prompts, payloads, task artifacts, and the temporary
profile are removed before the command exits. Only the content-free JSON
attestation remains.

The automatic validator injects 3,000 neutral words against its 2,000-token
test-only compact threshold. This is enough to exercise host-driven automatic
compaction while avoiding an artificial provider-throughput load test; the
gate still requires the same lifecycle and opaque-ID evidence as manual
compaction.

The command prints one sanitized tag metadata line. Commit the generated JSON
as the only added path in a direct child of the source commit, then create the
annotated release tag on that evidence commit. Add the exact metadata line to
the tag message together with the existing
`Codex-Content-Manifest-SHA256` line. The metadata binds the direct-child
tracked evidence path, source commit, archive digest, content-manifest
digest, observed Node/Codex versions, and declared provider tuple.

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

Archive byte reproducibility is stricter than content-manifest parity. The
offline builder writes sorted portable USTAR records with fixed timestamps,
modes, ownership, and a repository-defined gzip stream. It must not inherit
`SOURCE_DATE_EPOCH` or delegate the final deflate bytes to a host zlib version.
Regression coverage builds isolated source copies with different file timestamps
and `SOURCE_DATE_EPOCH` values, then requires equal archive SHA-256 values.
The verifier also validates the raw-file and canonical-payload digests, checks
the immutable tag bindings, requires normalized observed Node/Codex versions,
and requires those versions to match tag metadata. It fails before `gh release
create` on any missing, malformed, stale, or mismatched evidence. CI never
runs the provider-authorized native preflight.
