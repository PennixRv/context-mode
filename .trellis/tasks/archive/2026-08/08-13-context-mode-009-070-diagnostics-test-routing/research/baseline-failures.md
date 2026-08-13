# Baseline Failures

Date: 2026-08-13
Baseline: `v1.0.187` / `a60080e82fb57adf77b119cab84bd92408ede1b9`

## Command

```sh
node scripts/run-pnpm.mjs exec vitest run \
  tests/core/test-command-routing.test.ts \
  tests/adapters/codex-diagnostic-projection.test.ts
```

## Result Before Implementation

- Test files: 2 failed.
- Tests: 47 failed, 1 passed.
- Issue 009: four failures because `parseCodexPluginList` and typed diagnostic
  checks did not exist; the legacy projection exposed only booleans and treated an
  absent runtime-root probe as missing hooks.
- Issue 070: 43 failures because `isTestExecutionCommand` did not exist and
  `routePreToolUse("Bash", { command: "pnpm test" })` returned `null` on first and
  repeated calls.
- The direct-protocol control assertion passed, confirming the red fixture does not
  require broad interception of unrelated tools.

The first attempted command used bare `pnpm`, which was not on this shell's `PATH`.
The recorded product baseline uses the repository's canonical
`node scripts/run-pnpm.mjs` entry and reached Vitest successfully.
