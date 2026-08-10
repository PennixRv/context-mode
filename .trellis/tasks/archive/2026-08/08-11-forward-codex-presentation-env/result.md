# Result: Codex Presentation Environment Forwarding And v1.0.185

Date: 2026-08-11

## Identity

- Root issues: `ROOT-ISSUE-054`, `ROOT-ISSUE-041`
- Baseline: `f13ee081296c3bc96404c551cdeecbb110c8643c`
- Implementation branch: `fix/issue-054-codex-plugin-env-forwarding`
- Implementation commit: `d1918cc9a7758d9327b04b0b934e9e34641e6d34`
- Version commit: `51ea11f8`
- Release source commit: `e84de520b7a5eeeec2b1784e4efde45936b280ce`
- Native attestation evidence commit: `1b784333cae7c30a9100fb314b2140929450b9e7`
- Annotated tag object: `9a0dc5e52f3e591e2fda090f9bb1d153bf6e00ab`
- Peeled tag commit: `1b784333cae7c30a9100fb314b2140929450b9e7`
- Release version: `1.0.185`
- Release completion: published and independently verified

## Delivered

The Codex Plugin manifest now forwards exactly these parent environment names
to its stdio MCP process while retaining fixed
`CONTEXT_MODE_PLATFORM=codex`:

```text
CONTEXT_MODE_CODE_ECHO_MAX
CONTEXT_MODE_COMMAND_ECHO_MAX
CONTEXT_MODE_TITLE_PREVIEW_MAX
CONTEXT_MODE_SEARCHABLE_TERMS_MAX
CONTEXT_MODE_RESULT_PREVIEW_MAX
```

The manifest contains names only. It does not hard-code budgets, inherit a
prefix or wildcard, or forward `WINDSURF_API_KEY` or another credential.
Absent parent values continue to use server defaults `240/160/96/20/1200`.

Exact parity checks now cover the source manifest, generated marketplace
payload, `CONTENT-MANIFEST.json`, offline installed manifest, and normalized
`codex mcp list --json` transport. A manifest-driven real stdio test proves
both absent/default and configured `64/64/16/0/160` behavior.

## Changed Files

Implementation and delivery contract:

- `.codex-plugin/mcp.json`
- `scripts/verify-codex-release-asset.mjs`
- `README.md`
- `.trellis/spec/backend/restricted-execution-and-presentation.md`

Tests:

- `tests/plugins/codex-manifest.test.ts`
- `tests/plugins/codex-presentation-env-forwarding.test.ts`
- `tests/scripts/codex-release-asset.test.ts`
- `tests/core/echo-commands.test.ts`

Release metadata:

- `package.json`
- `.claude-plugin/marketplace.json`
- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `.openclaw-plugin/openclaw.plugin.json`
- `.openclaw-plugin/package.json`
- `.pi/extensions/context-mode/package.json`
- `configs/antigravity-cli/plugin.json`
- `configs/copilot-cli/.github/plugin/plugin.json`
- `openclaw.plugin.json`

Task evidence is under `.trellis/tasks/08-11-forward-codex-presentation-env/`
until archival.

## Verification

```text
Focused regression matrix
  PASS; 8 files, 63 tests

Version lockstep matrix
  PASS; 3 files, 43 tests

npx --yes pnpm@10.23.0 run typecheck
  PASS at 1.0.185

npx --yes pnpm@10.23.0 run build
  PASS at 1.0.185; nine bundle assertions and asymmetric drift

npx --yes pnpm@10.23.0 test -- --reporter=basic
  PASS at 1.0.185; 233 files, 4,983 passed, 41 skipped

Marketplace build and offline verifier
  PASS; 124 content entries, exact env_vars, offline install,
  normalized MCP transport, and initialize probe

Consecutive marketplace builds
  PASS; 2,744,548 bytes, byte-identical
  archive SHA-256:
  43e5753cef82077f51bf422dd9d7061c3da498d1b00207468ed1e85099b9a675
  CONTENT-MANIFEST SHA-256:
  7728c44d1ef0b0aeb9a135274e7181d6a3448c0379fd9ca8c9dc84a60f30a0c9

Consecutive generated bundles
  PASS
  server.bundle.mjs:
  a7c4c284b57865c7383ed02275b1ccc6d8a2ff93eb672c97efe99d4ca71be4a4
  cli.bundle.mjs:
  a249c13c6541cd9b882b2136f24f97e8d9e9b970482866fe54e287f2f2c0a8c6

git diff --check and Trellis task validation
  PASS
```

The repository has no independent lint script. Hidden-path-sensitive full tests
were run from the real repository path because `ctx_execute` intentionally
uses a hidden `.ctx-mode-*` temporary root; no product security check was
relaxed to accommodate the harness.

## Response Measurements

For a deterministic 365-character JavaScript source:

| Parent values | Source preview | Omitted | Complete MCP return |
| --- | ---: | ---: | ---: |
| all five absent | 240 characters | 125 characters | 481 characters, 7 lines |
| `64/64/16/0/160` | 64 characters | 301 characters | 289 characters, 7 lines |

Both responses retain language, original length, preview length, omitted
length, truncation state, and a stable digest. These measurements cover
context-mode MCP return content only; the Codex host-owned `Called` argument
display is unchanged and outside this repository's control.

## Issue Conclusions

`ROOT-ISSUE-054` is fixed in source and tested delivery artifacts: the Codex
Plugin now forwards the exact non-sensitive presentation allowlist instead of
starting the MCP with all five values unset.

`ROOT-ISSUE-041` remains satisfied: upstream Issues #717 and #736 require
visible source and command audit previews, so zero cannot suppress those
previews and maps to the tested minimum. `Searchable terms` remains optional
and accepts zero. No provenance path writes restricted execution data to FTS5.

## Supported Platforms

The Codex manifest and deterministic release-asset checks are platform-neutral;
the real stdio and offline Codex CLI probes passed on the current Linux host.
Existing CI will validate Ubuntu, macOS, and Windows delivery. Restricted
execution support remains Linux-only with a successful real `bubblewrap`
probe; macOS and Windows still fail closed in restricted mode and retain
compatibility mode.

## Release Result

The existing native-attested release flow completed without moving or
rewriting another tag:

```text
Provider-authorized native compact preflight
  PASS; manual and automatic lifecycles both reached
  pending -> confirmed -> claimed
  Node 26.6.0; Codex CLI 0.146.0; provider tuple openai-custom

Native attestation
  path: docs/releases/attestations/v1.0.185.json
  raw SHA-256: c2a0fc346598bcfa4aa5e33da51d5cc00e6e6b7857ed4bc1e8c62b189a5433b2
  attestation SHA-256:
  e0ee8302a68eeb1b8191876af6a04eb5461b340d27d6e80a50f7697164922fc2

node scripts/verify-codex-native-release-attestation.mjs ...
  PASS; source e84de520 is the direct parent of evidence 1b784333,
  whose only change is the tracked v1.0.185 attestation

node scripts/validate-fork-release-tag.mjs v1.0.185
  PASS; tag target is reachable from origin/devel

Source CI
  Bundle Drift Check 31416294616: PASS
  OpenClaw E2E 31416294621: PASS
  CI 31416294635: PASS; offline Codex asset, Ubuntu, macOS, Windows

Evidence CI
  OpenClaw E2E 31418368123: PASS
  CI 31418368099: PASS; offline Codex asset, Ubuntu, macOS, Windows

GitHub Release workflow 31418586932
  PASS; typecheck, build, bundle drift rejection, full test, release assets,
  immutable native attestation verification, and publish

Downloaded GitHub Release assets
  CONTENT-MANIFEST.json:
    7728c44d1ef0b0aeb9a135274e7181d6a3448c0379fd9ca8c9dc84a60f30a0c9
  context-mode-1.0.185.tgz:
    dba552437523d50e9d3b8fd97d29d9bc33324773611787e9188e2ec3356d795e
  context-mode-codex-marketplace-v1.0.185.tar.gz:
    43e5753cef82077f51bf422dd9d7061c3da498d1b00207468ed1e85099b9a675
  context-mode-codex-marketplace-v1.0.185.tar.gz.sha256:
    436d6bbf04f7d242d412bed73a91250b332edf2a9e538b98b57fee489b4274d9

Downloaded marketplace verification
  PASS; checksum sidecar, byte-identical CONTENT-MANIFEST, 124 entries,
  exact five-name env_vars, offline install, and MCP initialize

npm view context-mode version dist-tags.latest --json
  unchanged at 1.0.169; no npm publication
```

Release URL:
`https://github.com/PennixRv/context-mode/releases/tag/v1.0.185`

The shell did not expose `OPENAI_API_KEY`. Two attempts using an unrelated
inherited credential failed at the seed turn with an authorization category
before any compact or hook event and produced no attestation. The successful
official preflight used the user-authorized current profile API key only in the
parent process environment; it persisted no credential, copied no auth file
into the disposable profile, and removed all temporary provider state and raw
reports.

## Residual Risks

- Existing installed Plugin caches do not change until a user installs or
  upgrades to the published version; this task never edits cache state.
- Forwarding depends on Codex honoring manifest `env_vars`; source, offline
  installation, normalized transport, and the current CLI are verified, while
  future Codex regressions remain external.
- The Codex host may continue displaying the complete `Called` input even when
  context-mode returns a bounded source preview.
- The official preflight intentionally reports a generic child-validator
  failure after deleting raw reports. Credential-selection failures therefore
  require a separate content-free diagnostic classification; improving that
  operator diagnostic is outside this task and was not added to release code.
- GitHub Actions reported that several pinned actions still target deprecated
  Node.js 20 metadata and were forced onto Node.js 24. The workflows passed;
  action-version maintenance remains a separate repository task.
