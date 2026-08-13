# Devel CI Follow-Up

Date: 2026-08-13
Source candidate: `a781ca4e619c9a843d76289b032a939f771e07c3`
CI run: `31676419914`

## Confirmed Failure

The Linux and macOS jobs, offline marketplace job, Bundle Drift Check, and
OpenClaw E2E passed. The Windows test job failed for two fixture-owned reasons:

1. `tests/plugins/codex-doctor-entrypoints.test.ts` created only a POSIX
   executable named `codex` and replaced `PATH` with POSIX directories. The
   production adapter correctly invokes `cmd.exe /c codex ...` on Windows, so
   the fixture could not expose its JSON inventory and diagnostics correctly
   reported the inventory facts as unavailable.
2. `tests/execution-persistence.test.ts` imported the in-process MCP server,
   opened its module-level `ContentStore`, and removed the temporary directory
   without first exercising the project purge path that closes the SQLite
   handle. Windows rejected the recursive removal with `EPERM`.

## Repair Boundary

- Keep the production Doctor and routing behavior unchanged.
- Give the fake Codex one Node implementation with POSIX and Windows launchers.
- Preserve only the process environment needed to locate the host command
  interpreter and runtime; do not copy credentials or profile state.
- Exercise the existing project purge contract before deleting the test root,
  rather than adding a test-only product API.
- Rerun focused tests, the complete suite, build and drift gates, then require
  a successful remote CI run before release evidence or tag creation.
