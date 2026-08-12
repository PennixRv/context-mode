---
name: ctx-index
description: |
  Index a local file or directory into context-mode's persistent FTS5 knowledge base
  so future ctx_search calls can retrieve focused snippets without rereading raw files.
  Trigger: /context-mode:ctx-index
user-invocable: true
---

# Context Mode Index

Explicitly retain selected, locally verified content for later search.

## Instructions

1. Prefer the `ctx_index` MCP tool when it is available.
2. Ask for a path only if the user did not provide one and the current project root is ambiguous.
3. Use `path`, not large inline `content`, so file bytes do not enter the conversation.
4. Do not index an entire source repository by default. If the user explicitly requests a selected directory, pass conservative bounds and a clear source label:

```javascript
ctx_index({
  path: ".",
  source: "project:<name>",
  maxDepth: 5,
  maxFiles: 200
})
```

5. If MCP tools are unavailable, fall back to the CLI:

```bash
context-mode index . --source project:<name>
```

6. Report the indexed source label, file count or section count, and the matching search command:

```javascript
ctx_search({ source: "project:<name>", queries: ["..."] })
```

## Safety

- Do not persist unverified Fast Context, web, external API, or other external candidates. Verify a saved local artifact first and require an explicit retention request.
- Do not index dependency directories, build outputs, secrets, or generated artifacts.
- Do not index controlled RecoveryBrief state. `ctx_index` refuses Trellis runtime files, Trellis `recovery-brief.json`, and `.context-mode/recovery-provider.json` or `.context-mode/recovery-brief.json`, including when indexing a directory.
- Prefer `--exclude` or `exclude` for project-specific noisy paths.
- For broad repos, ask the user before raising `maxFiles` above 500.
