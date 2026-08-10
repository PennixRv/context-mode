# Check Record: Codex Presentation Environment Forwarding

Date: 2026-08-11

## Scope Review

- Source `.codex-plugin/mcp.json` forwards exactly the five approved
  presentation variable names and retains only fixed
  `CONTEXT_MODE_PLATFORM=codex` in `env`.
- No budget value, credential, prefix, wildcard, unrelated variable, other
  platform manifest, presentation default, execution policy, or generated
  runtime bundle changed.
- Source, marketplace payload, `CONTENT-MANIFEST.json`, offline installation,
  and normalized `codex mcp list --json` are covered by exact parity checks.
- Real stdio tests use non-sensitive values and exercise both an absent parent
  environment and `64/64/16/0/160` forwarding.

## Verification Completed

```text
Focused regression matrix
  PASS; 8 files, 63 tests

npx --yes pnpm@10.23.0 run typecheck
  PASS

npx --yes pnpm@10.23.0 run build
  PASS; nine assert-bundle checks and assert-asymmetric-drift

npx --yes pnpm@10.23.0 test -- --reporter=basic
  PASS from the real repository path; 233 files, 4,983 passed,
  41 skipped, 5,024 total

node scripts/build-codex-marketplace-bundle.mjs --output-dir <fresh-dir>
node scripts/verify-codex-release-asset.mjs <fresh-archive>
  PASS; content manifest, offline install, normalized MCP transport,
  and initialize probe

Consecutive marketplace builds
  PASS; both 2,744,548 bytes with SHA-256
  43e5753cef82077f51bf422dd9d7061c3da498d1b00207468ed1e85099b9a675
  CONTENT-MANIFEST SHA-256:
  7728c44d1ef0b0aeb9a135274e7181d6a3448c0379fd9ca8c9dc84a60f30a0c9

Consecutive generated bundles
  PASS
  server.bundle.mjs:
  a7c4c284b57865c7383ed02275b1ccc6d8a2ff93eb672c97efe99d4ca71be4a4
  cli.bundle.mjs:
  a249c13c6541cd9b882b2136f24f97e8d9e9b970482866fe54e287f2f2c0a8c6

git diff --check
  PASS
```

The repository has no independent lint script. An initial full-suite run inside
`ctx_execute` placed fixtures below its intentionally hidden `.ctx-mode-*`
temporary root, so hidden-path security tests correctly rejected them. The
same suite was rerun from the real repository path and passed; the production
hidden-path boundary was not weakened.

## Real Return Measurements

For the deterministic 365-character JavaScript source:

| Parent presentation values | Source preview | Complete MCP return |
| --- | ---: | ---: |
| all five absent | 240 characters | 481 characters, 7 lines |
| `64/64/16/0/160` | 64 characters | 289 characters, 7 lines |

Both responses preserve the fenced language, original length, preview length,
omitted length, truncation state, stable SHA-256 digest, and stdout. A zero
`Searchable terms` value disables only optional terms; it does not suppress the
source audit preview required by upstream Issues #717 and #736.

## Release Gates Completed

- Release source `e84de520b7a5eeeec2b1784e4efde45936b280ce` is on
  `origin/devel`; its direct child
  `1b784333cae7c30a9100fb314b2140929450b9e7` adds only the native
  attestation.
- Provider-native manual and automatic compact both reached
  `pending -> confirmed -> claimed`; attestation and tag metadata verification
  passed before tag publication.
- Annotated tag object `9a0dc5e52f3e591e2fda090f9bb1d153bf6e00ab`
  peels to the evidence commit.
- Source/evidence CI, OpenClaw E2E, Bundle Drift, and Release workflow passed on
  all configured platforms. Release workflow `31418586932` published four
  assets.
- All downloaded assets, the checksum sidecar, manifest byte parity, npm
  package version, offline installation, exact `env_vars`, and MCP initialize
  were independently verified. npm `latest` remained `1.0.169`.
