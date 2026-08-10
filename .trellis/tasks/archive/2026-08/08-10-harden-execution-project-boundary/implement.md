# Implementation Plan: Execution Boundary Hardening

Correlation IDs: `ROOT-ISSUE-025`, `ROOT-ISSUE-041`

## 1. Reconfirm The Baseline

- [x] Run `trellis-start`, bind this task, and use `trellis-before-dev` to read
      applicable project specifications.
- [x] Confirm branch, preparation commit, and clean status. Stop on unexplained
      existing changes.
- [x] Map all three handlers, `PolyglotExecutor`, `ContentStore`, platform
      adapters, and bundle-generation paths.
- [x] Read upstream Issues #717 and #736, map `CODE_ECHO_MAX`,
      `buildExecuteEcho()`, indexed-summary formatting, and their regression
      tests before changing response presentation.
- [x] Run the existing #852, security-routing, executor, and batch tests before
      implementation and record the baseline result.

## 2. Define One Policy Contract

- [x] Define shared authority levels, authority provenance, isolation status,
      and stable error classes.
- [x] Make all three handlers obtain decisions from one policy entrance and
      remove duplicate or contradictory boundary interpretations.
- [x] Prove through tests that ordinary tool input cannot elevate authority.
- [x] Define tool names, annotations, descriptions, and compatibility behavior
      for ordinary and restricted execution.

## 3. Enforce Restricted Execution

- [x] Implement one subprocess-isolation launch path while preserving existing
      timeout, output-cap, and process-group cleanup behavior.
- [x] On supported platforms, enforce project read-only access, hide external
      files, disable network, and prevent background process survival.
- [x] Add fail-closed behavior and diagnosable errors for unsupported or
      unverifiable isolation backends.
- [x] Connect the explicit `ctx_execute_file` path check to the shared policy
      without weakening issue #852 behavior.

## 4. Remove Persistent Side Effects

- [x] Implement request-lifetime indexing or equivalent non-persistent query
      support for restricted batch aggregation.
- [x] Prevent restricted `intent`, batch execution, and telemetry/event paths
      from writing persistent storage.
- [x] Prove that a later `ctx_search` cannot recall restricted output.
- [x] Preserve and clearly document ordinary indexed compatibility mode.

## 5. Test The Boundary

- [x] Complete the entrance, authority, language, path, side-effect, storage,
      and scheduling matrix from the PRD and design.
- [x] Use real subprocess tests for command-internal `cd`, absolute access,
      child processes, writes, network, and background survival.
- [x] Cover concurrency, timeout, cancellation, encoded or indirect paths,
      missing targets, and unavailable isolation backends.
- [x] Check tool lists, adapters, source, and bundled output for consistency.

## 6. Compact And Test MCP Responses

- [x] Define one bounded presentation policy for execution-source previews,
      indexed title previews, and searchable-term counts.
- [x] Add documented configuration with a compact default, stable validation,
      Unicode-safe truncation, original size, omitted size, and digest metadata.
- [x] Preserve the verified #717/#736 audit contract; support a zero preview only
      when tests prove it does not bypass required inspection.
- [x] Keep restricted execution non-persistent and explicitly document that the
      Codex `Called` argument block is host-owned and unchanged.
- [x] Add unit and MCP integration tests that assert both semantic output and
      measured response limits for default and configured cases.

## 7. Validate And Deliver

```bash
pnpm exec vitest run tests/security/project-boundary-852.test.ts <new-targeted-tests>
pnpm run typecheck
pnpm test
pnpm run build
git diff --check
git status --short
```

- [x] Use `trellis-check` for full-scope review. Inline mode must not dispatch a
      check subagent.
- [x] Capture reusable execution-security contracts in the applicable
      `.trellis/spec/` document; keep one-off logs in task evidence.
- [x] Commit source, tests, documentation, and task assets. Do not push,
      publish, or update the parent Gitlink.
- [x] Leave the worktree clean and report branch, base, commits, changed files,
      validation, platform support, response-size measurements, both root issue
      IDs, host-owned limitations, and residual risks.

## Stop Conditions

- The proposal uses fixed `cwd`, string blacklists, or a caller-declared
  read-only flag as the final security boundary.
- Restricted execution can still write an index or file, use the network, or
  leave a child process.
- Continuing requires modifying the parent repository, global Codex config,
  Governance Plugin, or another component.
- Unexplained existing changes, real sensitive paths, a remote push, or a
  release become necessary.
