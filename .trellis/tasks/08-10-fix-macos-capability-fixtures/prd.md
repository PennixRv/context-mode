# Fix macOS capability fixture canonicalization

## Goal

Canonicalize the trusted OS temp root in capability security fixtures so macOS system path aliases do not invalidate tests, without relaxing production symlink rejection; validate and publish v1.0.184.

## Requirements

- Record the deterministic macOS CI failure from run `31374572464`: macOS
  exposes its temporary directory through the system `/var` alias while the
  capability contract deliberately rejects caller-supplied paths with a
  symbolic-link ancestor.
- Canonicalize the trusted operating-system temporary root before creating
  fixtures in the three affected capability suites:
  `recovery-brief-capability.test.ts`, `codex-mcp-capability.test.ts`, and
  `codex-recovery-identity.test.ts`.
- Do not weaken, bypass, or platform-special-case the production ancestry,
  ownership, or permission checks. Explicitly constructed symbolic-link
  storage and ancestor fixtures must remain rejected.
- Preserve Windows skips for permission and symbolic-link behavior that the
  current tests cannot prove there.
- Validate the focused suites, full test suite, typecheck, build, generated
  bundle drift, release asset, and native Codex release gates.
- Publish the immutable follow-up as `v1.0.184`; do not rewrite or delete the
  already-published `v1.0.183` audit record and do not publish to npm.

## Acceptance Criteria

- [ ] All three affected suites derive fixture paths below
  `realpathSync(tmpdir())` or an equivalent trusted canonical root.
- [ ] The explicit symlink-directory and symlink-ancestor rejection tests
  continue to pass without production source changes.
- [ ] Focused tests pass repeatedly and the full local test suite, typecheck,
  build, and bundle drift checks pass.
- [ ] GitHub CI passes on `ubuntu-latest`, `macos-latest`, and
  `windows-latest` for the follow-up commit.
- [ ] `v1.0.184` passes the existing native provider-authenticated attestation,
  annotated-tag, release-asset, and remote ancestry gates.
- [ ] The GitHub Release assets are downloadable and match their declared
  SHA-256 digests; npm registry `latest` remains unchanged.

## Notes

- The failure is a fixture portability defect, not evidence that the
  fail-closed production policy should accept arbitrary symlink ancestry.
