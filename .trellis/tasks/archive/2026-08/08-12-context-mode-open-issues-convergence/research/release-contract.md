# Release Contract Audit

The repository's existing fork release contract is authoritative:

1. `devel` carries fork releases; `main` mirrors upstream and is not a release
   target.
2. A clean source candidate is built and tested first.
3. `scripts/run-codex-native-release-preflight.mjs` produces the native compact
   delivery attestation at `docs/releases/attestations/vX.Y.Z.json`.
4. The attestation is added in a direct-child evidence commit containing no
   other file.
5. An annotated tag points to that evidence commit and includes exactly one
   `Codex-Content-Manifest-SHA256: <digest>` line.
6. `.github/workflows/release.yml` checks that the tag is reachable from
   `origin/devel`, verifies source/evidence topology, runs typecheck/build/test,
   rebuilds the npm tarball and offline Codex marketplace archive, checks bundle
   drift and asymmetric drift, verifies the native attestation, and creates the
   GitHub Release with the npm archive, marketplace archive, sidecar and
   `CONTENT-MANIFEST.json`.

The current workflow does not run `npm publish`; the npm deliverable is a
release asset and its manifest/package contents must be validated as such. A
new release must not claim registry publication unless a separate repository
contract is added and explicitly executed.

The next expected free stable patch is `v1.0.187`; tag occupancy must be checked
again immediately before release and an occupied tag must never be overwritten.
