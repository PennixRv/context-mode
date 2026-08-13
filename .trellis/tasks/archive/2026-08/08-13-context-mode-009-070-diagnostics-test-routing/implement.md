# Implementation Plan: Issue 009 Diagnostics And Issue 070 Test Routing

## Ordered Work

1. Bind the task with `task.py start`, load `trellis-before-dev`, and re-read the task
   artifacts plus applicable backend, frontend, and guide specs before product edits.
2. Establish red regressions from the root handoff: diagnostic projection fixtures and
   real command-routing cases for the five reported test commands. Record exact failures
   in the task evidence without changing root files.
3. Implement Issue 009 in the Codex adapter: collect structured Plugin-list/configuration
   facts, model observation states and separate roots, project common diagnostics, and
   wire CLI Doctor, MCP `ctx_doctor`, and Plugin-list JSON to that projection.
4. Add Issue 009 unit, fixture, CLI, MCP, and marketplace-install diagnostic tests for
   normal, mismatch, missing, disabled, absent-cache, and unobservable-session states.
5. Implement Issue 070's structured test-command classifier and integrate it with the
   existing PreToolUse route while preserving guidance throttling, compound-shell
   behavior, direct exclusions, status propagation, timeout/truncation, and persistence
   boundaries.
6. Add Issue 070 classifier and route integration tests for command families, wrappers,
   paths, arguments, environment prefixes, compounds, repeated calls, outcomes, and
   false-positive controls. Add the dynamic discovery/query-scope regression for Issue
   068 where the component contract is affected.
7. Update the context-mode Skill, Hook/routing documentation, Doctor documentation,
   manifest/release notes, and any generated release assets required by the existing
   marketplace/content-manifest pipeline. Do not modify the parent Skill or settings.
8. Run `trellis-check`, inspect cross-layer data flow and the complete diff, then run all
   focused and full gates listed below. Fix regressions and repeat the check as needed.
9. Run `trellis-update-spec` only for durable component contracts learned here, update task
   evidence/results, create focused source/test/doc commits, and verify the worktree is
   clean before release.
10. Confirm the next version/tag and remote release contract are unoccupied, publish the
    non-prerelease Linux/WSL release using the existing workflow, verify CI, Release,
    provenance, asset hashes, and peeled tag, then stop for root-side install/restart
    acceptance.

## Validation Matrix

| Area | Required evidence |
| --- | --- |
| Baseline | branch/base/tag, clean pre-change state, no root or credential changes |
| Issue 009 red/green | shared projection, direct CLI Doctor, MCP `ctx_doctor`, `codex plugin list --json`, all six fault fixtures |
| Issue 070 red/green | all command families, wrappers/prefixes/paths/args/compounds, first/repeated, success/failure/timeout/truncation, false positives |
| Routing boundaries | short observation, edits, navigation, process/lifecycle, wait-next, Trellis/Governance, CodeGraph, Fast Context, OpenViking, unknown MCP, bounded structured tools |
| Persistence/presentation | #013 unverified candidates, #041/#054 compact budgets and forwarded variables, no false completed/indexed result |
| Static quality | format check, lint, `pnpm typecheck`, `pnpm build`, bundle/asymmetric-drift/content-manifest checks |
| Tests | focused Vitest tests, `pnpm test`, release-asset/marketplace offline verification |
| Release | consecutive build drift, source candidate, annotated tag object/peeled commit, provenance, every asset SHA-256, CI and GitHub Release state |

## Planned Commands

```sh
python3 ./.trellis/scripts/task.py start 08-13-context-mode-009-070-diagnostics-test-routing
python3 ./.trellis/scripts/get_context.py
pnpm exec vitest run tests/adapters/codex-diagnostic-projection.test.ts tests/core/test-command-routing.test.ts
pnpm exec vitest run tests/adapters/codex.test.ts tests/core/routing.test.ts
pnpm typecheck
pnpm run format:check
pnpm run lint
pnpm run build
pnpm test
pnpm run build:codex-marketplace
pnpm run verify:codex-marketplace
pnpm run assert-bundle
pnpm run assert-asymmetric-drift
python3 ./.trellis/scripts/task.py validate 08-13-context-mode-009-070-diagnostics-test-routing
```

If a script is not defined by the baseline package, use the repository's documented
equivalent and record that fact instead of inventing a new release gate. Real MCP and
Plugin installation/restart checks are root-session responsibilities and are not run here.

## Implementation Evidence

- Red baseline recorded in `research/baseline-failures.md`: the shared diagnostic
  projection was absent and the reported test commands were not classified.
- Issue 009 is implemented in `src/adapters/codex/diagnostics.ts` and
  `src/adapters/codex/index.ts`; CLI and MCP consumers use the same serialized
  projection through `src/cli.ts` and `src/server.ts`.
- Issue 070 is implemented in `hooks/core/routing.mjs`; direct protocol and
  lifecycle exceptions remain outside the classifier.
- Regression fixtures cover normal, unavailable, missing, disabled, stale-root,
  absent-cache, missing-manifest, missing-Hook, and unobservable-session states;
  command families, wrappers, prefixes, paths, compounds, repeat calls, false
  positives, exit status, timeout, syntax error, output caps, and success-only
  searchable bodies.
- The project package has no `lint` or `format:check` script. Typecheck, build,
  bundle assertions, asymmetric drift, `git diff --check`, focused Vitest, and the
  full Vitest suite are the repository's applicable local gates.

## Rollback Points

- Before product edits: delete or retain only the local task artifacts.
- After Issue 009: revert only the diagnostic model/projection and its tests if the
  cross-surface contract cannot remain compatible.
- After Issue 070: revert only classifier integration and tests if direct command routing
  regressions appear; retain the already-validated diagnostic work.
- Before publication: require clean source, passing release gates, unoccupied version/tag,
  and a reproducible source candidate. Never overwrite a tag or force-push.
- After publication: source rollback is a new patch/revert release; root installation and
  restart are intentionally outside this session.
