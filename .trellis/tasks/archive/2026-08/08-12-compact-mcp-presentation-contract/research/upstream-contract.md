# Upstream Source-Echo Contract

## Sources

- mksglu/context-mode Issue #717, "`ctx_execute` etc should show the commands
  the agent runs in Pi": <https://github.com/mksglu/context-mode/issues/717>
- mksglu/context-mode Issue #736, "show ran commands in
  `ctx_batch_execute`": <https://github.com/mksglu/context-mode/issues/736>
- `f7af3cafd9dfab45bbb7410053ffc059d128e279`, batch section command echo and
  a 500-character command bound.
- `38117ad1c614d685f615353e22c9185309ed1236`, fenced `ctx_execute` source
  before stdout.
- `a54c666f7d816a455c7d642f67ff53b278ae2641`, path and fenced
  `ctx_execute_file` source before stdout.
- `c1030ca5fc3cfb1a4c16aa6618dc0637e162d6f2`, a `## Commands` inventory in
  `ctx_batch_execute` summaries.
- Local `tests/core/echo-commands.test.ts`, `src/presentation-policy.ts`, and
  `.trellis/spec/backend/restricted-execution-and-presentation.md`.

## Verified Contract

Issues #717 and #736 require executable source and actual batch commands to be
visible to the user so execution can be reviewed and command-blocking
extensions can be debugged. The associated commits bound long command/source
echoes so provenance does not dominate the result.

The upstream issues and commits do not require each visible command to repeat
source length, preview length, omitted length, truncation state, and a full
SHA-256. Those fields were added later by this fork's typed presentation policy
to make bounded echoes unambiguous and testable.

## Consequences For This Task

1. Actual executable source and actual batch command previews remain visible in
   text. Labels alone do not satisfy #717/#736.
2. A zero source/command preview budget cannot suppress executable provenance.
   Existing minimum/default/maximum parsing remains authoritative.
3. Long source or command previews remain bounded.
4. Stable digest and exact length/truncation facts remain available for
   provenance, but their visible layout may be consolidated. Repeating the
   verbose five-field suffix after every batch command is not an upstream
   requirement.
5. `content[0].text` remains self-sufficient for hosts that ignore MCP
   `structuredContent`. Structured fields may mirror provenance but cannot be
   the only place where a user can determine what executable source ran.
6. The Codex host-owned `Called` argument display is useful corroborating
   evidence but cannot be the only implementation of the contract because
   other MCP clients render arguments differently.

## Planning Decision

Use a compact execution-proof grammar:

- always show bounded executable source/commands;
- emit provenance accounting only when it communicates a material condition,
  especially truncation;
- consolidate repeated batch accounting into one bounded proof rather than a
  verbose suffix per command;
- preserve exact typed provenance internally and in compatible structured
  output without making structured output a compatibility dependency.
