# Quality Check

Date: 2026-08-10

## Final Source Result

- `trellis-check`: completed in the inline main session; no subagent or Trellis
  channel was used.
- Focused contract/security/executor matrix: 11 files passed; 197 tests passed;
  24 tests skipped by platform/runtime gates.
- Full suite: 232 files passed; 4,979 tests passed; 41 tests skipped.
- TypeScript no-emit check: passed.
- Build: passed; all nine bundle assertions and asymmetric-drift assertion
  passed.
- `git diff --check`: passed.
- Real installed `ctx_execute` probe: sandbox basename `.ctx-mode-VSLkXB`; 2
  files passed; 4 tests passed. No caller `TMPDIR` override was used.
- Repository lint script: not present, so no independent lint command exists.
- Integration: merged `origin/devel@6057a8d8` with merge commit
  `e4a6921c`; the remote-only change was `stats.json` and had no path overlap.
- Versioned archive checks: npm pack `context-mode-1.0.183.tgz` reported version
  `1.0.183`; Codex marketplace archive verification installed the offline
  plugin and completed an MCP initialize probe with 124 manifest entries.
- Deterministic bundle hashes matched across consecutive builds:
  `server.bundle.mjs` `ed1fe26686b74917402625d77098fd4259839e2e0fb687fe9dd898e38e09e660`;
  `cli.bundle.mjs` `4850b743106cc3d3a886d752543d1cf51dda80bd3dcc1199558ec40f7158fdf8`;
  `hooks/checkpoint.bundle.mjs` `a993bf5d00cf5a9e6914cd7104ada9aa969e4696609eb2e708d0a56705afbdaa`.

## Findings Resolved During Check

1. The initial tool example used prose in `source_sha256` and therefore was not
   schema-valid. It now uses 64 lowercase hexadecimal characters and has a
   source contract assertion.
2. Direct Zod tests did not prove nested MCP `tools/list` projection. An
   in-memory MCP client now asserts the complete top-level shape, strictness,
   required fields, and list bound.
3. The executor cleanup regression scanned every `.ctx-mode-*` under shared
   host temp and could misclassify a concurrent test's live directory as a
   leak. It now captures the exact child `TMPDIR` and checks only that path.

## Release Gates

- Source commit and worktree-clean checkpoint are pending the archive commit.
- The disposable native release preflight, evidence-only child commit,
  annotated tag, remote push, and GitHub Release workflow remain external
  actions. npm registry publication is intentionally excluded.
