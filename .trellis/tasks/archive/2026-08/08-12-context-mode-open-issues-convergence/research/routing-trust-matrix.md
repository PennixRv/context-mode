# Routing And Trust Matrix

This matrix is the single semantic source for the Skill, Hook guidance, tool
descriptions, and tests. It describes call intent, not a blanket preference for
one transport.

| Call class | Route | Persistence | Component behavior | Root-owned handoff |
| --- | --- | --- | --- | --- |
| Trellis/Governance lifecycle, wait, task state, or event notification | Original protocol | Original protocol | Pass through without context-mode wrapping; preserve native status/error fields | Root/Governance verifies global routing |
| CodeGraph symbol, architecture, call relation, execution path, impact or review location with an approved index | CodeGraph first | CodeGraph policy | Skill tells the caller to query the approved index; context-mode does not replace it with a source scan because output is long | Root AGENTS enables/approves the index |
| Fast Context candidate retrieval for genuinely ambiguous local questions | Fast Context after local tools and CodeGraph | None until local verification | Candidate is not an authority and is not sent to `ctx_index` by default | Root workflow controls external retrieval |
| Bounded structured MCP result with a dedicated protocol and native errors | Original tool; large result may be written by that tool | Original tool storage | No second `ctx_execute` wrapper; optional `ctx_execute_file` analysis starts from the host-approved artifact | Root workflow confirms exception |
| Interactive command, event wait, process/lifecycle control, or command requiring live terminal semantics | Original tool | Original tool | Preserve interaction, notifications, exit/error categories | Root workflow confirms exception |
| Tests, logs, long diffs, recursive full-text search, dependency/build output, large files, unbounded local command | context-mode execution/aggregation | Default `none`; explicit verified persistence only | Keep repeat-call aggregation, bounded presentation, same-batch query scope, truthful status | Root workflow enforces broad policy |
| Large structured result without an independent file/protocol | Original tool writes an artifact, then `ctx_execute_file` analyzes it | Default `none` unless verified artifact explicitly persisted | Never inline a large opaque result merely to route it | Root workflow confirms artifact convention |
| File mutation through execution tools, forbidden security/network behavior, or failed/timeout batch output | Explicit failure / native write or permission path | Never persist failed candidate | Preserve deny policy, host authorization, restricted isolation and error protocol | Root workflow owns global prohibition wording |
| `ctx_search` | Persistent FTS5 only | Read-only | Searches previously persisted verified/local content; never online, live-scan, relationship analysis or authoritative facts | Root workflow owns external-source policy |
| `ctx_index(path)` | Explicit local file/directory indexing | Explicit user request; verification metadata required for external candidates | Does not default to whole-repository indexing; records bounded provenance and supports source purge | Root workflow owns trust confirmation |

## Trust Invariants

1. Execution output is request-local unless the caller supplies an explicit
   verified persistence request with typed provenance.
2. “Local” means verified in the current project/host context, not merely a
   string label or a caller-provided read-only flag.
3. A failed, timed-out, empty, title-only or stderr-only command has no
   searchable body and cannot be promoted to persistent FTS5.
4. Provenance is bounded metadata (`kind`, `reference`, verification state and
   content hash); raw credentials, URLs with embedded secrets and unbounded
   command output are not stored as provenance.
5. Restricted execution remains server-authoritative: missing or unproven
   isolation fails closed. The compatibility path may read host-authorized
   files, but it does not become a restricted sandbox.
