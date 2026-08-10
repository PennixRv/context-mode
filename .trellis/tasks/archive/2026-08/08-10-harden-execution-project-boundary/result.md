# Result: Execution Boundary Hardening

Date: 2026-08-10

## Identity

- Root issues: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`
- Branch: `fix/issue-025-execution-boundary`
- Start commit: `3f3114d5bad90f94577ab40729da6ecbc9d9df57`
- Implementation commit: `a3f97937` (`fix: harden restricted execution boundary`)
- Delivery: local component commits only; no push, publish, release, parent
  repository update, Gitlink update, or external allowlist change

## Delivered

`ROOT-ISSUE-025` now has one server-authorized decision for `ctx_execute`,
`ctx_execute_file`, and `ctx_batch_execute`. Restricted mode requires an
explicit canonical project root and a successful Linux bubblewrap probe. The
project is read-only, external project data and ordinary temporary paths are
hidden, network and background requests are blocked, nested children inherit
the namespace, and isolation failure is stable and fail-closed. Restricted
startup, execution, result handling, and shutdown do not create or delete
persistent index, statistics, event, preload, readiness, hook, repair, or build
state. Compatibility mode remains explicitly writable, networked, and
persistent.

`ROOT-ISSUE-041` now has one typed `PresentationPolicy` for source, command,
title, searchable-term, and result previews. Source and command responses keep
language, original/preview/omitted character counts, truncation state, and a
stable SHA-256 digest. Unicode code points and Markdown fences are handled
safely. Restricted large-result matching is request-local and cannot be
retrieved later by `ctx_search`.

## Changed Files

- Policy and execution: `src/execution-policy.ts`, `src/executor.ts`,
  `src/ephemeral-search.ts`, `src/server.ts`, `start.mjs`
- Presentation: `src/presentation-policy.ts`, `src/server.ts`
- Generated artifacts: `server.bundle.mjs`, `cli.bundle.mjs`
- Tests: `tests/execution-policy.test.ts`,
  `tests/presentation-policy.test.ts`,
  `tests/executor/restricted-boundary.test.ts`,
  `tests/core/restricted-execution-server.test.ts`,
  `tests/core/echo-commands.test.ts`, `tests/core/cli.test.ts`
- User documentation: `README.md`
- Specification: `.trellis/spec/backend/index.md`,
  `.trellis/spec/backend/restricted-execution-and-presentation.md`
- Task evidence: `check.md`, `implement.md`, `recovery-brief.json`, this result,
  and the five files under `research/`

## Verification

```text
Retrospective exact-start-commit baseline
  build: PASS
  7 files passed; 259 passed | 25 skipped (284)

Targeted policy/security/executor/server matrix
  12 files passed; 295 passed | 25 skipped (320)

Restricted real subprocess and MCP lifecycle probes
  2 files passed; 17 passed (17)

Source-form and startup contracts
  3 files passed; 784 passed (784)

TMPDIR=/tmp pnpm test
  230 files passed; 4970 passed | 41 skipped (5011)

pnpm run typecheck
  PASS

pnpm run build
  PASS; all assert-bundle checks and assert-asymmetric-drift passed

Consecutive build hashes
  server.bundle.mjs 4c8d8671bdf75032cd6e7f1baea5c71c8005d481ceaaab7ee63803d2ef4209e6
  cli.bundle.mjs    ab5a605faff609c2fc54062382a35a4fa63040258c5c4732a5e865e880853340
  both deterministic

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-10-harden-execution-project-boundary
  PASS

git diff --check
  PASS
```

The repository has no `lint` script; no independent lint command was available.

## Supported Platforms

- Enforced restricted execution: Linux with a successful real `bubblewrap`
  capability probe.
- macOS and Windows: stable fail-closed restricted result; compatibility mode
  remains available.
- Restricted languages: shell, JavaScript, TypeScript, and Python when the
  selected interpreter is visible through the read-only system/runtime view.

## Upstream #717 / #736

Issues #717 and #736 are closed. Verified commits are
`38117ad1c614d685f615353e22c9185309ed1236`,
`a54c666f7d816a455c7d642f67ff53b278ae2641`,
`f7af3cafd9dfab45bbb7410053ffc059d128e279`, and
`c1030ca5fc3cfb1a4c16aa6618dc0637e162d6f2`, with regression coverage in
`tests/core/echo-commands.test.ts`. Their audit contract requires visible
executed source/commands, so source and command values of zero map to a tested
64-code-point minimum. Optional `Searchable terms` may be disabled with zero.

## Response Measurements

Inputs were a 4,020-character execute source, a 4,027-character execute-file
source, and a 1,550-character batch command. Complete context-mode MCP return
content measured:

| Policy | Execute | Execute file | Batch |
| --- | ---: | ---: | ---: |
| 2,000-preview proxy | 2,234 chars / 10 lines | 2,251 / 11 | 2,166 / 25 |
| Default | 473 chars / 10 lines | 490 / 11 | 1,342 / 25 |
| Configured compact | 312 chars / 10 lines | 329 / 11 | 938 / 25 |
| Effective zero minimum | 296 chars / 10 lines | 313 / 11 | 764 / 23 |

Default reductions versus the proxy are 78.8%, 78.2%, and 38.0%. Configured
compact reductions are 86.0%, 85.4%, and 56.7%. Every probe observed zero files
under its temporary storage, home, and host-temp roots.

Codex still receives the full 4,020-character source and 1,550-character command
as MCP input. The host-owned `Called` display is unchanged and its terminal line
wrapping cannot be measured or controlled by context-mode.

## Residual Risks

- Linux distributions and user-managed runtime layouts beyond this host's real
  probes need separate release portability coverage. A selected non-system
  runtime prefix is mounted read-only, not hidden.
- The minimum system/runtime support view is readable by design; the boundary
  protects project data and does not claim to hide interpreter support files.
- The external integration allowlist remains disabled until its own diff review
  and live read-only-node acceptance complete.
- Seven RecoveryBrief MCP findings are recorded in
  `research/recovery-brief-mcp-observations.md`; only findings directly required
  for this task were resolved here.
