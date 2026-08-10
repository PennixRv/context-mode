# Design: Codex Presentation Environment Forwarding

## Boundary And Data Flow

```text
parent Codex process environment
  -> .codex-plugin/mcp.json env_vars allowlist
  -> Codex stdio launcher copies only named parent values
  -> context-mode MCP process.env
  -> existing createPresentationPolicy(process.env)
  -> bounded ctx_execute / ctx_execute_file / ctx_batch_execute responses
```

`env` and `env_vars` have distinct responsibilities. `env` continues to pin the
trusted platform identity:

```json
"env": {
  "CONTEXT_MODE_PLATFORM": "codex"
}
```

`env_vars` contains names only and requests conditional inheritance from the
parent process:

```json
"env_vars": [
  "CONTEXT_MODE_CODE_ECHO_MAX",
  "CONTEXT_MODE_COMMAND_ECHO_MAX",
  "CONTEXT_MODE_TITLE_PREVIEW_MAX",
  "CONTEXT_MODE_SEARCHABLE_TERMS_MAX",
  "CONTEXT_MODE_RESULT_PREVIEW_MAX"
]
```

No new runtime parser or default source is introduced. Missing values remain
missing, so `src/presentation-policy.ts` remains the single authority for
defaults, ranges, zero semantics, Unicode truncation, and audit metadata.

## Source And Delivery Contract

The source manifest is the only authored forwarding source. The existing
marketplace builder copies it into `plugins/context-mode/.codex-plugin/mcp.json`
and writes its hash and size into `CONTENT-MANIFEST.json`. Tests and the release
verifier compare against one shared expected name list to prevent drift without
duplicating policy values.

Offline verification extends the existing real Codex installation flow:

1. Validate every content-manifest entry.
2. Install the local marketplace into a disposable `CODEX_HOME`.
3. Read the installed plugin manifest and compare its `env_vars` with source.
4. Read normalized `codex mcp list --json` and compare its stdio transport
   `env_vars` and fixed platform environment.
5. Start the installed MCP and complete `initialize` without creating
   `node_modules`.

The normal user profile and installed `1.0.184` cache remain read-only.

## Real Stdio Probe

A focused integration test reads the source manifest and launches its real
`node ./start.mjs` process from the repository root. The test materializes the
same two Codex manifest rules: fixed `env` is always applied, while each name in
`env_vars` is copied only when present in the synthetic parent environment.

The test performs MCP `initialize`, sends `notifications/initialized`, and
calls `ctx_execute` with a deterministic 365-character JavaScript source. It
asserts the response presentation metadata, fenced source ordering, output,
and complete return size. The configured case also prints only the five
non-sensitive fixture variables from inside the executed subprocess to prove
end-to-end inheritance.

This is a real stdio MCP process and real tool execution; it does not require a
provider credential or mutate Codex profile state.

## Security And Compatibility

- The allowlist is exact and contains only numeric presentation knobs.
- Credentials, wildcard inheritance, dynamic names, and values in `env` are
  rejected by tests.
- `CONTEXT_MODE_PLATFORM=codex` remains fixed even if a parent attempts another
  value.
- Existing server clamping prevents environment values from expanding beyond
  documented presentation maxima.
- The change grants no filesystem, persistence, network, process, or execution
  authority and does not alter restricted mode.
- Other platform manifests are not edited. Release version synchronization may
  change their version fields only, according to the existing release contract.

## Release Design

The release uses the established two-commit evidence topology:

```text
source commit (implementation + tests + docs + task + version)
  -> evidence commit (adds only docs/releases/attestations/v1.0.185.json)
  -> annotated v1.0.185 tag
  -> GitHub Release workflow
```

Immediately before versioning and tagging, check both local and remote tag
availability. The native preflight uses a disposable private provider
projection and inherited authorization without modifying normal Codex state.
The tag message binds source commit, attestation hashes, archive hash, content
manifest hash, Node version, Codex CLI version, and provider tuple.

## Trade-Offs

- A manifest name allowlist is preferred over copying values into `env`: it
  preserves user configuration without hardcoding policy or leaking absence as
  a fake value.
- The five names remain explicit rather than generated from a broad prefix:
  repetition is small and is the security boundary.
- Runtime defaults stay in `presentation-policy.ts`; mirroring them in the
  manifest would create drift and turn absence into an override.

## Rollback Design

Before publication, revert the scoped commits and regenerate any unpushed
evidence. After publication, never move the tag or replace assets; issue a new
patch. Removing the five names from a future manifest restores current default
behavior without changing server code, but is not an acceptable workaround for
this task.
