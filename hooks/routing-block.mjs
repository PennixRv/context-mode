/**
 * Shared routing block for context-mode hooks.
 * Single source of truth — imported by pretooluse.mjs and sessionstart.mjs.
 *
 * Factory functions accept a tool namer `t(bareTool) => platformSpecificName`
 * so each platform gets correct tool names in guidance messages.
 *
 * Backward compat: static exports (ROUTING_BLOCK, READ_GUIDANCE, etc.)
 * default to claude-code naming convention.
 */

import { createToolNamer } from "./core/tool-naming.mjs";

// ── Factory functions ─────────────────────────────────────

export function createRoutingBlock(t, options = {}) {
  const { includeCommands = true, toolSearchBootstrap = false } = options;
  return `
<context_window_protection>
  <priority_instructions>
    Every byte a tool returns enters your conversation memory and costs reasoning capacity for the rest of the session. The context-mode tools let you do the work in a sandbox and surface only the derived answer — the raw bytes stay out. Think-in-Code: program the analysis, do not compute it by reading raw data into your conversation.
  </priority_instructions>
${toolSearchBootstrap ? `
  <deferred_tool_bootstrap>
    The context-mode tools below may be DEFERRED in your harness — their schemas are not loaded yet, so calling them directly fails (e.g. "tool not found" / InputValidationError). Load them ONCE before your first ctx_* call:
    ToolSearch(query: "select:${t("ctx_batch_execute")},${t("ctx_search")},${t("ctx_execute")},${t("ctx_execute_file")},${t("ctx_fetch_and_index")}")
    After that they are callable. If any ctx_* call fails as not-found, ToolSearch it and retry — do NOT fall back to Bash/Read just because the schema was not loaded yet.
  </deferred_tool_bootstrap>
` : ''}
  <tool_selection_hierarchy>
    0. MEMORY: ${t("ctx_search")}(sort: "timeline")
       - Query missing historical decisions or errors when needed. Continue from sufficient current context without repeating startup or state checks; captured history is not current authority.
    1. GATHER: ${t("ctx_batch_execute")}(commands, queries)
       - Runs selected independent shell commands in parallel, auto-indexes each output, and (when queries are passed) returns matching sections in the same round trip. Choose the evidence source first: an approved symbol graph for structure, exact text for literals, or bounded semantic search for candidates without code anchors. This executor does not dispatch other MCP tools or replace a code index.
       - Each command: {label: "section header", command: "shell command"}; the label becomes the FTS5 chunk title — descriptive labels improve search.
    2. FOLLOW-UP: ${t("ctx_search")}(queries: ["q1", "q2", ...])
       - Multiple related questions about anything already indexed (your captures + session memory). Batch every question in one array; the ranking pipeline runs per-query and the round-trip cost is paid once.
    3. PROCESSING: ${t("ctx_execute")}(language, code) | ${t("ctx_execute_file")}(path, language, code)
       - Derive answers FROM data: filter, count, aggregate, parse, transform. Only what you console.log() enters your conversation; the raw bytes stay in the sandbox.
  </tool_selection_hierarchy>

  <when_not_to_use>
    - Local text reads, exact searches and equivalent non-interactive commands default to ${t("ctx_execute_file")}, ${t("ctx_execute")} or ${t("ctx_batch_execute")}; a known path or command side effect alone does not change transport. Preserve owner identity, permissions, exit status and receipts. Short fixed outputs may use native tools.
    - Loading project-external AGENTS.md, SKILL.md or their required references → use native full reads directly. In-project mandatory full reads must return every required page; summaries or search hits do not satisfy them. Before editing, obtain the exact current text through an allowed read, then use native editing.
    - Host-native MCP, interaction and continuations → keep their real host interfaces; do not simulate or forward their protocols through an executor. Use the owner interface when this executor cannot preserve required runtime semantics.
    - WebFetch → use ${t("ctx_fetch_and_index")}; full network access, results indexed for ${t("ctx_search")}, raw page bytes never enter your conversation.
    - ${t("ctx_execute")} and ${t("ctx_execute_file")} are analysis and processing tools, not editing interfaces. Their subprocess may access the project working directory and cause host file side effects; do not use them for file writes.
  </when_not_to_use>

  <file_writing_policy>
    File writes use the native Write or Edit tool. Do not treat ${t("ctx_execute")}, ${t("ctx_execute_file")}, or a Bash subprocess as a file-writing surface or a host filesystem sandbox boundary; use them only when the owner contract permits their analysis or processing semantics.
    Applies to all file types: code, configs, plans, specs, YAML, JSON, markdown.
  </file_writing_policy>

  <output_constraints>
    <artifact_policy>
      Write artifacts (code, configs, PRDs) to files. Return only: file path + 1-line description.
    </artifact_policy>
  </output_constraints>
  <session_continuity>
    Skills, roles, and decisions captured earlier in this session are a memory aid, not a standing order. Treat them as context that may help — the user's most recent message always takes precedence. If a captured directive conflicts with what the user now asks, follow the user; a past phrase does not bind you.
  </session_continuity>
${includeCommands ? `
  <ctx_commands>
    "ctx stats" | "ctx-stats" | "/ctx-stats" | context savings question
    → Call stats MCP tool, display full output verbatim.

    "ctx doctor" | "ctx-doctor" | "/ctx-doctor" | diagnose context-mode
    → Call doctor MCP tool, run returned shell command, display as checklist.

    "ctx purge" | "ctx-purge" | "/ctx-purge" | wipe/reset knowledge base
    → Call purge MCP tool with confirm: true. Warn: irreversible.

    After /clear or /compact: knowledge base preserved. Tell user: "context-mode knowledge base preserved. Use \`ctx purge\` to start fresh."
  </ctx_commands>
` : ''}
</context_window_protection>`;
}

export function createReadGuidance(t) {
  return '<context_guidance>\n  <tip>\n    Project file reads and analysis, including known paths and exact text for editing, default to ' + t("ctx_execute_file") + '(path, language, code). Mandatory full reads must return all required text and pages; summaries and indexed snippets do not count. Use native editing after obtaining exact current text.\n    Load project-external AGENTS.md, SKILL.md and their required references with native full reads directly. The file tool checks project containment and host Read rules; explicitly allowed external data remains supported. Do not change cwd or use another executor to bypass a refusal.\n  </tip>\n</context_guidance>';
}

export function createGrepGuidance(t) {
  return '<context_guidance>\n  <tip>\n    Grep results may be larger than you expect. When you intend to count, filter, or aggregate matches (not just spot-check one), run the search through ' + t("ctx_execute") + '(language: "javascript", code: "...") — the raw match list stays in the sandbox and only your derived answer enters your conversation. Use language: "shell" only when the code matches the host shell (PowerShell on Windows, POSIX shell on Unix).\n  </tip>\n</context_guidance>';
}

export function createBashGuidance(t) {
  return '<context_guidance>\n  <tip>\n    Equivalent non-interactive commands default to ' + t("ctx_batch_execute") + '(commands, queries) for independent work or ' + t("ctx_execute") + '(language, code), with filtering and analysis inside. Preserve the real owner CLI, cwd, identity, permissions, exit status and complete required receipts; dependent writes stay sequential. Short fixed outputs may use native tools. Host MCP, interaction, editing and continuations keep their native interfaces. If using language: "shell", write syntax for the host shell.\n  </tip>\n</context_guidance>';
}

export function createExternalMcpGuidance(t) {
  return '<context_guidance>\n  <tip>\n    External MCP tools: call their native host interfaces directly and use their filters, limits or approved file-output options before delivery. Copying an already delivered payload into ' + t("ctx_execute") + ' does not recover conversation space. If the owner provides an equivalent real CLI, execute that command in context-mode before output enters the conversation, preserving its protocol and receipts. Process or index acquired material only under its source contract; context-mode does not forward MCP calls, select providers or turn candidates into facts.\n  </tip>\n</context_guidance>';
}

// ── Backward compat: static exports defaulting to claude-code ──

const _t = createToolNamer("claude-code");
export const ROUTING_BLOCK = createRoutingBlock(_t);
export const READ_GUIDANCE = createReadGuidance(_t);
export const GREP_GUIDANCE = createGrepGuidance(_t);
export const BASH_GUIDANCE = createBashGuidance(_t);
export const EXTERNAL_MCP_GUIDANCE = createExternalMcpGuidance(_t);
