# Routing And Trust Matrix

| Call semantics | Route | Persistence |
| --- | --- | --- |
| Lifecycle control, event wait, interaction, bounded structured result, or dedicated error protocol | Original tool direct protocol | Original protocol only |
| Approved CodeGraph symbol, architecture, relationship, execution-path, or impact query | CodeGraph first; verify current facts locally | CodeGraph policy |
| Ambiguous historical or legacy retrieval after local tools and CodeGraph fail | Fast Context, then local verification | None by default |
| Test, log, long diff, recursive full-text search, build/dependency output, large local file | context-mode execution or aggregation | Request-local by default |
| Large structured result with file-output support | Original tool writes artifact, then `ctx_execute_file` | Request-local by default |
| Mutation, forbidden behavior, failed/timeout output | Native permission/error path or explicit failure | Never persist failed output |
| `ctx_search` | Previously persisted FTS5 content only | Read-only |
| `ctx_index(path)` | Explicit local file or directory indexing | Explicit verified request |

`ctx_search` is not online search, a live repository scan, code-relationship
analysis, or an authoritative project fact source. `ctx_index` is not the
default whole-repository indexer. External candidates must be verified against
current local content before they can be explicitly persisted or used in
Issue, Trellis, configuration, or code conclusions.
