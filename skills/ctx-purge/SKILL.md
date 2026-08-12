---
name: ctx-purge
description: |
  Purge the context-mode knowledge base. Permanently deletes all indexed content
  and resets session stats. This is destructive and cannot be undone.
  Trigger: /context-mode:ctx-purge
user-invocable: true
---

# Context Mode Purge

Permanently deletes indexed or session data for this project. Three scopes are supported:

- **Project scope** (`scope: "project"`): wipes EVERYTHING — knowledge base, all session DB rows for every session, events markdown, and stats.
- **Session scope** (`sessionId: "<id>"` or `scope: "session"`): wipes ONLY the matching session's rows + FTS5 chunks. Sibling sessions, project stats, and the FTS5 store file are preserved.
- **Source scope** (`scope: "source", source: "<exact label>"`): wipes one exact FTS5 source and its chunks. Session events and stats are preserved.

## Instructions

1. **Decide the scope first** with the user:
   - "Wipe just one session?" → ask for the `sessionId`.
   - "Wipe the whole project?" → confirm scope:'project' (this is the destructive, irreversible default).
2. **Warn the user about scope:'project'**. Everything will be deleted:
   - FTS5 knowledge base (all indexed content from `ctx_index`, `ctx_fetch_and_index`, `ctx_batch_execute`)
   - Session events DB (analytics, metadata, resume snapshots) for ALL sessions in the project
   - Session events markdown file
   - In-memory session stats + persisted stats file
3. Call the `mcp__context-mode__ctx_purge` MCP tool with the chosen parameters:
   - Scoped: `{ confirm: true, sessionId: "<id>" }` — implies scope:'session'.
   - Source: `{ confirm: true, scope: "source", source: "<exact label>" }`.
   - Project: `{ confirm: true, scope: "project" }` — explicit destructive form.
   - Bare `{ confirm: true }` still works but emits a deprecation warning. Prefer the explicit forms.
4. Report the result to the user — the response lists exactly what was deleted and (for scoped purges) confirms that other sessions and project stats were preserved.

## Schema rules

- `confirm: true` is always required.
- `sessionId` and `scope: "project"` together is REJECTED as ambiguous (the sessionId implies session scope; combining with project scope contradicts intent).
- `scope: "session"` without `sessionId` throws — sessionId is required.
- `scope: "source"` requires `source` and cannot be combined with `sessionId`.

## When to Use

- **Scoped (per-session)**: scratch acceptance scenarios, drill replays, isolating a polluted session without losing the main working session's stats.
- **Source**: remove one explicitly persisted execution or verified external candidate without wiping unrelated knowledge.
- **Project**: KB contains stale or incorrect content polluting search results, switching between unrelated projects in the same session, completely fresh start.

## Important

- `ctx_purge` is the supported way to delete persistent indexed or session data.
- `ctx_stats` is read-only — shows statistics only.
- `/clear` and `/compact` do NOT affect any context-mode data.
- There is no undo. Re-index content if you need it again.
