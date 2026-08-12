# Implementation Plan: Compact MCP Presentation Contract

## Baseline

- Branch point: `devel`
- Baseline: `c7a098606518a53bfb9a43c0ca11caceb5bd4ed4`
- Starting version: `1.0.185`
- Dispatch mode: inline; current main session implements and checks directly.

## 1. Bind And Measure

- [x] Run `task.py start` only after explicit approval of the final planning
  summary.
- [x] Create a dedicated fix branch from the verified baseline.
- [x] Run `trellis-before-dev` and read all applicable specs.
- [x] Add a deterministic baseline measurement harness covering all fifteen MCP
  tools and the response classes in `research/baseline-measurement-plan.md`.
- [x] Record current wrapper/actionable bytes, characters, and non-empty lines
  before changing production renderers.

## 2. Shared Presentation Primitives

- [x] Refactor `src/presentation-policy.ts` or add one focused sibling module
  for typed execution proofs, compact inventories, conditional hints, compact
  typed state, and measurement helpers.
- [x] Keep original input, exact digest, original/preview/omitted counts, and
  truncation state in typed values.
- [x] Extend the local result type for optional bounded `structuredContent`
  without removing self-sufficient text content.
- [x] Add unit tests for Unicode boundaries, digest stability, multiline source,
  zero/min/max environment parsing, list ceilings, and deterministic rendering.

## 3. Execution Family

- [x] Apply compact source proof to every `ctx_execute` response branch.
- [x] Apply compact path/source proof to every `ctx_execute_file` branch.
- [x] Redesign the reachable queried `ctx_batch_execute` wrapper, preserving
  actual bounded commands, per-command security, timeout semantics, query
  scope, persistence mode, and exact retrieval source. The schema has required
  `queries.min(1)` since commit `103b41dd`; this task does not add a no-query
  protocol surface.
- [x] Add a canonical batch digest over every full ordered label and command.
- [x] Verify #717/#736 default, zero, minimum, long, error, timeout, background,
  restricted, and compatibility paths.

## 4. Retrieval Family

- [x] Compact `ctx_index` success and error responses with conditional hints.
- [x] Compact `ctx_search` headings, empty states, throttle states, and repeated
  guidance without changing ranking or snippets.
- [x] Compact `ctx_fetch_and_index` cached, fetched, batch, partial failure, and
  all-failure responses without changing cache or indexing behavior.
- [x] Verify stale-source, source filter, multi-query, global/batch scope, TTL,
  force refresh, and local HTTP fixture behavior.

## 5. State, Diagnostic, And Management Family

- [x] Audit `ctx_stats`; preserve its already capability-bearing minimal result
  byte-for-byte rather than changing it for symmetry.
- [x] Compact `ctx_doctor` all-pass output while retaining every WARN/FAIL and
  remediation.
- [x] Return compact typed checkpoint and RecoveryBrief state with text and
  structured parity.
- [x] Compact `ctx_upgrade`; audit `ctx_purge` and preserve its destructive
  scope/result byte-for-byte rather than risking target or count loss.
- [x] Confirm `ctx_insight` is already minimal and retain it unchanged.
  changes.

## 6. Cross-Tool Contract Tests

- [x] Add table-driven presentation contract coverage for every registered MCP
  tool and applicable response class.
- [x] Assert semantic fields, error flags, actual source/command visibility,
  line ceilings, character ceilings, and deterministic output.
- [x] Assert queried batch wrapper is at most two non-empty lines and lacks the
  verbose per-command presentation suffix.
- [x] Assert the queried batch reports its exact persistent source so later
  source-scoped retrieval remains discoverable.
- [x] Assert restricted execution stays request-only and writes no FTS5 data.
- [x] Run real stdio probes in disposable project/state directories for default
  and configured presentation values.

## 7. Documentation And Specification

- [x] Update README response examples and configuration documentation.
- [x] Update
  `.trellis/spec/backend/restricted-execution-and-presentation.md` with the
  compact wrapper/actionable-result contract.
- [x] Document that Codex `Called` input is host-owned and unchanged.
- [x] Record before/after measurements and any intentionally unchanged tools in
  task results.

## 8. Validation

- [x] Run focused presentation, execution, search/index/fetch, recovery,
  checkpoint, stats, doctor, purge, upgrade, and adapter tests.
- [x] Run `npx --yes pnpm@10.23.0 run typecheck`.
- [x] Run `npx --yes pnpm@10.23.0 run build`.
- [x] Run canonical `TMPDIR=/tmp npx --yes pnpm@10.23.0 test` from the real
  repository path. Vitest `4.1.10` treats the planned `--reporter=basic` value
  as an unavailable custom module, so it is not a valid project command.
- [x] Run every bundle assertion and asymmetric drift check through `build`.
- [x] Build and verify a fresh pre-version Codex marketplace archive offline.
- [x] Repeat generated bundle and marketplace builds and compare hashes/content.
- [x] Run `git diff --check`, Trellis validation, and `trellis-check`.
- [x] Update specs through `trellis-update-spec` and re-run affected tests.

## 9. Commit And Release

- [x] Commit implementation, tests, docs, specs, and task evidence with the
  repository clean after each logical gate.
- [x] Confirm local/remote `devel` and remote tags immediately before selecting
  the next patch. Stop if occupied; never overwrite or force-push.
- [x] Run `npm version 1.0.186 --no-git-tag-version` so the repository's
  `version` lifecycle updates every owned manifest through `version-sync`.
- [x] Re-run the complete validation matrix at the release version.
- [ ] Create the final release source commit.
- [ ] Run the official native Codex release preflight using only current
  authorized provider/auth through disposable state; print no credentials.
- [ ] Commit only the generated attestation in a direct child evidence commit.
- [ ] Verify attestation and release tag metadata, then create the annotated tag
  on the evidence commit.
- [ ] Push authorized refs and tag; wait for source/evidence CI and Release
  workflow success.
- [ ] Download and independently verify every release asset, SHA-256,
  `CONTENT-MANIFEST`, npm package payload, marketplace archive, offline install,
  and real MCP initialize/call output.
- [ ] Archive the Trellis task, update the local journal, return to clean
  `devel`, and report all commits, tag topology, measurements, checks, assets,
  supported platforms, and residual risks.

## Risk And Rollback Points

- `content[0].text` is a compatibility surface even where Markdown was not
  formally versioned. Keep semantic fields and add focused migration tests.
- A shared renderer must not become a global truncator. Tool-family renderers
  retain ownership of actionable result boundaries.
- `structuredContent` support differs across clients. Text remains complete.
- Purge, browser launch, upgrade, and release tests use injected/disposable
  state; never use live destructive state for measurement.
- If full validation fails after the presentation refactor, revert the affected
  renderer family independently before versioning. After publication, use a new
  patch rather than moving the tag.
