# Baseline And Reduction Measurement Plan

## Measurement Unit

For each deterministic fixture, record:

- UTF-8 bytes;
- Unicode character count;
- non-empty line count;
- wrapper characters and non-empty lines;
- actionable-result characters and non-empty lines;
- presence of every required semantic field;
- whether visible source/command content is complete or bounded;
- whether a stable digest still binds a truncated preview to its original.

The primary acceptance comparison is wrapper reduction. Actionable query
matches and error details are measured but are not truncated merely to improve
the percentage.

## Fixtures

### Execution family

- deterministic 365-character JavaScript source with one-line stdout;
- long shell command in batch, including a label distinct from command text;
- three-command queried batch producing multiple indexed sections;
- batch without queries for later `ctx_search` discovery;
- timeout, non-zero exit, policy refusal, restricted request-only result;
- default and configured `64/64/16/0/160` presentation environments.

### Retrieval family

- one file with prose and code sections;
- one empty project store;
- one stale file-backed source;
- one no-result query and one multi-query result;
- cached and uncached fetch fixtures using a local HTTP server;
- partial multi-fetch failure.

### State and management family

- deterministic stats/checkpoint state directories;
- recovery provider absent, healthy, drifted, CAS success, and CAS conflict;
- doctor all-pass and mixed warn/fail through injected fixtures;
- upgrade marketplace refusal and generated command through injected adapter
  state;
- purge cancel, ambiguous target, session success, and project success inside
  disposable state directories only;
- insight browser-open success/failure through the existing runner seam.

## Safety

- Never run a destructive baseline against the user's real context-mode store.
- Never change installed plugin caches or `/home/penn/.codex`.
- Real MCP probes use temporary project/state directories and non-sensitive
  environment values.
- Network-dependent fetch measurements use a local temporary HTTP fixture.
- Management success/failure paths use the repository's injectable helpers or
  subprocess fixtures, not live publication or live cache mutation.

## Test Shape

Add a table-driven contract test that invokes production renderers/handlers and
asserts:

- semantic field preservation;
- wrapper line/character ceilings;
- actual source/command visibility;
- digest and truncation correctness;
- no verbose repeated presentation suffix in batch command inventory;
- exact structured/text parity for typed state responses;
- deterministic output under repeated execution.

Avoid broad full-response snapshots. They make harmless wording changes costly
and do not prove semantic preservation. Use focused assertions and explicit
measurement records instead.
