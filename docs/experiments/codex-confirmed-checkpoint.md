# Codex Confirmed Compaction Checkpoint

This experiment replaces the legacy Codex compact-resume snapshot path with a
small, Codex-only checkpoint protocol. It is not a replacement for Trellis,
context-mode's session database, or a long-term memory system.

## Lifecycle

The protocol requires this exact sequence for one session, turn, project, and
worktree identity:

```text
PreCompact(manual|auto) -> pending
PostCompact(same trigger) -> confirmed
SessionStart(source=compact) -> claimed
```

`PreCompact` writes an idempotent pending record. `PostCompact` confirms only
the matching pending record, so a failed or missing compaction never supplies
context to the replacement session. `SessionStart(source=compact)` atomically
claims the oldest confirmed record for that session and emits its context once.
The states are `pending`, `confirmed`, `claimed`, `expired`, and `invalid`.

`claimed` means the hook generated `additionalContext`; it does not prove that
the Codex host persisted it or that the model consumed it. Codex does not expose
an acknowledgement for either event, so host acceptance remains a separate
validation gate. The delivery-attestation gate below establishes high-confidence
behavioral evidence for that acceptance; it does not redefine the meaning of
`claimed`.

## Storage And Privacy

Each canonical project/worktree uses a separate SQLite database:

```text
$CODEX_HOME/context-mode/checkpoints/<project-sha256>--<worktree-sha256>.db
```

The database keeps independent checkpoint, signal, and transition tables. A
checkpoint stores only structured continuity evidence:

- Git HEAD, branch, status digest, and a bounded changed-path list.
- Prompt submission and selected tool-completion signals. Prompt text is never
  read. Tool records retain only the tool name, outcome, and SHA-256 of the
  serialized tool input.
- A bounded Trellis task pointer summary and artifact hashes.

The runtime does not store command text, patch text, file content, tool output,
error bodies, or Trellis artifact content. Pending and unclaimed confirmed
records expire after 24 hours. Signals, transitions, and checkpoints older than
30 days are removed during later hook activity.

The emitted context is a JSON code block prefaced as historical data, not
executable instructions. It is deterministically reduced to at most 1,200 UTF-8
bytes; the Codex hook declaration configures `additionalContextLimit` to 1,500.

## Trellis Bridge

The bridge is read-only. It reads the session-specific Trellis runtime pointer
at `.trellis/.runtime/sessions/codex_<session-id>.json`, using the same Codex
key normalization as Trellis. It accepts normal `.trellis/tasks/<task>` task
pointers, validates task and artifact paths under the canonical `.trellis`
root, and records only task metadata plus SHA-256 values for `prd.md`,
`design.md`, `implement.md`, and `check.md`.

It never invokes the Trellis CLI, imports Trellis Python code, reads artifact
content into the checkpoint, or falls back to an unrelated single runtime
session file.

## Hook Wiring

The plugin and standalone Codex configuration use these additional handlers:

```text
UserPromptSubmit                         -> checkpoint signal
PostToolUse(Bash|apply_patch|Edit|Write) -> checkpoint signal
PreCompact(manual|auto)                  -> pending checkpoint
PostCompact(manual|auto)                 -> confirmed checkpoint
SessionStart(compact)                    -> one-time checkpoint context
```

The legacy `SessionStart` handler remains responsible only for `startup`,
`resume`, and `clear`. It deliberately returns no legacy compact snapshot for
`source=compact`.

## Verification

Local regression coverage includes:

- `tests/checkpoint/runtime.test.ts` for state transitions, expiry, cleanup,
  project/worktree/session isolation, FIFO claiming, privacy, Trellis pointer
  containment, and the output cap.
- `tests/hooks/codex-checkpoint-lifecycle.test.ts` for generated-hook lifecycle
  behavior and legacy compact-handler inertness.
- Codex adapter, manifest, CLI dispatch, and generated-bundle drift tests.

Synthetic hook stdin proves only the runtime contract and does not pass this
gate. A real-host gate must run the locally packaged plugin in a disposable Git
repository and disposable `CODEX_HOME`, exercising both manual and host-driven
automatic compaction. The normal `$CODEX_HOME` remains unchanged.

### Host Gate Status: Passed

On 2026-07-30, Codex CLI `0.145.0` App Server passed both paths against the
current working-tree package installed through a temporary local marketplace.
The disposable profile used the selected custom provider table, file-backed
authentication cache, model, reasoning effort, context window, and normal
auto-compact setting copied from the local user configuration. It deliberately
excluded normal plugins, MCP servers, global hooks, history, and preferences.
`hooks/list` discovered all checkpoint handlers, and their current hashes were
reviewed and trusted through the CLI `/hooks` interface. The test did not rely
on `--dangerously-bypass-hook-trust`.

The manual gate completed a real model turn with a `Bash` tool call, then
observed `contextCompaction` `item/started` and `item/completed` after
`thread/compact/start`. Codex runs `SessionStart(source=compact)` before the
next model request, not synchronously with the compaction request, so the gate
also ran one normal continuation turn. Its per-project/worktree checkpoint
database recorded exactly:

```text
pending   -> pending    created
pending   -> confirmed  postcompact_succeeded
confirmed -> claimed    sessionstart_context_emitted
```

The automatic gate used only a test-process override of
`model_auto_compact_token_limit=2000`; the provider configuration and
credentials were otherwise identical. It appended bounded neutral history with
`thread/inject_items` and started normal turns without calling
`thread/compact/start`. `config/read` confirmed the effective 2,000-token
threshold and the selected provider. The first post-injection turn reported
more than 21,000 input tokens but did not compact; the next normal scheduling
boundary triggered native `PreCompact(auto)`, `PostCompact(auto)`, and
`SessionStart(compact)` during the same turn. The checkpoint was `claimed` with
the same three transition reasons above and `trigger = auto`.

For both gates, the persisted payload contained neither test prompt nor raw
command or injected-history text, tool output, `sk-`-style text, or Trellis
artifact bodies. The manual path retained one 64-character SHA-256 digest for
the `Bash` input; the automatic path retained no tool content. The public App
Server does not expose an acknowledgement that the model consumed emitted
`additionalContext`, so `claimed` means that Codex invoked and completed the
context-emitting `SessionStart` hook exactly once, not that model consumption
was independently observed.

### Delivery Attestation Status: Passed

On 2026-07-30, the source-tree
`scripts/validate-codex-checkpoint-delivery.mjs` gate passed both `manual` and
`auto` paths against the same isolated provider profile and installed package.
The profile was constructed with only the selected model/provider fields, the
complete selected provider table, and the file-backed authentication cache. It
did not copy the normal profile's plugins, MCP servers, global hooks, history,
or preferences. The gate verified the installed plugin's ten hook definitions
through `hooks/list`, recorded trust for their exact current hashes in the
isolated `hooks.state`, and reread them as `trusted`; it did not use
`--dangerously-bypass-hook-trust`.

For each path, the gate requires all of the following:

- Native `contextCompaction` starts and completes. The automatic path confirms
  the test-process-only 2,000-token threshold through `config/read` and never
  calls `thread/compact/start`.
- Plugin-source `preCompact`, `postCompact`, and `sessionStart` hooks report
  completion. The matching checkpoint records exactly `created`,
  `postcompact_succeeded`, and `sessionstart_context_emitted`, ending in
  `claimed` with the requested trigger.
- The first post-compaction model turn receives an instruction that contains no
  checkpoint ID: it must reply with exactly the random `checkpoint_id` from the
  historical context. The persisted report contains only the response and ID
  SHA-256 values, which must match, rather than either raw value.
- The attestation turn may contain only `userMessage`, `reasoning`,
  `agentMessage`, and, for automatic compaction, `contextCompaction` items.
  Any Bash, MCP, or other tool item fails the gate, preventing the model from
  reading the SQLite database to obtain the ID.

Both reports passed: manual used the normal 240,000-token setting, automatic
used the temporary 2,000-token override, and both returned a 36-byte checkpoint
ID whose response hash equaled the database ID hash. This is strong evidence
that Codex delivered the hook's `additionalContext` to a model request and that
the model could read the injected ID. It is still not proof of the model's
private reasoning, durable internal state, or semantic use of every continuity
field; the public App Server exposes no stronger consumption acknowledgement.

For a dirty working tree, do not validate through the repository's normal
`source: "url", url: "./"` marketplace entry: Codex materializes that source
from Git `HEAD`, so it cannot contain uncommitted changes. Package the working
tree and install it through a temporary local marketplace whose entry uses
`source: "local"` and `path: "./plugins/context-mode"`; this exercises the
exact installable payload without committing experimental work.
