# Before-fix regression evidence

Recorded on 2026-08-12 from branch `fix/context-mode-open-issues-convergence`
at preparation commit `6514711aa445536b54f8f1e4f8cc2f225c2e56e1`.

Command:

```sh
node scripts/run-pnpm.mjs exec vitest run tests/open-issues-convergence.test.ts
```

Result: **failed as expected**. Vitest reported 1 failed file and 9 failed tests.

The failures establish the pre-fix state for the component-owned contracts:

- Codex bare and fully-qualified `ctx_execute` aliases selected two different
  `PreToolUse` groups in both shipped manifests.
- The shipped context-mode Skill still routed all commands and large MCP
  results through context-mode without preserving direct structured protocols
  or CodeGraph precedence.
- Execution tools had no explicit `none` versus locally verified persistence
  input and retained automatic FTS5 indexing paths.
- CLI, MCP/server, and analytics used separate or equality-only version checks;
  no shared Codex diagnostic model existed.
- The archived response-size measurement script was not replayable through a
  canonical repository-root-discovering entry point and did not expose bounded
  child stderr.
- Compatibility `ctx_execute_file` still applied a component-owned project-root
  wall and the executor had no bounded input-file snapshot contract.
- POSIX batch environment initialization was a command prefix rather than a
  preamble for the complete script.
- Batch results did not preserve a failed state and exact non-zero exit code.

This file records only the bounded summary. The raw Vitest output was not
committed because source-diff assertion output exceeded the useful evidence
surface; the test itself is the replayable proof.
