# Compact MCP presentation contract

## Goal

Redesign context-mode's MCP response presentation so every tool returns the
smallest visible wrapper that still lets the model use the result correctly,
diagnose failures, and verify security-sensitive execution. Preserve all
execution, indexing, search, recovery, audit, configuration, and protocol
semantics. Replace existing presentation design where incremental formatting
changes would retain avoidable repetition.

The user-visible outcome is materially shorter context-mode output after the
host-owned tool-call display, with commands and actionable results prioritized
over repeated accounting metadata and inventories.

## Background

- `ctx_batch_execute` currently returns an execution summary followed by a
  per-command `## Commands` inventory, a per-section `## Indexed Sections`
  inventory, query matches, and follow-up tips.
- Each command inventory entry can repeat source length, preview length,
  omitted length, truncation state, and SHA-256 even though Codex already shows
  the full MCP input in its host-owned `Called` region.
- The visible `[source=..., preview=..., omitted=..., truncated=...,
  sha256=...]` suffix describes presentation of an original command or source;
  it is not an inventory of invoked Skills.
- Codex owns the `Called context-mode.<tool>({...})` display and its input
  limits. This repository can change only the MCP result returned after that
  display.
- The v1.0.185 source/command echo policy preserves the upstream #717/#736
  audit contract: executable source cannot be suppressed with zero, while
  optional searchable terms may be disabled with zero.
- The authorized baseline is clean `devel` at
  `c7a098606518a53bfb9a43c0ca11caceb5bd4ed4`, including the remote-only
  `stats.json` update after v1.0.185.

## Requirements

### R1. Complete MCP presentation inventory

- Audit every registered context-mode MCP tool and every meaningful response
  class: success, empty result, bounded/truncated result, validation failure,
  execution failure, security refusal, destructive confirmation, and recovery
  state conflict where applicable.
- Record the current visible sections, line count, character count, duplicated
  facts, required next-action information, and owning implementation path.
- Cover execution, batch execution, file execution, indexing, fetch/index,
  search, diagnostics, statistics, checkpoint reporting, recovery brief,
  purge, upgrade, and insight tools.

### R2. Shared minimal presentation contract

- Define one typed presentation contract that distinguishes actionable result
  content from optional wrapper, inventory, provenance, audit, warning, error,
  and next-action content.
- Default visible output MUST be minimal but sufficient; fixed line limits may
  bound wrapper sections but MUST NOT truncate actionable query matches,
  failures, safety explanations, or recovery conflict details below what is
  needed to use the tool correctly.
- Shared rendering MUST remove meaningful duplication across tools without
  forcing unlike tools into an ambiguous one-size-fits-all string.
- Existing designs may be replaced when doing so produces a clearer and more
  testable contract than adding format-specific exceptions.

### R3. Compact command and index presentation

- `ctx_batch_execute` MUST not repeat the verbose
  `[source=..., preview=..., omitted=..., truncated=..., sha256=...]` suffix on
  every visible command entry in its default response.
- Its execution and inventory wrapper SHOULD fit in at most two non-empty lines
  before actionable query results in the normal queried path.
- Command identity MUST remain visible through bounded labels or bounded command
  previews. Internal full commands, per-command security checks, hashes,
  truncation facts, indexed bytes, section mappings, and query scope MUST remain
  correct and available wherever the protocol or later retrieval requires them.
- When no inline query results are requested, the response MUST still provide
  enough bounded information to discover and search indexed content.

### R4. Preserve source echo and audit semantics

- `ctx_execute`, `ctx_execute_file`, and `ctx_batch_execute` MUST preserve the
  #717/#736 executable-source audit guarantee, stable digest, original length,
  omission/truncation semantics, language, and configured presentation bounds.
- Moving, combining, or shortening visible accounting is allowed only when
  tests prove that executable source cannot be hidden, confused with another
  source, or made unauditable.
- `CONTEXT_MODE_CODE_ECHO_MAX`, `CONTEXT_MODE_COMMAND_ECHO_MAX`,
  `CONTEXT_MODE_TITLE_PREVIEW_MAX`, `CONTEXT_MODE_SEARCHABLE_TERMS_MAX`, and
  `CONTEXT_MODE_RESULT_PREVIEW_MAX` MUST retain their existing meanings,
  defaults, minimums, environment forwarding, and zero-value contracts unless
  the final design explicitly proves a backward-compatible consolidation.

### R5. No functional or safety regression

- Do not change command execution, sandbox selection, project-boundary checks,
  per-command batch policy evaluation, network policy, process policy, FTS5
  persistence, ranking, cache behavior, stale-source detection, recovery CAS,
  checkpoint lifecycle, destructive confirmation, or MCP schemas merely to
  shorten visible text.
- Security refusals and operational errors MUST remain explicit, deterministic,
  and actionable. Concision MUST NOT turn a fail-closed condition into an
  unexplained empty result.
- Structured MCP metadata and content types MUST remain compatible with all
  supported host adapters.

### R6. Measured reduction and configurability

- Establish deterministic before/after fixtures for each tool family and
  report visible characters and non-empty lines separately for wrapper and
  actionable content.
- Default responses MUST show material aggregate reduction, and the common
  queried `ctx_batch_execute` wrapper MUST meet the two-line target.
- Configuration changes MUST continue to affect only their documented bounded
  fields. The design MUST not require users to set environment variables to get
  the new compact default.

### R7. Compatibility, documentation, and release

- Preserve behavior across Codex, Claude Code, Cursor, OpenCode, OpenClaw,
  Copilot, Gemini, Kimi, Kiro, Pi, Qwen, and other shipped adapters to the extent
  covered by repository contracts.
- Document the new response anatomy, the distinction between host-owned
  `Called` input and context-mode-owned MCP output, configuration behavior, and
  any intentional compatibility changes.
- Run the complete repository quality and release gates, then publish the next
  available patch using the existing source commit, direct-child attestation
  evidence commit, annotated tag, Release workflow, and asset-verification
  contracts. Never overwrite an occupied version or tag.

## Out of Scope

- Changing or claiming to shorten the Codex host-owned `Called` tool-input
  region.
- Removing information solely to meet an arbitrary global two-line total when
  that information is the tool's actionable result.
- Weakening restricted execution, security policy, audit provenance, recovery
  concurrency, or destructive-operation confirmation.
- Modifying the parent repository, `/home/penn/.codex`, Governance Plugin,
  sibling components, installed plugin caches, or parent Gitlinks.
- Publishing npm unless the repository's existing release contract for the
  selected patch explicitly requires it.

## Acceptance Criteria

- [ ] AC1: A checked-in matrix covers every registered MCP tool and its relevant
  response classes, with deterministic baseline and final character/line
  measurements.
- [ ] AC2: Normal queried `ctx_batch_execute` output presents execution and
  inventory wrapper in at most two non-empty lines before query matches and no
  longer emits a verbose per-command presentation-accounting suffix.
- [ ] AC3: Batch commands remain individually security-checked, fully executed,
  indexed, scoped, and retrievable; no command, section, query result, cache, or
  timeout behavior is lost.
- [ ] AC4: Execution tools preserve language, bounded executable-source preview,
  original/omitted/truncated semantics, stable digest, stdout/stderr or result,
  and #717/#736 zero/minimum behavior in success and failure paths.
- [ ] AC5: Search/index/fetch tools preserve ranking, content windows, source
  identity, freshness, cache, and follow-up retrieval while removing redundant
  wrapper and repeated tips.
- [ ] AC6: Diagnostic, statistics, checkpoint, recovery, purge, upgrade, and
  insight tools preserve every actionable status, warning, confirmation, error
  code, and next action while using the compact shared conventions.
- [ ] AC7: Tests cover default and configured presentation budgets, empty
  results, truncation, failures, security refusals, destructive confirmation,
  recovery conflicts, and all affected host adapters.
- [ ] AC8: Focused tests, full typecheck, build, full test suite, all bundle
  assertions, asymmetric/generated drift checks, marketplace build/verify,
  repeated-build stability, and real temporary-fixture MCP probes pass.
- [ ] AC9: Documentation and `.trellis/spec/` define the new executable
  presentation contract and explicitly state that Codex `Called` input remains
  host-owned and unchanged.
- [ ] AC10: Before release, the next patch version and remote tag are free;
  native Codex attestation, evidence topology, annotated tag, CI, Release
  workflow, downloaded assets, checksums, and offline marketplace verification
  all pass.
- [ ] AC11: The repository is clean on `devel`, local and remote refs agree, the
  Trellis task is archived, and the final report gives per-tool reductions,
  commits, tag topology, assets, supported platforms, and residual risks.

## Constraints

- Current main session is the sole implementation and checking authority. Do
  not use Codex native subagents, native multi-agent tools, or Trellis channel.
- Repository-maintained artifacts, code comments, commit messages, and release
  documentation use clear English.
- No credentials may be printed or committed. Native release probes may use the
  current authorized provider/auth only through the repository's disposable
  preflight mechanism.
- A final planning summary and a subsequent explicit user approval are required
  before `task.py start` and product-code edits.
