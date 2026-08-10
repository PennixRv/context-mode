# Result: Cross-Platform Capability Fixtures And v1.0.184

Date: 2026-08-10

## Identity

- Follow-up to: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`
- Branch: `devel` after the completed implementation was integrated
- Release version: `v1.0.184`
- Implementation commits: `330d9ffd`, `376cb127`, and `74e251eb`
- Version commit: `5f988654`
- Release source commit: `e59110e5f944b564b8d2e403bc79fff4b0fe8551`
- Native attestation evidence commit: `b4bfe49b7152c10ee246b0877dad4389462c2412`
- Annotated tag object: `c47aade93b7d1504c6c0bb23445579b866604b84`
- Release workflow: `31381633323`
- Published `v1.0.183` remains immutable; this task prepares a follow-up release
  instead of replacing its tag, assets, or audit record.

## Root Cause And Delivered Fix

The `v1.0.183` macOS CI failure was a fixture portability defect. Node exposes
the macOS temporary directory through `/var/folders/...`, while `/var` is a
system symbolic-link alias to `/private/var`. Production capability validation
correctly rejects symbolic-link ancestors, but the positive fixtures passed
the non-canonical alias as if it were caller-controlled storage.

The shared host-temp resolver now canonicalizes trusted POSIX operating-system
temporary roots before capability fixtures create storage below them. Windows
retains its native `TEMP`/`TMP` path spelling instead of receiving an extended
namespace path. No production capability ancestry, ownership, permission, or
fail-closed decision was relaxed.

The Windows CI investigation found two additional fixture assumptions:

- POSIX mode bits do not prove Windows ACL privacy, so positive private
  capability persistence and capability-backed routing are explicitly POSIX
  tests. Exact capability tool-name matching remains cross-platform.
- A shared FTS5 fixture now calls `ctx_purge` before deleting its root, closing
  the SQLite handle that Windows otherwise keeps open.

## Changed Files

Runtime helper and generated payload:

- `src/util/system-temp.ts`
- `server.bundle.mjs`
- `cli.bundle.mjs`

Tests:

- `tests/checkpoint/recovery-brief-capability.test.ts`
- `tests/core/server-shared-handler.test.ts`
- `tests/hooks/codex-mcp-capability.test.ts`
- `tests/hooks/codex-recovery-identity.test.ts`
- `tests/util/system-temp.test.ts`

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

Specification and task evidence:

- `.trellis/spec/backend/codex-trellis-recovery-boundaries.md`
- `.trellis/tasks/08-10-fix-macos-capability-fixtures/`

## Verification

```text
Focused capability/system-temp suites, three consecutive runs
  PASS; 4 files, 22 passed in each run

Expanded focused suite after the shared helper
  PASS; 5 files, 25 passed

Final Windows-boundary regression matrix
  PASS; 2 files, 8 passed

npx --yes pnpm@10.23.0 run test
  PASS; 232 files, 4,980 passed, 41 skipped, 5,021 total

npx --yes pnpm@10.23.0 run typecheck
  PASS

npx --yes pnpm@10.23.0 run build
  PASS; all nine assert-bundle checks and assert-asymmetric-drift passed

git diff --check
  PASS

Generated bundle SHA-256
  server.bundle.mjs: a7c4c284b57865c7383ed02275b1ccc6d8a2ff93eb672c97efe99d4ca71be4a4
  cli.bundle.mjs: a249c13c6541cd9b882b2136f24f97e8d9e9b970482866fe54e287f2f2c0a8c6
  hooks/checkpoint.bundle.mjs: a993bf5d00cf5a9e6914cd7104ada9aa969e4696609eb2e708d0a56705afbdaa

GitHub CI 31380257049 at 74e251eb
  PASS; offline marketplace asset, ubuntu-latest, macos-latest, windows-latest

OpenClaw E2E 31380257055 at 74e251eb
  PASS; ubuntu-latest and macos-latest

Bundle Drift 31379171120 at 376cb127
  PASS; the final 74e251eb commit changed tests/spec only, and local final
  bundle drift also passed
```

The repository has no independent `lint` script. The shell did not expose a
global `pnpm` or Corepack command, so validation used the package-pinned
`pnpm@10.23.0` through `npx` without changing dependency metadata.

## CI Investigation Record

- `v1.0.183` CI run `31374572464`: deterministic macOS `/var` alias failure.
- Candidate run `31377952522`: macOS fixed; Windows exposed four fixture-only
  failures involving private mode-bit proof and an open SQLite handle.
- Candidate run `31379170992`: confirmed Windows path spelling was not the
  remaining cause.
- Final run `31380257049`: all supported CI platforms passed.

## Supported Platforms

- POSIX: trusted host temp roots are canonicalized before test fixtures use
  them; explicit symbolic-link storage and ancestor inputs remain rejected.
- Windows: native `TEMP`/`TMP` spelling is preserved. Exact tool-name matching
  is tested, while private capability persistence/routing remains unavailable
  until Windows ACL privacy can be proved independently.
- Restricted execution remains Linux-only with a successful real `bubblewrap`
  probe. macOS and Windows continue to fail closed for restricted execution;
  compatibility mode remains available.

## Release Result

The project-native release flow completed without rewriting `v1.0.183`:

```text
Provider-authenticated native compact preflight
  PASS; manual and automatic lifecycles both reached
  pending -> confirmed -> claimed
  Node 26.6.0; Codex CLI 0.146.0; provider tuple openai-custom

Native attestation
  path: docs/releases/attestations/v1.0.184.json
  raw SHA-256: c39bdbf8cd6f33f612fc53a0bbcbf010fc72e4856456cbdc7da7c8eb90fbc06f
  attestation SHA-256: eec989308c86ab4253f053c6d2859482efb097cf9eba6e96f06692cc2482a97c

node scripts/verify-codex-native-release-attestation.mjs ...
  PASS; source e59110e5 is the direct parent of evidence b4bfe49b, whose
  only change is the tracked v1.0.184 attestation

node scripts/validate-fork-release-tag.mjs v1.0.184
  PASS; tag target is reachable from origin/devel

GitHub Release workflow 31381633323
  PASS; 17 steps, including typecheck, build, bundle drift, full test,
  release-asset verification, immutable attestation verification, and publish

Downloaded GitHub Release assets
  CONTENT-MANIFEST.json:
    b4494c9c9f44bceb194abcc35e8c535594eae13e685703970bbdd6ae195a0fd7
  context-mode-1.0.184.tgz:
    83bf0ad97f3a52880a704de72e69c9cf9bc6018a03c639429f4cf8247220ad0c
  context-mode-codex-marketplace-v1.0.184.tar.gz:
    2f6ae994c76f98805093c67033623bfc271005ea6f9ba271e38fa828fdd2d0e2
  context-mode-codex-marketplace-v1.0.184.tar.gz.sha256:
    547a8ec8763461d6373b46c7be77a8540fe2fdd819af972d1befa39570e91bbf

Downloaded marketplace verification
  PASS; checksum sidecar, CONTENT-MANIFEST, 124 entries, offline install,
  and MCP initialize

npm view context-mode version dist-tags.latest --json
  unchanged at 1.0.169; no npm publication
```

Release URL:
`https://github.com/PennixRv/context-mode/releases/tag/v1.0.184`

## Residual Risks

- Windows private capability persistence remains deliberately fail-closed;
  enabling it requires a separate ACL-based security proof, not a test skip
  removal.
- The macOS fix relies on operating-system canonicalization of the trusted temp
  root. Caller-supplied storage paths still receive the stricter ancestry check.
- No npm registry publication is intended; the npm-shaped tarball remains a
  GitHub Release asset only.
