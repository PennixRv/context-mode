---
name: context-mode
description: |
  Use context-mode tools (ctx_execute, ctx_execute_file) instead of Bash/cat when processing
  large outputs. Triggers: "analyze logs", "summarize output", "process data",
  "parse JSON", "filter results", "extract errors", "check build output",
  "analyze dependencies", "process API response", "large file analysis",
  "page snapshot", "browser snapshot", "DOM structure", "inspect page",
  "accessibility tree", "Playwright snapshot",
  "run tests", "test output", "coverage report", "git log", "recent commits",
  "diff between branches", "list containers", "pod status", "disk usage",
  "fetch docs", "API reference", "index documentation",
  "call API", "check response", "query results",
  "find TODOs", "count lines", "codebase statistics", "security audit",
  "outdated packages", "dependency tree", "cloud resources", "CI/CD output".
  Use only for operations whose main risk is unbounded local output. Preserve
  direct calls to tools with lifecycle, interaction, or structured-result protocols.
---

# Context Mode: Bounded Large-Output Processing

## Routing Contract

<context_mode_logic>
  <mandatory_rule>
    Route by call semantics. Aggregate unbounded local output with context-mode;
    preserve direct protocol calls and verify external candidates locally before persistence.
  </mandatory_rule>
</context_mode_logic>

Use the original tool through its direct protocol when the call controls a
lifecycle, waits for an event, is interactive, returns bounded structured data,
or has dedicated status and error fields. This includes Trellis/Governance
dispatch and wait operations, Fast Context retrieval, CodeGraph exploration,
and other bounded MCP calls. Do not place them inside `ctx_execute`.

When the project has an approved `.codegraph/` index, use CodeGraph first for
symbols, architecture, call relationships, execution paths, and impact scope.
Potential output size is not a reason to replace CodeGraph with a context-mode
source scan. Use Fast Context only for genuinely ambiguous historical or legacy
location questions after local tools and CodeGraph cannot locate the answer;
its results are candidates until verified against current local files.

Use context-mode for tests, logs, long diffs, recursive full-text searches,
dependency or build output, large files, and other local commands with
unbounded text and no independent result protocol. For a large structured tool
result, prefer the original tool's file-output option and analyze that artifact
with `ctx_execute_file`.

Use the normal host tool directly for mutations, navigation, process control,
package installation, guaranteed-small observations, and forbidden operations
that must retain the host's permission or error protocol.

## Decision Tree

```
About to call a tool, run a command, or analyze a file?
│
├── Lifecycle/event wait, interactive action, bounded structured result, or dedicated errors?
│   └── Call the original tool through its direct protocol
│
├── Symbol, architecture, call-path, or impact question with approved .codegraph/?
│   └── Use CodeGraph, then verify important current facts in local files
│
├── Ambiguous historical/legacy location unresolved locally and by CodeGraph?
│   └── Use Fast Context, then verify the candidate locally; do not persist by default
│
├── Large structured result supports writing an artifact?
│   └── Original tool writes file → ctx_execute_file for one-shot analysis
│
├── Tests, logs, recursive search, long diff, build output, or other unbounded local text?
│   └── Use ctx_execute, ctx_batch_execute, or ctx_execute_file
│
├── Using Playwright for a large snapshot, console, or network result?
│   └── Use filename to save the result, then:
│       browser_snapshot(filename) → ctx_index(path) or ctx_execute_file(path)
│       browser_console_messages(filename) → ctx_execute_file(path)
│       browser_network_requests(filename) → ctx_execute_file(path)
│
├── Mutation, navigation, process control, install, or guaranteed-small observation?
│   └── Use the host's native tool
│
└── Reading a file to analyze/summarize (not edit)?
    └── Use ctx_execute_file (file loads into FILE_CONTENT, not context)
```

## When to Use Each Tool

| Situation | Tool | Example |
|-----------|------|---------|
| Hit an API endpoint | `ctx_execute` | `fetch('http://localhost:3000/api/orders')` |
| Run CLI that returns data | `ctx_execute` | `gh pr list`, `aws s3 ls`, `kubectl get pods` |
| Run tests | `ctx_execute` | `npm test`, `pytest`, `go test ./...` |
| Git operations | `ctx_execute` | `git log --oneline -50`, `git diff HEAD~5` |
| Docker/K8s inspection | `ctx_execute` | `docker stats --no-stream`, `kubectl describe pod` |
| Read a log file | `ctx_execute_file` | Parse access.log, error.log, build output |
| Read a data file | `ctx_execute_file` | Analyze CSV, JSON, YAML, XML |
| Read source code to analyze | `ctx_execute_file` | Count functions, find patterns, extract metrics |
| Fetch trusted web docs for explicit persistent recall | `ctx_fetch_and_index` | Only after the user selects the source and requests retention |
| Playwright snapshot | `browser_snapshot(filename)` → `ctx_index(path)` → `ctx_search` | Save to file, index server-side, query |
| Playwright snapshot (one-shot) | `browser_snapshot(filename)` → `ctx_execute_file(path)` | Save to file, extract in sandbox |
| Playwright console/network | `browser_*(filename)` → `ctx_execute_file(path)` | Save to file, analyze in sandbox |
| MCP output (already in context) | Use directly | Don't re-index — it's already loaded |
| Large structured MCP output | Original tool writes file → `ctx_execute_file` | Preserve the original protocol and analyze its artifact |
| Wipe indexed KB content | `ctx_purge(confirm: true)` | Permanently deletes all indexed content |

## Automatic Triggers

Use context-mode for these when their output is unbounded and no dedicated
structured protocol already solves the request:

- **API debugging**: "hit this endpoint", "call the API", "check the response", "find the bug in the response"
- **Log analysis**: "check the logs", "what errors", "read access.log", "debug the 500s"
- **Test runs**: "run the tests", "check if tests pass", "test suite output"
- **Git history**: "show recent commits", "git log", "what changed", "diff between branches"
- **Data inspection**: "look at the CSV", "parse the JSON", "analyze the config"
- **Infrastructure**: "list containers", "check pods", "S3 buckets", "show running services"
- **Dependency audit**: "check dependencies", "outdated packages", "security audit"
- **Build output**: "build the project", "check for warnings", "compile errors"
- **Code metrics**: "count lines", "find TODOs", "function count", "analyze codebase"
- **Explicit documentation corpus**: fetch and index only when persistent recall is requested

## Language Selection

| Situation | Language | Why |
|-----------|----------|-----|
| HTTP/API calls, JSON | `javascript` | Native fetch, JSON.parse, async/await |
| Data analysis, CSV, stats | `python` | csv, statistics, collections, re |
| Shell commands with pipes | `shell` | grep, awk, jq, native tools |
| File pattern matching | `shell` | find, wc, sort, uniq |

## Search Query Strategy

- BM25 uses **OR semantics** — results matching more terms rank higher automatically
- Use 2-4 specific technical terms per query
- **Always use `source` parameter** when multiple docs are indexed to avoid cross-source contamination
  - Partial match works: `source: "Node"` matches `"Node.js v22 CHANGELOG"`
- **Always use `queries` array** — batch ALL search questions in ONE call:
  - `ctx_search(queries: ["transform pipe", "refine superRefine", "coerce codec"], source: "Zod")`
  - NEVER make multiple separate ctx_search() calls — put all queries in one array

## External Documentation

- Keep web, Fast Context, and external API calls on their original direct protocol.
- For one-shot analysis, have the original tool write a host-approved artifact and use `ctx_execute_file`; do not persist the candidate.
- Use `ctx_fetch_and_index` only when the user explicitly requests persistent recall from a selected trusted URL. For GitHub-hosted projects, prefer a commit-pinned raw URL and scope later `ctx_search` calls with `source`.
- External candidates are not authoritative facts. Verify them against current local files before using them in code, task state, or persistent project knowledge.

## Critical Rules

For Trellis project-semantic continuity, use the project-local `trellis-recovery-brief-sync` skill at its approved semantic gates. Use low-level `ctx-recovery-brief` only through that coordinator protocol or for an explicit inspection, repair, force-refresh, or formal-handoff request. Ordinary large-output routing, compact events, and resumed sessions are not RecoveryBrief write triggers.

1. **Always console.log/print your findings.** stdout is all that enters context. No output = wasted call.
2. **Write analysis code, not just data dumps.** Don't `console.log(JSON.stringify(data))` — analyze first, print findings.
3. **Be specific in output.** Print bug details with IDs, line numbers, exact values — not just counts.
4. **For files you need to EDIT**: Use the normal Read tool. context-mode is for analysis, not editing.
5. **Route by semantics, not a whitelist**: Preserve direct lifecycle, wait, interactive, structured-result, CodeGraph, Fast Context, Trellis, and Governance protocols. Use context-mode for unbounded local textual output without an independent protocol.
6. **Never use `ctx_index(content: large_data)`.** Use `ctx_index(path: ...)` to read files server-side. The `content` parameter sends data through context as a tool parameter — use it only for small inline text.
7. **Always use `filename` parameter** on Playwright tools (`browser_snapshot`, `browser_console_messages`, `browser_network_requests`). Without it, the full output enters context.
8. **Don't re-index data already in context.** If an MCP tool returned data in a previous response, it's already loaded — use it directly or save to file first.

## Sandboxed Data Workflow

<sandboxed_data_workflow>
  <critical_rule>
    When using tools that support saving to a file: ALWAYS use the 'filename' parameter.
    NEVER return large raw datasets directly to context.
  </critical_rule>
  <workflow>
    LargeDataTool(filename: "path") → ctx_execute_file(path) for one-shot analysis
    Explicit verified retention only: ctx_index(path: "path") → ctx_search()
  </workflow>
</sandboxed_data_workflow>

This is the universal pattern for context preservation regardless of
the source tool (Playwright, GitHub API, AWS CLI, etc.).

## Examples

### Debug an API endpoint
```javascript
const resp = await fetch('http://localhost:3000/api/orders');
const { orders } = await resp.json();

const bugs = [];
const negQty = orders.filter(o => o.quantity < 0);
if (negQty.length) bugs.push(`Negative qty: ${negQty.map(o => o.id).join(', ')}`);

const nullFields = orders.filter(o => !o.product || !o.customer);
if (nullFields.length) bugs.push(`Null fields: ${nullFields.map(o => o.id).join(', ')}`);

console.log(`${orders.length} orders, ${bugs.length} bugs found:`);
bugs.forEach(b => console.log(`- ${b}`));
```

### Analyze test output
```shell
npm test 2>&1
echo "EXIT=$?"
```

### Check GitHub PRs
```shell
gh pr list --json number,title,state,reviewDecision --jq '.[] | "\(.number) [\(.state)] \(.title) — \(.reviewDecision // "no review")"'
```

### Read and analyze a large file
```python
# FILE_CONTENT is pre-loaded by ctx_execute_file
import json
data = json.loads(FILE_CONTENT)
print(f"Records: {len(data)}")
# ... analyze and print findings
```

## Browser & Playwright Integration

**When a task involves Playwright snapshots, screenshots, or page inspection, ALWAYS route through file → sandbox.**

Playwright `browser_snapshot` returns 10K–135K tokens of accessibility tree data. Calling it without `filename` dumps all of that into context. Passing the output to `ctx_index(content: ...)` sends it into context a SECOND time as a parameter. Both are wrong.

**The key insight**: `browser_snapshot` has a `filename` parameter that saves to file instead of returning to context. `ctx_index` has a `path` parameter that reads files server-side. `ctx_execute_file` processes files in a sandbox. **None of these touch context.**

### Workflow A: Snapshot → File → Index → Search (multiple queries)

```
Step 1: browser_snapshot(filename: "/tmp/playwright-snapshot.md")
        → saves to file, returns ~50B confirmation (NOT 135K tokens)

Step 2: ctx_index(path: "/tmp/playwright-snapshot.md", source: "Playwright snapshot")
        → reads file SERVER-SIDE, indexes into FTS5, returns ~80B confirmation

Step 3: ctx_search(queries: ["login form email password"], source: "Playwright")
        → returns only matching chunks (~300B)
```

**Total context: ~430B** instead of 270K tokens. Real 99% savings.

### Workflow B: Snapshot → File → Execute File (one-shot extraction)

```
Step 1: browser_snapshot(filename: "/tmp/playwright-snapshot.md")
        → saves to file, returns ~50B confirmation

Step 2: ctx_execute_file(path: "/tmp/playwright-snapshot.md", language: "javascript", code: "
          const links = [...FILE_CONTENT.matchAll(/- link \"([^\"]+)\"/g)].map(m => m[1]);
          const buttons = [...FILE_CONTENT.matchAll(/- button \"([^\"]+)\"/g)].map(m => m[1]);
          const inputs = [...FILE_CONTENT.matchAll(/- textbox|- checkbox|- radio/g)];
          console.log('Links:', links.length, '| Buttons:', buttons.length, '| Inputs:', inputs.length);
          console.log('Navigation:', links.slice(0, 10).join(', '));
        ")
        → processes in sandbox, returns ~200B summary
```

**Total context: ~250B** instead of 135K tokens.

### Workflow C: Console & Network (save to file if large)

```
browser_console_messages(level: "error", filename: "/tmp/console.md")
→ ctx_execute_file(path: "/tmp/console.md", ...) or ctx_index(path: "/tmp/console.md", ...)

browser_network_requests(includeStatic: false, filename: "/tmp/network.md")
→ ctx_execute_file(path: "/tmp/network.md", ...) or ctx_index(path: "/tmp/network.md", ...)
```

### CRITICAL: Why `filename` + `path` is mandatory

| Approach | Context cost | Correct? |
|----------|-------------|----------|
| `browser_snapshot()` → raw into context | **135K tokens** | NO |
| `browser_snapshot()` → `ctx_index(content: raw)` | **270K tokens** (doubled!) | NO |
| `browser_snapshot(filename)` → `ctx_index(path)` → `ctx_search` | **~430B** | YES |
| `browser_snapshot(filename)` → `ctx_execute_file(path)` | **~250B** | YES |

### Key Rule

> **ALWAYS use `filename` parameter when calling `browser_snapshot`, `browser_console_messages`, or `browser_network_requests`.**
> Then process via `ctx_index(path: ...)` or `ctx_execute_file(path: ...)` — never `ctx_index(content: ...)`.
>
> Data flow: **Playwright → file → server-side read → context**. Never: **Playwright → context → ctx_index(content) → context again**.

## Subagent Usage

Subagents automatically receive context-mode tool routing via a PreToolUse hook. You do NOT need to manually add tool names to subagent prompts — the hook injects them. Just write natural task descriptions.

## Anti-Patterns

- Using `curl http://api/endpoint` via Bash → 50KB floods context. Use `ctx_execute` with fetch instead.
- Using `cat large-file.json` via Bash → entire file in context. Use `ctx_execute_file` instead.
- Using `gh pr list` via Bash → raw JSON in context. Use `ctx_execute` with `--jq` filter instead.
- Piping Bash output through `| head -20` → you lose the rest. Use `ctx_execute` to analyze ALL data and print summary.
- Narrowing `ctx_execute` output upstream of capture → `ctx_execute` captures, `ctx_search` filters; merging the layers drops data that the index never sees. See `references/anti-patterns.md` §8.
- Running `npm test` via Bash → full test output in context. Use `ctx_execute` to capture and summarize.
- Calling `browser_snapshot()` WITHOUT `filename` parameter → 135K tokens flood context. **Always** use `browser_snapshot(filename: "/tmp/snap.md")`.
- Calling `browser_console_messages()` or `browser_network_requests()` WITHOUT `filename` → entire output floods context. **Always** use the `filename` parameter.
- Passing ANY large data to `ctx_index(content: ...)` → data enters context as a parameter. **Always** use `ctx_index(path: ...)` to read server-side. The `content` parameter should only be used for small inline text you're composing yourself.
- Calling an MCP tool (Context7 `query-docs`, GitHub API, etc.) then passing the response to `ctx_index(content: response)` → **doubles** context usage. The response is already in context — use it directly or save to file first.
- Ignoring `browser_navigate` auto-snapshot → navigation response includes a full page snapshot. Don't rely on it for inspection — call `browser_snapshot(filename)` separately.
- Expecting `ctx_stats` to reset or wipe anything → `ctx_stats` is read-only (shows stats only). Use `ctx_purge(confirm: true)` to permanently delete all indexed content.

## Reference Files

- [JavaScript/TypeScript Patterns](./references/patterns-javascript.md)
- [Python Patterns](./references/patterns-python.md)
- [Shell Patterns](./references/patterns-shell.md)
- [Anti-Patterns & Common Mistakes](./references/anti-patterns.md)
