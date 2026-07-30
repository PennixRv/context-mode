# Codex v1.0.170 Release And Deployment

Version `1.0.170` adds the Codex confirmed-compaction checkpoint protocol and
ships a self-contained Codex marketplace release asset. The installed Codex
payload has no `node_modules`, does not download packages at startup, and uses
an FTS5-capable `node:sqlite` runtime instead of `better-sqlite3`.

## Prerequisites

- Codex CLI `0.145.0` or the version validated by the target release.
- Node `>=22.22` with `node:sqlite` and FTS5. The plugin fails explicitly when
  that runtime is unavailable; it does not compile or download a native addon.
- Hooks enabled in the Codex profile that will run the plugin:

  ```toml
  [features]
  hooks = true
  ```

Codex asks for normal hook trust when it discovers or changes a plugin hook.
Review the displayed plugin path and hook hashes, then approve them through
Codex's standard hook-trust flow. Do not use a bypass-trust flag for release
validation or normal deployment.

## Online Installation

Install from the immutable release tag, not a moving branch:

```bash
codex plugin marketplace add PennixRv/context-mode --ref v1.0.170
codex plugin add context-mode@context-mode
```

Confirm the plugin is present and start a fresh Codex session so the MCP server
and hooks are discovered:

```bash
codex plugin list
```

The repository marketplace deliberately uses the relative Git source
`url: "./"`. Do not change it to `source: "local", path: "./"`: Codex
rejects that empty local-root source, and the repository's marketplace layout
test guards the behavior.

## Offline Installation

Download these files from the GitHub release:

- `context-mode-codex-marketplace-v1.0.170.tar.gz`
- `context-mode-codex-marketplace-v1.0.170.tar.gz.sha256`
- `CONTENT-MANIFEST.json`

Verify the checksum before unpacking. The `.sha256` file contains one line for
the archive and one for `CONTENT-MANIFEST.json`.

```bash
sha256sum -c context-mode-codex-marketplace-v1.0.170.tar.gz.sha256
mkdir context-mode-offline-v1.0.170
tar -xzf context-mode-codex-marketplace-v1.0.170.tar.gz \
  -C context-mode-offline-v1.0.170
codex plugin marketplace add "$PWD/context-mode-offline-v1.0.170"
codex plugin add context-mode@context-mode-offline
codex plugin list
```

The extracted wrapper intentionally has a different marketplace identity
(`context-mode-offline`) and uses:

```json
{
  "source": {
    "source": "local",
    "path": "./plugins/context-mode"
  }
}
```

Do not install the online and offline routes in the same `CODEX_HOME`. Their
marketplace/plugin identities and cache paths are intentionally distinct, but
running both creates duplicate MCP and hook ownership. Use one route per
profile; use a disposable `CODEX_HOME` when evaluating an archive.

## Update And Rollback

Updates are additive. Install the next immutable tag or next release archive,
approve its changed hooks, confirm `codex plugin list`, and validate one normal
session before removing the old marketplace/plugin entry.

For rollback, retain the prior immutable tag or release archive and install it
in a separate profile first. After the previous version is confirmed healthy,
remove the failed version's marketplace/plugin entry from the target profile.
Do not overwrite the old archive or mutate an existing release tag.

## Release Gates

Maintainers run the reproducible build and isolated offline-install smoke from
the repository root:

```bash
node scripts/run-pnpm.mjs install --frozen-lockfile
node scripts/run-pnpm.mjs run typecheck
node scripts/run-pnpm.mjs run build
node scripts/run-pnpm.mjs test
node scripts/run-pnpm.mjs run build:codex-marketplace
node scripts/run-pnpm.mjs run verify:codex-marketplace -- \
  release/context-mode-codex-marketplace-v1.0.170.tar.gz
```

The release workflow runs only for an annotated `v*` tag whose commit is
reachable from `main`. It requires the tag to match `package.json` exactly and
requires this line in the annotated tag message, where the digest comes from
the freshly built `CONTENT-MANIFEST.json`:

```text
Codex-Content-Manifest-SHA256: <64 lowercase hexadecimal characters>
```

The workflow rebuilds the archive, performs the isolated Codex marketplace
install/MCP boot smoke, compares that digest, and uploads the npm package,
offline marketplace archive, archive checksum file, and content manifest. Its
only write capability is `contents: write` for creating that GitHub release.

## Real Model Attestation

The manual and automatic compaction attestation is intentionally local-only.
It needs a real provider and never runs in GitHub Actions. Start by building
the final archive and installing it into a disposable `CODEX_HOME` using the
offline instructions above. Prepare that profile with only the explicitly
authorized provider configuration and authentication material required by the
chosen local model. Do not copy normal plugins, MCP servers, global hooks,
history, personal preferences, or the normal `~/.codex` directory.

After the isolated profile has the release plugin installed and its hooks have
been reviewed/trusted, run both gates from the repository root. Replace the
paths below with the disposable profile and test repository; the plugin-root
path must be the installed `context-mode-offline` cache payload.

```bash
export CONTEXT_MODE_VALIDATION_HOME=/absolute/path/to/disposable-codex-home
export CONTEXT_MODE_PROJECT_PATH=/absolute/path/to/disposable-project
export CONTEXT_MODE_RELEASE_PLUGIN_ROOT="$CONTEXT_MODE_VALIDATION_HOME/plugins/cache/context-mode-offline/context-mode/1.0.170"

CONTEXT_MODE_CHECKPOINT_TRIGGER=manual \
  node scripts/validate-codex-checkpoint-delivery.mjs

CONTEXT_MODE_CHECKPOINT_TRIGGER=auto \
  node scripts/validate-codex-checkpoint-delivery.mjs
```

The validator refuses the normal `~/.codex`, refuses the source tree, requires
the installed offline cache path, and writes a mode-`0600` report inside the
disposable profile. A passing report confirms native manual/automatic
compaction, completed plugin hooks, the exact confirmed-to-claimed checkpoint
transitions, and that a model returned the opaque checkpoint ID without tools.
It is strong delivery evidence, not a claim about private model reasoning or
durable semantic recall.
