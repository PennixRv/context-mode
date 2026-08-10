# Result: Cross-Platform Capability Fixtures And v1.0.184

Date: 2026-08-10

## Identity

- Follow-up to: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`
- Branch: `devel` after the completed implementation was integrated
- Release version: `v1.0.184`
- Implementation commits: `330d9ffd`, `376cb127`, and `74e251eb`
- Version commit: `5f988654`
- Pre-release source candidate: `74e251eb2614232d34b6208817ee988960e1c894`
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

## Release Gate

The archived task commit establishes the final source identity. The existing
release workflow must still create a provider-authenticated native compact
attestation as its direct child, build and verify the deterministic marketplace
asset, validate the annotated tag against remote `devel`, publish the GitHub
Release, redownload all assets, and confirm npm `latest` is unchanged. Those
external results are recorded after publication rather than predicted here.

## Residual Risks

- Windows private capability persistence remains deliberately fail-closed;
  enabling it requires a separate ACL-based security proof, not a test skip
  removal.
- The macOS fix relies on operating-system canonicalization of the trusted temp
  root. Caller-supplied storage paths still receive the stricter ancestry check.
- No npm registry publication is intended; the npm-shaped tarball remains a
  GitHub Release asset only.
