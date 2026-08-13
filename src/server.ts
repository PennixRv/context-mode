#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, unlinkSync, readdirSync, readFileSync, writeFileSync, writeSync, renameSync, rmSync, mkdirSync, cpSync, statSync, symlinkSync, lstatSync, realpathSync } from "node:fs";
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { join, dirname, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir, cpus, platform } from "node:os";
import { request as httpsRequest } from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { PolyglotExecutor } from "./executor.js";
import {
  formatExecutionPolicyError,
  readExecutionMode,
  RESTRICTED_PROJECT_ROOT_ENV,
  resolveExecutionPolicy,
  validateRestrictedInvocation,
  type BubblewrapIsolation,
  type ExecutionPolicyDecision,
  type ExecutionPolicyErrorCode,
} from "./execution-policy.js";
import {
  boundedText,
  renderBatchCommandLine,
  renderBoundedTitle,
  renderCommandSource,
  renderExecutionSource,
  renderSearchableTerms,
  resolvePresentationPolicy,
} from "./presentation-policy.js";
import { formatEphemeralSearch } from "./ephemeral-search.js";
import { runPool, type PoolJob } from "./runPool.js";
import {
  ContentStore,
  cleanupStaleDBs,
  cleanupStaleContentDBs,
  isRecoveryBriefIndexPath,
  type SearchResult,
  type IndexResult,
} from "./store.js";
import { composeFetchCacheKey } from "./fetch-cache.js";
import {
  readBashPolicies,
  evaluateCommandDenyOnly,
  extractShellCommands,
  readToolDenyPatterns,
  evaluateFilePath,
} from "./security.js";
import {
  detectRuntimes,
  getRuntimeSummary,
  getAvailableLanguages,
  hasBunRuntime,
} from "./runtime.js";
import { classifyNonZeroExit } from "./exit-classify.js";
import { startLifecycleGuard, noteMcpActivity, noteRequestStart, noteRequestEnd, attachMcpActivityTap } from "./lifecycle.js";
import { charSafePrefix } from "./truncate.js";
import {
  describeStorageDirectorySource,
  ensureWritableStorageDir,
  formatStorageDirectoryError,
  hashProjectDirCanonical,
  hashProjectDirLegacy,
  resolveContentStorePath,
  resolveContentStorageDir,
  resolveDefaultSessionDir,
  resolveSessionDbPath,
  resolveSessionStorageDir,
  resolveStatsStorageDir,
  SessionDB,
  StorageDirectoryError,
} from "./session/db.js";
import { purgeSession } from "./session/purge.js";
import {
  emitCacheHitEvent,
  emitIndexWriteEvent,
  emitSandboxExecuteEvent,
} from "./session/event-emit.js";
import { persistToolCallCounter, restoreSessionStats } from "./session/persist-tool-calls.js";
import { appendRetrievalBytes } from "./session/retrieval-marker.js";
import { searchAllSources } from "./search/unified.js";
import {
  buildCtxSearchInputSchema,
  CTX_SEARCH_SHARED_MODE,
  resolveProjectScope,
} from "./search/ctx-search-schema.js";
import { FloodGuard } from "./search/flood-guard.js";
import { buildNodeCommand, type HookAdapter, type PlatformId, isInProcessPluginPlatform } from "./adapters/types.js";
import { detectPlatform, getSessionDirSegments } from "./adapters/detect.js";
import { parseCodexContextModePluginRoot } from "./adapters/codex/index.js";
import {
  getCheckpointReliabilityReport,
  getRecoveryBriefProviderStatus,
  initializeProjectRecoveryBriefProvider,
  readTrellisEvidence,
  updateRecoveryBriefProvider,
} from "./checkpoint/runtime.js";
import { recoveryBriefV1Schema } from "./checkpoint/recovery-brief-schema.js";
import {
  CODEX_RECOVERY_BRIEF_TOOL_MATCHER,
  RECOVERY_BRIEF_CAPABILITY_FIELD,
  consumeRecoveryBriefCapability,
  getRecoveryBriefCapabilityReadiness,
} from "./checkpoint/recovery-brief-capability.js";
import { getHookScriptPaths } from "./util/hook-config.js";
import { stripJsonComments } from "./util/jsonc.js";
import { resolveClaudeConfigDir } from "./util/claude-config.js";
import { resolveProjectDir } from "./util/project-dir.js";
import { loadDatabase } from "./db-base.js";
import { AnalyticsEngine, formatReport, getConversationStats, getContentBytesAllSessions, getConversationWindowStats, getLifetimeStats, getMultiAdapterLifetimeStats, getRealBytesStats, pricePerToken } from "./session/analytics.js";
import {
  channelUsesNpmRegistry,
  compareSemanticVersions,
  inferInstallationChannel,
  type InstallationChannel,
} from "./version-channel.js";
import { createHash } from "node:crypto";
const __pkg_dir = dirname(fileURLToPath(import.meta.url));
const VERSION: string = (() => {
  for (const rel of ["../package.json", "./package.json"]) {
    const p = resolve(__pkg_dir, rel);
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")).version; } catch {}
    }
  }
  return "unknown";
})();

function getPackageRoot(): string {
  return existsSync(resolve(__pkg_dir, "package.json")) ? __pkg_dir : dirname(__pkg_dir);
}

function resolveCodexRuntimePluginRoot(fallbackRoot: string): string {
  const probe = (json: boolean) => process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `codex plugin list${json ? " --json" : ""}`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
    : spawnSync("codex", ["plugin", "list", ...(json ? ["--json"] : [])], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  try {
    const structured = probe(true);
    const runtimeRoot = structured.status === 0
      ? parseCodexContextModePluginRoot(String(structured.stdout))
      : null;
    if (runtimeRoot) {
      return runtimeRoot;
    }
    const legacy = probe(false);
    if (legacy.status === 0) {
      return parseCodexContextModePluginRoot(String(legacy.stdout)) ?? fallbackRoot;
    }
  } catch {
    // Best effort only. Non-Codex hosts and older Codex builds may not expose
    // plugin list; keep the package-root fallback for those environments.
  }
  return fallbackRoot;
}

function getRuntimeAwarePackageRoot(platformId?: PlatformId): string {
  const packageRoot = getPackageRoot();
  return platformId === "codex"
    ? resolveCodexRuntimePluginRoot(packageRoot)
    : packageRoot;
}

// Prevent silent MCP server death from unhandled async errors.
//
// Guarded for plugin-native OpenCode/Kilo imports (#574): when server.js is
// imported only to reuse the ctx_* tool registry, these handlers would become
// process-wide OpenCode/Kilo host handlers. In Node, adding an
// `uncaughtException` listener changes default crash behavior, so only the
// standalone MCP process may install them.
if (process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS !== "1") {
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`[context-mode] unhandledRejection: ${err}\n`);
  });
  process.on("uncaughtException", (err) => {
    try {
      writeSync(2, `[context-mode] uncaughtException: ${err?.message ?? err}\n`);
    } finally {
      process.exit(1);
    }
  });
}

const runtimes = detectRuntimes();
const available = getAvailableLanguages(runtimes);
export const server = new McpServer({
  name: "context-mode",
  version: VERSION,
});

export interface RegisteredCtxTool {
  name: string;
  config: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const REGISTERED_CTX_TOOLS: RegisteredCtxTool[] = [];

export function shouldSuppressMcpToolsForNativePluginHost(
  opts: { embedded?: string; platform?: PlatformId; settings?: Record<string, unknown> | null } = {},
): boolean {
  const embedded = opts.embedded ?? process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS;
  if (embedded === "1") return false;
  const platform = opts.platform ?? detectPlatform().platform;
  if (platform !== "opencode" && platform !== "kilo") return false;
  const settings = opts.settings ?? readNativePluginHostSettings(platform);
  return settingsHasContextModePlugin(settings) && settingsHasLegacyContextModeMcp(settings);
}

function readNativePluginHostSettings(platform: PlatformId): Record<string, unknown> | null {
  const base = platform === "kilo" ? "kilo" : "opencode";
  const paths = [
    resolve(`${base}.json`),
    resolve(`${base}.jsonc`),
    resolve(`.${base}`, `${base}.json`),
    resolve(`.${base}`, `${base}.jsonc`),
    join(homedir(), ".config", base, `${base}.json`),
    join(homedir(), ".config", base, `${base}.jsonc`),
  ];
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      return JSON.parse(stripJsonComments(readFileSync(p, "utf8"))) as Record<string, unknown>;
    } catch { /* try next config path */ }
  }
  return null;
}

function settingsHasContextModePlugin(settings: Record<string, unknown> | null | undefined): boolean {
  const plugins = settings?.plugin;
  return Array.isArray(plugins) && plugins.some((p) => typeof p === "string" && p.includes("context-mode"));
}

function settingsHasLegacyContextModeMcp(settings: Record<string, unknown> | null | undefined): boolean {
  const mcp = settings?.mcp;
  return !!(
    mcp &&
    typeof mcp === "object" &&
    !Array.isArray(mcp) &&
    Object.prototype.hasOwnProperty.call(mcp, "context-mode")
  );
}

const suppressMcpToolsForNativePluginHost = shouldSuppressMcpToolsForNativePluginHost();

/**
 * Issue #623 — surface why ctx_* tools/list is empty on suppressed legacy MCP
 * children. When a user upgrades OpenCode/Kilo from v1.0.136 → v1.0.137+ without
 * running `context-mode upgrade`, their opencode.json still has BOTH the legacy
 * mcp.context-mode block AND the plugin entry. The plugin path registers the
 * tools natively, but the legacy MCP child runs in parallel and used to expose
 * duplicate tools — v1.0.137 suppressed those duplicates. The suppression was
 * silent, leaving any MCP client that inspected the child via tools/list with
 * an empty list and no diagnostic. Emit one stderr line per process so an
 * operator running the child directly (or any non-plugin MCP host) sees the
 * exact reason and the `context-mode upgrade` fix.
 *
 * Exported for test (suppression-diagnostic regression guard).
 */
let __suppressionDiagnosticEmitted = false;
export function emitSuppressionDiagnostic(
  opts: { platform?: string; write?: (chunk: string) => void } = {},
): void {
  if (__suppressionDiagnosticEmitted) return;
  __suppressionDiagnosticEmitted = true;
  const write = opts.write ?? ((c: string) => { process.stderr.write(c); });
  const platform = opts.platform ?? "opencode/kilo";
  write(
    `[context-mode] ctx_* tools/list intentionally empty on this MCP child: ` +
    `legacy mcp.context-mode block coexists with plugin: ["context-mode"] in ` +
    `${platform}.json — plugin-native tools are the supported path (#623). ` +
    `Run \`context-mode upgrade\` to remove the legacy block (preserves other ` +
    `MCP servers).\n`
  );
}
/** Test-only: reset the one-shot emission flag so suites can re-exercise. */
export function __resetSuppressionDiagnosticForTests(): void {
  __suppressionDiagnosticEmitted = false;
}

/**
 * Issue #637 — register an explicit empty `tools/list` handler on the McpServer.
 *
 * Background: when `suppressMcpToolsForNativePluginHost` is true, every
 * `server.registerTool()` call is short-circuited (returns `undefined` above).
 * The MCP SDK only installs the SDK-default `tools/list` handler when at least
 * one `registerTool()` reaches `setToolRequestHandlers()` internally
 * (mcp.js:56-67). Suppressing every registration leaves `tools/list`
 * unregistered, and the framework's RPC layer answers it with
 * `-32601 "Method not found"`.
 *
 * The reporter of #637 (SquirrelRat) inspected the suppressed child via
 * `tools/list` and read the JSON-RPC error as "the plugin never registers any
 * ctx_* tools" — when in fact the plugin DOES register all 11 tools natively
 * (verified at `src/adapters/opencode/plugin.ts:469` and
 * `tests/opencode-plugin.test.ts:88`). The misleading -32601 is the seed of
 * the #637 perception.
 *
 * This helper installs an explicit handler that returns `{tools: []}` — a
 * spec-compliant empty list. Paired with the existing #623 stderr diagnostic,
 * an operator now sees:
 *   - wire response: `{tools: []}` (matches expectation, no JSON-RPC error)
 *   - stderr: `[context-mode] ctx_* tools/list intentionally empty… (#623)`
 *
 * Idempotent: throws inside SDK if called twice on the same server because
 * `assertCanSetRequestHandler` (mcp.js:60) rejects duplicate registrations;
 * we therefore install the SDK's default tool handlers FIRST (via a no-op
 * registerTool of a fake tool, immediately removed) only if needed. To keep
 * the public surface minimal, we just call `server.server.setRequestHandler`
 * directly — that is the same low-level call used for prompts/resources at
 * server.ts:259-261 and avoids the SDK guard entirely.
 *
 * Exported for test (#637 in-memory regression guard).
 */
export function registerEmptyToolsListHandler(target: McpServer = server): void {
  target.server.registerCapabilities({ tools: { listChanged: false } });
  target.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
}

const originalRegisterTool = server.registerTool.bind(server);
(server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
  const [name, config, handler] = args as [
    string,
    Record<string, unknown>,
    (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
  ];
  if (suppressMcpToolsForNativePluginHost) {
    emitSuppressionDiagnostic();
    return undefined;
  }
  const wrappedHandler = wrapToolHandler(name, handler);
  REGISTERED_CTX_TOOLS.push({ name, config, handler: wrappedHandler });
  args[2] = wrappedHandler;
  return (originalRegisterTool as unknown as (...callArgs: unknown[]) => unknown)(...args);
};

function wrapToolHandler(
  name: string,
  handler: (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
): (toolArgs: Record<string, unknown>) => Promise<unknown> {
  return async (toolArgs: Record<string, unknown>) => {
    // #854: mark a tool call in-flight so the bridge-child idle reaper never
    // shuts the server down mid-execution during a long ctx_execute/batch that
    // emits no further inbound messages. Symmetric end in finally (success+error).
    noteRequestStart();
    try {
      return await handler(toolArgs);
    } catch (err) {
      const result = storageErrorResult(err);
      if (result) {
        try {
          return trackResponse(name, result);
        } catch (trackErr) {
          if (trackErr instanceof StorageDirectoryError) return result;
          throw trackErr;
        }
      }
      throw err;
    } finally {
      noteRequestEnd();
    }
  };
}

// Issue #637 — when suppression is active, install the empty tools/list handler
// once at module-init time so the suppressed MCP child responds with
// `{tools: []}` instead of JSON-RPC `-32601 Method not found`. Pair with the
// #623 stderr diagnostic that explains WHY the list is empty. Skipped for the
// embedded plugin-import path because the embedded process is not the stdio
// MCP child an operator would inspect — it lives inside the OpenCode/Kilo
// host and never speaks JSON-RPC over stdio.
if (suppressMcpToolsForNativePluginHost && process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS !== "1") {
  registerEmptyToolsListHandler(server);
}

type ToolContextOverride = { projectDir: string; sessionId?: string };
const projectDirOverride = new AsyncLocalStorage<ToolContextOverride>();

export async function withProjectDirOverride<T>(
  projectDir: string | ToolContextOverride,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = typeof projectDir === "string" ? { projectDir } : projectDir;
  return projectDirOverride.run(ctx, fn);
}

// Register empty prompts/resources handlers so MCP clients don't get -32601 (#168).
// OpenCode calls listPrompts()/listResources() unconditionally — the error can poison
// the SDK transport layer, causing subsequent listTools() calls to fail permanently.
import { ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
server.server.registerCapabilities({ prompts: { listChanged: false }, resources: { listChanged: false } });
server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

// ── Strict-client (Gemini function-calling) schema compatibility ──────────────
// Gemini's function-calling API — used by Antigravity CLI (`agy`) and Gemini CLI
// — rejects JSON Schema `const` and `additionalProperties`. A rejected parameter
// schema makes the host SILENTLY DROP that tool from the model's function list,
// so the agent never sees our ctx_* tools and falls back to hand-rolling the MCP
// protocol through its Bash tool. Sanitize the EMITTED tools/list schema:
//   • `const: X`  →  `enum: [X]`   — an identical single-value constraint
//   • drop `additionalProperties`  — advisory only; every ctx_* handler parses
//     args with Zod (which strips unknown keys server-side), so removing it
//     changes no validation and no call behavior.
// Both transforms are behavior-preserving for every other client (Claude Code,
// Copilot, Cursor, …): `const` and a one-value `enum` are equivalent, and no
// model sends undeclared properties. Only the wire schema changes — never
// validation or how any tool is invoked.
export function sanitizeSchemaForStrictClients(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaForStrictClients);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    out[key] = sanitizeSchemaForStrictClients(value);
  }
  return out;
}

// Wrap the SDK-installed tools/list handler so its generated schemas pass through
// the sanitizer above. Best-effort by design: if the MCP SDK's internals shift,
// the original handler is left untouched (no regression — strict clients stay as
// they were, every other client unaffected). Must run AFTER all registerTool()
// calls so the SDK's default tools/list handler already exists.
export function installStrictClientSchemaCompat(target: McpServer = server): void {
  try {
    const low = target.server as unknown as {
      _requestHandlers?: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    };
    const original = low._requestHandlers?.get("tools/list");
    if (typeof original !== "function") return;
    target.server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
      const result = (await original(req as unknown, extra as unknown)) as
        | { tools?: Array<{ inputSchema?: unknown }> }
        | undefined;
      if (result && Array.isArray(result.tools)) {
        for (const tool of result.tools) {
          if (!tool || tool.inputSchema == null) continue;
          try {
            tool.inputSchema = sanitizeSchemaForStrictClients(tool.inputSchema);
          } catch {
            /* leave this tool's schema unchanged */
          }
        }
      }
      return result as never;
    });
  } catch {
    /* best-effort — never break tools/list */
  }
}

const executor = new PolyglotExecutor({
  runtimes,
  projectRoot: () => getProjectDir(),
});
const SERVER_EXECUTION_MODE = readExecutionMode();
const RESTRICTED_EXECUTION_SERVER = SERVER_EXECUTION_MODE.mode !== "compatibility";
const PRESENTATION_POLICY = resolvePresentationPolicy();

// ─────────────────────────────────────────────────────────
// FS read tracking preload for ctx_batch_execute
// ─────────────────────────────────────────────────────────
// NODE_OPTIONS is denied by the executor's #buildSafeEnv (security).
// Instead, we inject it as a shell preamble before each complete batch script.
// This temp file is loaded via --require when batch commands spawn Node processes.
const CM_FS_PRELOAD = join(tmpdir(), `cm-fs-preload-${process.pid}.js`);
if (!RESTRICTED_EXECUTION_SERVER) {
  writeFileSync(
    CM_FS_PRELOAD,
    `(function(){var __cm_fs=0;process.on('exit',function(){if(__cm_fs>0)try{process.stderr.write('__CM_FS__:'+__cm_fs+'\\n')}catch(e){}});try{var f=require('fs');var ors=f.readFileSync;f.readFileSync=function(){var r=ors.apply(this,arguments);if(Buffer.isBuffer(r))__cm_fs+=r.length;else if(typeof r==='string')__cm_fs+=Buffer.byteLength(r);return r;};}catch(e){}})();\n`,
  );
}
// In the stdio MCP path, main() also removes this file during graceful
// shutdown. Plugin-native OpenCode/Kilo imports skip main() (#574), so
// register a top-level best-effort cleanup too to avoid leaking preload
// snippets under /tmp when the host process exits.
process.on("exit", () => {
  if (!RESTRICTED_EXECUTION_SERVER) {
    try { unlinkSync(CM_FS_PRELOAD); } catch { /* best effort */ }
  }
});

// Lazy singleton — no DB overhead unless index/search is used
let _store: ContentStore | null = null;

/**
 * Build the FK-attribution object passed to every ContentStore.index*() call
 * in this process. CLAUDE_SESSION_ID is the only MCP-side handle we have on
 * the current session — eventId stays undefined because MCP tool invocations
 * are not paired with PostToolUse event rows at index time (the hook fires
 * AFTER the tool returns). Empty-string fallback inside #insertChunks keeps
 * legacy unattributed rows readable.
 */
export function currentAttribution(): { sessionId?: string } | undefined {
  const override = projectDirOverride.getStore();
  if (override?.sessionId) return { sessionId: override.sessionId };

  // CLAUDE_SESSION_ID env var is NOT propagated to MCP servers (only to hooks).
  // Cross-adapter resolution: every adapter (15 of them) sets *_PROJECT_DIR env
  // and writes session_events via hooks. Read the most-recent session_id from
  // THIS project's session DB. Works for claude-code/cursor/gemini-cli/codex/
  // kiro/opencode/zed/kilo/openclaw/qwen-code/vscode-copilot/jetbrains-copilot/
  // omp/pi/antigravity — no adapter-specific transcript path required.
  const sessionId = process.env.CLAUDE_SESSION_ID ?? resolveSessionIdFromSessionDB();
  if (!sessionId) return undefined;
  return { sessionId };
}

/**
 * Resolve only the exact Codex RecoveryBrief identity bridge. A Codex MCP
 * process has no trustworthy project environment, so an absent or invalid
 * capability deliberately passes no session id to the provider layer. The
 * provider then returns its existing content-free SESSION_UNAVAILABLE result
 * before selecting or mutating any provider.
 */
async function withRecoveryBriefAttribution<T>(
  capability: unknown,
  operation: (projectRoot: string, sessionId: string | undefined) => T | Promise<T>,
): Promise<T> {
  if (process.env.CONTEXT_MODE_PLATFORM !== "codex") {
    return operation(getProjectDir(), currentAttribution()?.sessionId);
  }

  const identity = consumeRecoveryBriefCapability(capability);
  if (!identity) return operation(getProjectDir(), undefined);

  try {
    if (readTrellisEvidence(identity.projectDir, identity.sessionId).bridgeStatus !== "active") {
      return operation(getProjectDir(), undefined);
    }
  } catch {
    return operation(getProjectDir(), undefined);
  }

  return withProjectDirOverride(
    { projectDir: identity.projectDir, sessionId: identity.sessionId },
    async () => operation(getProjectDir(), identity.sessionId),
  );
}

let __cachedSessionId: { sid: string; checkedAt: number } | undefined;
/** v1.0.134 SLICE A: opts injection for testability. Production callers pass nothing. */
export function resolveSessionIdFromSessionDB(opts?: {
  projectDir?: string;
  sessionsDir?: string;
  bypassCache?: boolean;
}): string | undefined {
  // 2s cache — ctx_fetch_and_index can fire 5+ chunks/sec; DB open cost adds up.
  const now = Date.now();
  if (!opts?.bypassCache && __cachedSessionId && now - __cachedSessionId.checkedAt < 2000) {
    return __cachedSessionId.sid;
  }
  try {
    const projectDir = opts?.projectDir
      ?? process.env.CLAUDE_PROJECT_DIR
      ?? process.env.CONTEXT_MODE_PROJECT_DIR;
    if (!projectDir) return undefined;
    const sessionsDir = opts?.sessionsDir ?? getSessionDir();
    const dbPath = resolveSessionDbPath({ projectDir, sessionsDir });
    if (!existsSync(dbPath)) return undefined;
    const Database = loadDatabase();
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(
        "SELECT session_id FROM session_events ORDER BY created_at DESC LIMIT 1"
      ).get() as { session_id?: string } | undefined;
      const sid = row?.session_id;
      if (sid) __cachedSessionId = { sid, checkedAt: now };
      return sid;
    } finally {
      try { db.close(); } catch { /* best-effort */ }
    }
  } catch {
    return undefined;
  }
}

/**
 * Auto-index session events files written by SessionStart hook.
 * Scans ~/.claude/context-mode/sessions/ for *-events.md files.
 * CLAUDE_PROJECT_DIR is NOT available to MCP servers — only to hooks —
 * so we glob-scan instead of computing a specific hash.
 * Files are consumed (deleted) after indexing to prevent double-indexing.
 * Called on every getStore() — readdirSync is sub-millisecond when no files match.
 */
function maybeIndexSessionEvents(store: ContentStore): void {
  try {
    const sessionsDir = getSessionDir();
    if (!existsSync(sessionsDir)) return;
    const files = readdirSync(sessionsDir).filter(f => f.endsWith("-events.md"));
    for (const file of files) {
      const filePath = join(sessionsDir, file);
      try {
        store.index({ path: filePath, source: "session-events", attribution: currentAttribution() });
        unlinkSync(filePath);
      } catch { /* best-effort per file */ }
    }
  } catch { /* best-effort — session continuity never blocks tools */ }
}

// ── Platform-aware paths ──────────────────────────────────────────────────
// The adapter (stored after MCP handshake) is the canonical source for
// platform-specific paths. All session DB paths go through it — no
// hardcoded configDir detection in tool handlers.

let _detectedAdapter: HookAdapter | null = null;

/**
 * Resolve the Claude Code config root, honoring `CLAUDE_CONFIG_DIR` (incl.
 * leading `~`) before falling back to `~/.claude`. Mirrors
 * `hooks/session-helpers.mjs::resolveConfigDir` and
 * `ClaudeCodeAdapter.getConfigDir` so the pre-detection path agrees with
 * hooks/adapter on where Claude Code session data lives. See issue #453.
 *
 * Issue #460 round-3: delegates to the canonical util so empty/whitespace
 * env values fall back instead of poisoning downstream `join()` calls.
 */
async function getDiagnosticAdapter(): Promise<HookAdapter | null> {
  if (_detectedAdapter) return _detectedAdapter;
  try {
    const { getAdapter } = await import("./adapters/detect.js");
    const signal = detectPlatform();
    return await getAdapter(signal.platform);
  } catch {
    return null;
  }
}

/**
 * Get the platform-specific sessions directory from the detected adapter.
 * Falls back to the detected platform config root before adapter detection.
 */
function getDefaultSessionDir(): string {
  if (_detectedAdapter) return _detectedAdapter.getSessionDir();
  // Pre-detection path (race window before MCP `initialize` completes):
  // call detectPlatform() (sync, env-var-based) and look up segments via
  // getSessionDirSegments() (sync map, no adapter instantiation). This keeps
  // non-Claude platforms from spilling sessions into ~/.claude/. For Claude
  // Code/Codex (single-segment roots), reroute through their config-dir
  // contracts so the pre-detection window does not split-state with hooks.
  try {
    const signal = detectPlatform();
    const segments = getSessionDirSegments(signal.platform);
    if (segments) {
      return resolveDefaultSessionDir({
        configDir: join(...segments),
        configDirEnv: configDirEnvForSessionSegments(segments),
      });
    }
  } catch { /* fall through to claude fallback */ }
  return resolveDefaultSessionDir({ configDir: ".claude", configDirEnv: "CLAUDE_CONFIG_DIR" });
}

function configDirEnvForSessionSegments(segments: string[]): string | undefined {
  if (segments.length === 1 && segments[0] === ".claude") return "CLAUDE_CONFIG_DIR";
  if (segments.length === 1 && segments[0] === ".codex") return "CODEX_HOME";
  return undefined;
}

function getSessionDir(): string {
  return ensureWritableStorageDir(resolveSessionStorageDir(getDefaultSessionDir));
}

/**
 * Project directory detection across supported platforms.
 *
 * Priority:
 *   1. Platform-specific env var (set by host IDE before MCP server spawn)
 *   2. CONTEXT_MODE_PROJECT_DIR (set by start.mjs for ALL platforms — universal)
 *   3. process.cwd() (last resort)
 *
 * CONTEXT_MODE_PROJECT_DIR guarantees correct projectDir even for platforms
 * that don't set their own env var (Cursor, OpenClaw, Codex, Kiro, Zed).
 */
export function getProjectDir(): string {
  const override = projectDirOverride.getStore();
  if (override) return override.projectDir;

  // Delegated to the shared resolver so the env-var chain rejects plugin
  // install paths (set by a prior MCP boot's start.mjs after `/ctx-upgrade`)
  // and prefers the shell-set PWD before the chdir'd cwd. v1.0.115 adds
  // the Claude Code transcript heuristic — read `cwd` from the most-recently-
  // modified `~/.claude/projects/<encoded>/<session>.jsonl` to recover the
  // real project dir when MCP was launched from a non-project cwd (desktop-
  // app launch, /ctx-upgrade respawn). See src/util/project-dir.ts.
  //
  // Issue #521 (v1.0.119): the transcript heuristic ONLY applies on Claude
  // Code. Other platforms (Cursor, OpenCode, Codex, ...) either have no
  // transcript at that path or use a different schema without `cwd`. Worse,
  // a Cursor user who also runs Claude Code would pick up the most-recently-
  // modified Claude Code session's cwd — wrong project entirely. Gate the
  // path on detected platform so non-Claude hosts skip the heuristic and
  // fall through to PWD/cwd cleanly.
  //
  // The Claude heuristic must also be fresh. Hosts such as Pi can be
  // misdetected as Claude Code solely because ~/.claude exists; without a
  // freshness guard an old Claude transcript can globally hijack ctx shell cwd
  // after reboot. Active Claude sessions update their transcript as the user
  // interacts, so stale transcripts should fall through to PWD/cwd.
  //
  // Issue #545 (v1.0.124): pass strictPlatform for ALL adapters so the
  // env-var cascade is built ALGORITHMICALLY from the platform's own
  // workspace vars + universal escape hatch — foreign workspace vars (e.g.
  // CLAUDE_PROJECT_DIR leaked into Pi's MCP child env from the user's shell)
  // cannot win, regardless of cascade order. start.mjs intentionally does
  // NOT pass strictPlatform — host detection is unreliable at the entrypoint
  // and the legacy literal cascade is preserved there for semver safety.
  let transcriptsRoot: string | undefined;
  let strictPlatform: PlatformId | undefined;
  let codexHome: string | undefined;
  try {
    const detected = detectPlatform().platform;
    strictPlatform = detected;
    if (detected === "claude-code") {
      transcriptsRoot = join(homedir(), ".claude", "projects");
    }
    // Issue #45 — Codex publishes no workspace env var, so the resolver
    // reads `meta.cwd` from the most-recently-modified session.jsonl under
    // `${codexHome}/sessions/`. Wire codexHome at the call site so the
    // resolver can be exercised under test without process-level mutation.
    if (detected === "codex") {
      codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    }
  } catch { /* detection failure — leave undefined, resolver uses legacy cascade */ }
  return resolveProjectDir({
    env: process.env,
    cwd: process.cwd(),
    pwd: process.env.PWD,
    transcriptsRoot,
    transcriptMaxAgeMs: 5 * 60 * 1000,
    strictPlatform,
    codexHome,
  });
}

let executionPolicyCache: { projectRoot: string; decision: ExecutionPolicyDecision } | null = null;

function currentExecutionPolicy(): ExecutionPolicyDecision {
  // Restricted authority must never come from getProjectDir() because that
  // compatibility resolver deliberately falls back through transcripts, PWD,
  // and cwd. Only this server-start fixed root can define a security boundary.
  const projectRoot = RESTRICTED_EXECUTION_SERVER
    ? (process.env[RESTRICTED_PROJECT_ROOT_ENV]?.trim() ?? "")
    : getProjectDir();
  if (executionPolicyCache?.projectRoot === projectRoot) return executionPolicyCache.decision;
  const decision = resolveExecutionPolicy({ projectRoot });
  executionPolicyCache = { projectRoot, decision };
  return decision;
}

/**
 * Resolve a possibly-relative path against the project directory (full env cascade),
 * not the MCP server's process.cwd(). MCP server is spawned by the host and its cwd
 * is unrelated to where the user is working.
 */
function resolveProjectPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(getProjectDir(), filePath);
}

/**
 * Resolve the per-project SessionDB path. Delegates to
 * {@link resolveSessionDbPath} so casing-only variants of the same
 * physical worktree on macOS / Windows hit ONE DB, not two — and any
 * pre-existing legacy raw-casing DB gets migrated in place on first
 * resolve. Linux is a no-op.
 */
function getSessionDbPath(): string {
  return resolveSessionDbPath({
    projectDir: getProjectDir(),
    sessionsDir: getSessionDir(),
  });
}

/**
 * Compute a per-project, per-platform persistent path for the ContentStore.
 * Derives content dir from the adapter's session dir so each platform
 * has its own isolated FTS5 DB — no cross-platform data sharing.
 *
 * Layout: ~/<configDir>/context-mode/content/<hash>.db
 *   e.g.  ~/.claude/context-mode/content/87c28c41ddb64d38.db
 *         ~/.cursor/context-mode/content/87c28c41ddb64d38.db
 */
function getStorePath(): string {
  const dir = ensureWritableStorageDir(resolveContentStorageDir(getDefaultSessionDir));
  // Delegate to resolveContentStorePath: same case-fold + one-shot legacy
  // rename behavior as resolveSessionDbPath. On macOS / Windows, an
  // existing legacy raw-casing FTS5 db (with -wal/-shm sidecars) is
  // migrated in place on first call. On Linux it's a no-op.
  return resolveContentStorePath({ projectDir: getProjectDir(), contentDir: dir });
}

function getStore(): ContentStore {
  if (!_store) {
    // Content DB cleanup on fresh start is handled by SessionStart hook.
    // Server just opens whatever DB exists (or creates new if hook deleted it).
    const dbPath = getStorePath();
    _store = new ContentStore(dbPath);

    // Wire deny-policy hook: store re-checks the Read deny list before
    // re-reading any file_path during auto-refresh. Catches policy edits
    // made after a file was originally indexed. See #442 round-3.
    _store.setDenyChecker((filePath: string) => {
      try {
        const projectDir = getProjectDir();
        const denyGlobs = readToolDenyPatterns("Read", projectDir);
        const r = evaluateFilePath(
          filePath,
          denyGlobs,
          process.platform === "win32",
          projectDir,
        );
        return r.denied;
      } catch {
        // Fail-closed for refresh: skip on error rather than re-read.
        return true;
      }
    });

    // One-time startup cleanup: remove stale content DBs (>14 days)
    try {
      const contentDir = dirname(getStorePath());
      cleanupStaleContentDBs(contentDir, 14);
      _store.cleanupStaleSources(14);
      // Also clean legacy shared dir from before platform isolation
      const legacyDir = join(homedir(), ".context-mode", "content");
      if (existsSync(legacyDir)) cleanupStaleContentDBs(legacyDir, 0);
    } catch { /* best-effort */ }

    // Also clean old PID-based DBs from migration
    cleanupStaleDBs();
  }
  maybeIndexSessionEvents(_store);
  return _store;
}

// ─────────────────────────────────────────────────────────
// Session stats — track context consumption per tool
// ─────────────────────────────────────────────────────────

const sessionStats = {
  calls: {} as Record<string, number>,
  bytesReturned: {} as Record<string, number>,
  bytesIndexed: 0,
  bytesSandboxed: 0, // network I/O consumed inside sandbox (never enters context)
  cacheHits: 0,
  cacheMisses: 0, // ctx_fetch_and_index calls that bypassed the TTL cache
  cacheBytesSaved: 0, // bytes avoided by TTL cache hits
  sessionStart: Date.now(),
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export function compactTypedResult<T extends object>(value: T, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

export function addResponseNotice(response: ToolResult, notice: string): ToolResult {
  if (response.structuredContent) {
    response.content.push({ type: "text", text: notice });
  } else if (response.content.length > 0) {
    response.content[0].text = `${notice}\n\n${response.content[0].text}`;
  }
  return response;
}

function storageErrorResult(err: unknown): ToolResult | null {
  if (!(err instanceof StorageDirectoryError)) return null;
  return {
    content: [{ type: "text", text: formatStorageDirectoryError(err) }],
    isError: true,
  };
}
// ── Version outdated warning ──────────────────────────────────────────────
// Non-blocking npm check at startup. trackResponse prepends warning
// using a burst cadence: 3 warnings → 1h silent → 3 warnings → repeat.

let _latestVersion: string | null = null;
let _installationChannel: InstallationChannel = "unknown";
let _warningBurstCount = 0;
let _lastBurstStart = 0;
const VERSION_BURST_SIZE = 3;
const VERSION_SILENT_MS = 60 * 60 * 1000; // 1 hour

async function fetchLatestVersion(): Promise<string> {
  return new Promise((res) => {
    const req = httpsRequest(
      "https://registry.npmjs.org/context-mode/latest",
      { headers: { Connection: "close" } },
      (resp) => {
        let raw = "";
        resp.on("data", (chunk: Buffer) => { raw += chunk; });
        resp.on("end", () => {
          try {
            const data = JSON.parse(raw) as { version?: string };
            res(data.version ?? "unknown");
          } catch { res("unknown"); }
        });
      },
    );
    req.on("error", () => res("unknown"));
    req.setTimeout(5000, () => { req.destroy(); res("unknown"); });
    req.end();
  });
}

function getUpgradeHint(): string {
  const name = _detectedAdapter?.name;
  if (name === "Claude Code") return "/ctx-upgrade";
  if (name === "OpenClaw") return "npm run install:openclaw";
  if (name === "Pi") return "npm run build";
  return "npm update -g context-mode";
}

function isOutdated(): boolean {
  if (!_latestVersion || _latestVersion === "unknown") return false;
  if (!channelUsesNpmRegistry(_installationChannel)) return false;
  return compareSemanticVersions(_latestVersion, VERSION) === 1;
}

function shouldShowVersionWarning(): boolean {
  if (!isOutdated()) return false;
  const now = Date.now();
  // Start of a new burst?
  if (_warningBurstCount >= VERSION_BURST_SIZE) {
    if (now - _lastBurstStart < VERSION_SILENT_MS) return false; // still silent
    _warningBurstCount = 0; // silence over, reset burst
  }
  if (_warningBurstCount === 0) _lastBurstStart = now;
  _warningBurstCount++;
  return true;
}

// ── Self-heal Layer 2: Mid-session registry heal (anthropics/claude-code#46915) ──
// Runs once on first tool call. If Claude Code auto-updated the registry mid-session,
// hooks break because CLAUDE_PLUGIN_ROOT points to a deleted directory. We create a
// symlink from the broken path to our actual directory so hooks recover.
let _cacheHealDone = false;
function healCacheMidSession(): void {
  if (_cacheHealDone) return;
  _cacheHealDone = true;
  try {
    // Issue #460 round-3: honor $CLAUDE_CONFIG_DIR so users who relocate
    // their CC config root don't have plugin cache healing operate against
    // the wrong tree (and silently miss dangling-symlink cleanup).
    const claudeRoot = resolveClaudeConfigDir();
    const ipPath = resolve(claudeRoot, "plugins", "installed_plugins.json");
    if (!existsSync(ipPath)) return;
    const ip = JSON.parse(readFileSync(ipPath, "utf-8"));
    const cacheRoot = resolve(claudeRoot, "plugins", "cache");
    // Issue #795: canonicalize cacheRoot so the traversal guard works when
    // ~/.claude is a symlink to another volume.  path.resolve() does not
    // dereference symlinks, so installPath values stored as physical paths
    // (e.g. /Volumes/SSD/.../plugins/cache/...) would fail the startsWith
    // check against a symlink-path cacheRoot (/Users/me/.claude/...).
    // realpathSync follows the symlink chain to the canonical location.
    let cacheRootCanon: string;
    try { cacheRootCanon = realpathSync(cacheRoot); }
    catch { cacheRootCanon = cacheRoot; }
    // Plugin root: build/ for tsc, plugin root for bundle
    const pluginRoot = getPackageRoot();
    for (const [key, entries] of Object.entries((ip.plugins ?? {}) as Record<string, Array<{ installPath?: string }>>)) {
      if (key !== "context-mode@context-mode") continue;
      for (const entry of entries) {
        const rp = entry.installPath;
        if (!rp || existsSync(rp)) continue;
        // Path traversal guard (canonical comparison — see #795)
        if (!resolve(rp).startsWith(cacheRootCanon + sep)) continue;
        // Remove dangling symlink
        try { if (lstatSync(rp).isSymbolicLink()) unlinkSync(rp); } catch {}
        const parent = dirname(rp);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        if (existsSync(pluginRoot)) {
          symlinkSync(pluginRoot, rp, process.platform === "win32" ? "junction" : undefined);
        }
      }
    }
  } catch { /* best effort */ }
}

function trackResponse(toolName: string, response: ToolResult): ToolResult {
  // #854: a response is activity too — refresh the bridge-child idle clock so a
  // chatty/streaming call keeps its server alive even between inbound frames.
  noteMcpActivity();
  // Mid-session cache heal — one-shot, first tool call
  healCacheMidSession();
  // Keep compact typed JSON parseable while preserving the existing update notice.
  if (shouldShowVersionWarning() && response.content.length > 0) {
    const hint = getUpgradeHint();
    const warning = `⚠️ context-mode v${VERSION} outdated → v${_latestVersion} available. Upgrade: ${hint}`;
    addResponseNotice(response, warning);
  }

  const bytes = response.content.reduce(
    (sum, c) => sum + Buffer.byteLength(c.text),
    0,
  );
  sessionStats.calls[toolName] = (sessionStats.calls[toolName] || 0) + 1;
  sessionStats.bytesReturned[toolName] =
    (sessionStats.bytesReturned[toolName] || 0) + bytes;

  // Persist a sidecar JSON snapshot for the statusline — read at ~3-5 Hz by
  // bin/statusline.mjs (and any external dashboard) so they don't have to
  // open the SQLite database. Throttled inside persistStats() (500ms) so
  // it's safe to call on every response.
  persistStats();

  // Persist to SessionDB so counters survive process restart, --continue,
  // upgrade. Re-introduces the write path 4742160 added and b392c2f dropped.
  // setImmediate keeps this off the response hot path; the helper itself
  // is best-effort (never throws).
  setImmediate(() => persistToolCallCounter(getSessionDbPath(), toolName, bytes));

  // D2 Phase 5/7 — sandbox-execute event emission. Tracks the bytes the
  // user actually saw from sandboxed runs so getRealBytesStats() can
  // replace the conservative `events × 256` estimate. Best-effort and
  // off the hot path, same shape as persistToolCallCounter above.
  if (
    toolName === "ctx_execute"
    || toolName === "ctx_execute_file"
    || toolName === "ctx_batch_execute"
  ) {
    setImmediate(() =>
      emitSandboxExecuteEvent({
        sessionDbPath: getSessionDbPath(),
        toolName,
        bytesReturned: bytes,
      })
    );
  }

  // Retrieval ("With context-mode") bridge — ctx_search / ctx_fetch_and_index
  // response bytes are the kept-out content the model paid to access. The
  // PostToolUse hook never fires for the plugin's OWN MCP tools, so the
  // hook-side extractMcpToolCall can never see these calls (bytes_retrieved
  // was 0/124454 in prod). Drop the count into a marker keyed by the session
  // DB; the next ordinary-tool PostToolUse consumes it and emits a forwardable
  // bytes_retrieved event. Off the hot path; never throws.
  if (toolName === "ctx_search" || toolName === "ctx_fetch_and_index") {
    setImmediate(() => appendRetrievalBytes(getSessionDbPath(), bytes));
  }

  return response;
}

function trackIndexed(bytes: number, source: string = "unknown"): void {
  sessionStats.bytesIndexed += bytes;
  persistStats();
  // D2 Phase 5/7 — index-write event emission. `bytes_avoided` because
  // these are bytes that would have flooded context if the user had
  // Read'd the source instead of indexing.
  if (bytes > 0) {
    setImmediate(() =>
      emitIndexWriteEvent({
        sessionDbPath: getSessionDbPath(),
        source,
        bytesAvoided: bytes,
      })
    );
  }
}

function finalizeExecutionResponse(
  decision: ExecutionPolicyDecision,
  toolName: "ctx_execute" | "ctx_execute_file" | "ctx_batch_execute",
  response: ToolResult,
): ToolResult {
  if (decision.mode === "compatibility") return trackResponse(toolName, response);
  // Restricted calls deliberately bypass all stats, SessionDB, event, and
  // ContentStore write paths. Keep only the in-memory lifecycle clock alive.
  noteMcpActivity();
  return response;
}

function executionPolicyErrorResult(
  decision: ExecutionPolicyDecision,
  toolName: "ctx_execute" | "ctx_execute_file" | "ctx_batch_execute",
  errorCode: ExecutionPolicyErrorCode,
): ToolResult {
  return finalizeExecutionResponse(decision, toolName, {
    content: [{ type: "text", text: formatExecutionPolicyError(errorCode) }],
    isError: true,
  });
}

function restrictedOutput(
  output: string,
  source: string,
  intent?: string,
): string {
  if (Buffer.byteLength(output) > INTENT_SEARCH_THRESHOLD) {
    return formatEphemeralSearch(
      output,
      intent?.trim() ? [intent.trim()] : [],
      source,
      PRESENTATION_POLICY,
    );
  }
  return `Persisted: no (request-only).\n\n${output}`;
}

const ExecutionPersistenceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("verified"),
    source: z.string().min(1).max(160),
    provenance: z.object({
      kind: z.enum(["local-file", "local-command", "external-locally-verified"]),
      reference: z.string().min(1).max(500),
    }),
  }),
]);

type ExecutionPersistence = z.infer<typeof ExecutionPersistenceSchema>;

function buildVerifiedProvenance(
  content: string,
  persistence: Extract<ExecutionPersistence, { mode: "verified" }>,
) {
  return {
    kind: persistence.provenance.kind,
    reference: persistence.provenance.reference,
    verifiedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  } as const;
}

function requestLocalOutput(output: string, source: string, intent?: string): string {
  return formatEphemeralSearch(
    output,
    intent?.trim() ? [intent.trim()] : [],
    source,
    PRESENTATION_POLICY,
  );
}

// ─────────────────────────────────────────────────────────
// Stats persistence — written after every tool call so
// external readers (status line scripts, dashboards, hooks)
// can see real-time savings without spawning an MCP client.
// ─────────────────────────────────────────────────────────

const STATS_PERSIST_THROTTLE_MS = 500;
// Schema version for the persisted stats payload (~/.claude/context-mode/sessions/stats-*.json).
// Bump when a field is added/renamed/removed. Statusline reads `schemaVersion ?? 0` and warns when
// it sees a future schema, so legacy bundles degrade gracefully on upgrade rather than silently
// rendering missing fields (PR #401 architect review P1.3).
// v2: added tokens_saved_lifetime + dollars_saved_lifetime.
const STATS_SCHEMA_VERSION = 2;
// pricePerToken() intentionally NOT defined here — single source in
// src/session/analytics.ts re-exported above. (P1.1 — pricing constant dedup,
// PR #401 architect + ops 2-vote convergence.)
const LIFETIME_REFRESH_MS = 30_000;
// Matches the conversion factor in src/session/analytics.ts renderBottomLine:
// ~1KB per session event ÷ 4 bytes/token = 256 tokens/event.
const TOKENS_PER_EVENT = 256;
let _lastStatsPersist = 0;
let _lifetimeCache: { tokens: number; computedAt: number } | undefined;

/**
 * Resolve the per-session stats file path.
 *
 * The session id mirrors the Claude Code adapter contract
 * (`pid-<parent pid>`), so a status line script can derive
 * the same id from `$PPID` without coupling to MCP.
 */
// CLAUDE_SESSION_ID flows from the hosting process (Claude Code, pi, etc.)
// straight into a path.join, and path.join collapses ".." into the result,
// so a host env CLAUDE_SESSION_ID=../../evil writes "stats-evil.json" two
// levels above statsDir. The env var is not under direct MCP-tool-caller
// control, but in CI / multi-tenant contexts where the host env is partly
// influenceable this is an arbitrary-write primitive within the MCP server
// process's filesystem permissions. Constrain to a UUID-shaped charset
// before splicing into the stats filename.
const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;
function sanitizeSessionId(raw: string): string {
  return SESSION_ID_RE.test(raw) ? raw : `pid-${process.ppid}`;
}

function getStatsFilePath(): string {
  const raw = process.env.CLAUDE_SESSION_ID || `pid-${process.ppid}`;
  const sessionId = sanitizeSessionId(raw);
  const statsDir = ensureWritableStorageDir(resolveStatsStorageDir(getDefaultSessionDir));
  return join(statsDir, `stats-${sessionId}.json`);
}

function persistStats(): void {
  const now = Date.now();
  if (now - _lastStatsPersist < STATS_PERSIST_THROTTLE_MS) return;
  _lastStatsPersist = now;

  try {
    const totalReturned = Object.values(sessionStats.bytesReturned).reduce(
      (a, b) => a + b,
      0,
    );
    const totalCalls = Object.values(sessionStats.calls).reduce(
      (a, b) => a + b,
      0,
    );
    const keptOut =
      sessionStats.bytesIndexed +
      sessionStats.bytesSandboxed +
      sessionStats.cacheBytesSaved;
    const totalProcessed = keptOut + totalReturned;
    const reductionPct =
      totalProcessed > 0
        ? Math.round((1 - totalReturned / totalProcessed) * 100)
        : 0;
    const tokensSaved = Math.round(keptOut / 4);

    // Lifetime savings — cached separately because getLifetimeStats() scans
    // disk (per-project SessionDBs + auto-memory dirs) and is too expensive
    // for the 500ms persist throttle. Refresh every 30s; the statusline
    // doesn't need second-by-second lifetime accuracy.
    let lifetimeTokens = _lifetimeCache?.tokens ?? 0;
    if (!_lifetimeCache || now - _lifetimeCache.computedAt > LIFETIME_REFRESH_MS) {
      try {
        const life = getLifetimeStats({ sessionsDir: getSessionDir() });
        lifetimeTokens = (life?.totalEvents ?? 0) * TOKENS_PER_EVENT;
        _lifetimeCache = { tokens: lifetimeTokens, computedAt: now };
      } catch {
        // best-effort — keep stale cache or 0
      }
    }

    const payload = {
      schemaVersion: STATS_SCHEMA_VERSION,
      version: VERSION,
      updated_at: now,
      session_start: sessionStats.sessionStart,
      uptime_ms: now - sessionStats.sessionStart,
      total_calls: totalCalls,
      bytes_returned: totalReturned,
      bytes_indexed: sessionStats.bytesIndexed,
      bytes_sandboxed: sessionStats.bytesSandboxed,
      cache_hits: sessionStats.cacheHits,
      cache_bytes_saved: sessionStats.cacheBytesSaved,
      kept_out: keptOut,
      total_processed: totalProcessed,
      reduction_pct: reductionPct,
      tokens_saved: tokensSaved,
      // statusline-facing $ values — pre-computed at the current per-token
      // rate (dynamic when PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN is set by a
      // Pi host; Opus $15/1M otherwise). Resolved on every persist via
      // pricePerToken() so the env override picks up without an MCP restart.
      dollars_saved_session: +(tokensSaved * pricePerToken()).toFixed(2),
      tokens_saved_lifetime: lifetimeTokens,
      dollars_saved_lifetime: +(lifetimeTokens * pricePerToken()).toFixed(2),
      by_tool: Object.fromEntries(
        Object.keys({ ...sessionStats.calls, ...sessionStats.bytesReturned }).map(
          (t) => [
            t,
            {
              calls: sessionStats.calls[t] || 0,
              bytes: sessionStats.bytesReturned[t] || 0,
            },
          ],
        ),
      ),
    };

    const filePath = getStatsFilePath();
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(payload));
    renameSync(tmpPath, filePath);
  } catch {
    // best-effort — never break tool calls because of stats persistence
  }
}

// ==============================================================================
// Security: server-side deny firewall
// ==============================================================================

/**
 * Check a shell command against Bash deny patterns.
 * Returns an error ToolResult if denied, or null if allowed.
 */
function checkDenyPolicy(
  command: string,
  toolName: string,
): ToolResult | null {
  try {
    const policies = readBashPolicies(process.env.CLAUDE_PROJECT_DIR);
    const result = evaluateCommandDenyOnly(command, policies);
    if (result.decision === "deny") {
      return {
        content: [{
          type: "text" as const,
          text: `Command blocked by security policy: matches deny pattern ${result.matchedPattern}`,
        }],
        isError: true,
      };
    }
  } catch {
    // Security check failed — allow through (fail-open for server,
    // hooks are the primary enforcement layer)
  }
  return null;
}

/**
 * Check non-shell code for shell-escape calls against deny patterns.
 */
function checkNonShellDenyPolicy(
  code: string,
  language: string,
  toolName: string,
): ToolResult | null {
  try {
    const commands = extractShellCommands(code, language);
    if (commands.length === 0) return null;
    const policies = readBashPolicies(process.env.CLAUDE_PROJECT_DIR);
    for (const cmd of commands) {
      const result = evaluateCommandDenyOnly(cmd, policies);
      if (result.decision === "deny") {
        return {
          content: [{
            type: "text" as const,
            text: `Command blocked by security policy: embedded shell command "${cmd}" matches deny pattern ${result.matchedPattern}`,
          }],
          isError: true,
        };
      }
    }
  } catch {
    // Fail-open
  }
  return null;
}

/**
 * Check a file path against Read deny patterns.
 * Returns an error ToolResult if denied, or null if allowed.
 */
function checkFilePathDenyPolicy(
  filePath: string,
  toolName: string,
): ToolResult | null {
  try {
    const projectDir = getProjectDir();
    const denyGlobs = readToolDenyPatterns("Read", projectDir);
    const result = evaluateFilePath(
      filePath,
      denyGlobs,
      process.platform === "win32",
      projectDir,
    );
    if (result.denied) {
      return {
        content: [{
          type: "text" as const,
          text: `File access blocked by security policy: path matches Read deny pattern ${result.matchedPattern}`,
        }],
        isError: true,
      };
    }
  } catch {
    // Fail-open
  }
  return null;
}

// Build description dynamically based on detected runtimes
const langList = available.join(", ");
const bunNote = hasBunRuntime()
  ? " (Bun detected — JS/TS runs 3-5x faster)"
  : "";

// ─────────────────────────────────────────────────────────
// Helper: smart snippet extraction — returns windows around
// matching query terms instead of dumb truncation
//
// When `highlighted` is provided (from FTS5 `highlight()` with
// STX/ETX markers), match positions are derived from the markers.
// This is the authoritative source — FTS5 uses the exact same
// tokenizer that produced the BM25 match, so stemmed variants
// like "configuration" matching query "configure" are found
// correctly. Falls back to indexOf on raw terms when highlighted
// is absent (non-FTS codepath).
// ─────────────────────────────────────────────────────────

const STX = "\x02";
const ETX = "\x03";

/**
 * Parse FTS5 highlight markers to find match positions in the
 * original (marker-free) text. Returns character offsets into the
 * stripped content where each matched token begins.
 */
export function positionsFromHighlight(highlighted: string): number[] {
  const positions: number[] = [];
  let cleanOffset = 0;

  let i = 0;
  while (i < highlighted.length) {
    if (highlighted[i] === STX) {
      // Record position of this match in the clean text
      positions.push(cleanOffset);
      i++; // skip STX
      // Advance through matched text until ETX
      while (i < highlighted.length && highlighted[i] !== ETX) {
        cleanOffset++;
        i++;
      }
      if (i < highlighted.length) i++; // skip ETX
    } else {
      cleanOffset++;
      i++;
    }
  }

  return positions;
}

/** Strip STX/ETX markers to recover original content. */
function stripMarkers(highlighted: string): string {
  return highlighted.replaceAll(STX, "").replaceAll(ETX, "");
}

export function extractSnippet(
  content: string,
  query: string,
  maxLen = 1500,
  highlighted?: string,
): string {
  if (content.length <= maxLen) return content;

  // Derive match positions from FTS5 highlight markers when available
  const positions: number[] = [];

  if (highlighted) {
    for (const pos of positionsFromHighlight(highlighted)) {
      positions.push(pos);
    }
  }

  // Fallback: indexOf on raw query terms (non-FTS codepath)
  if (positions.length === 0) {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const lower = content.toLowerCase();

    for (const term of terms) {
      let idx = lower.indexOf(term);
      while (idx !== -1) {
        positions.push(idx);
        idx = lower.indexOf(term, idx + 1);
      }
    }
  }

  // No matches at all — return prefix
  if (positions.length === 0) {
    return content.slice(0, maxLen) + "\n…";
  }

  // Sort positions, merge overlapping windows
  positions.sort((a, b) => a - b);
  const WINDOW = 300;
  const windows: Array<[number, number]> = [];

  for (const pos of positions) {
    const start = Math.max(0, pos - WINDOW);
    const end = Math.min(content.length, pos + WINDOW);
    if (windows.length > 0 && start <= windows[windows.length - 1][1]) {
      windows[windows.length - 1][1] = end;
    } else {
      windows.push([start, end]);
    }
  }

  // Collect windows until maxLen
  const parts: string[] = [];
  let total = 0;
  for (const [start, end] of windows) {
    if (total >= maxLen) break;
    const part = content.slice(start, Math.min(end, start + (maxLen - total)));
    parts.push(
      (start > 0 ? "…" : "") + part + (end < content.length ? "…" : ""),
    );
    total += part.length;
  }

  return parts.join("\n\n");
}

export type BatchQueryScope = "batch" | "global";

export function formatBatchQueryResults(
  store: ContentStore,
  queries: string[],
  source: string,
  maxOutput = 80 * 1024,
  scope: BatchQueryScope = "batch",
): string[] {
  const sections: string[] = [];
  let outputSize = 0;

  // When scope is "global", searchWithFallback receives `undefined` for the
  // source filter, which makes it query the entire persistent index instead
  // of only the chunks just produced by this batch's commands. Default
  // remains "batch" to preserve the historical behavior.
  const searchSource = scope === "global" ? undefined : source;

  for (const query of queries) {
    if (outputSize > maxOutput) {
      const title = renderBoundedTitle(query, PRESENTATION_POLICY);
      sections.push(`## ${title}\n(output cap reached — use ctx_search for details)\n`);
      continue;
    }

    const results = store.searchWithFallback(query, 3, searchSource, undefined, "exact");
    sections.push(`## ${renderBoundedTitle(query, PRESENTATION_POLICY)}`);
    sections.push("");
    if (results.length > 0) {
      for (const result of results) {
        const snippet = extractSnippet(
          result.content,
          query,
          PRESENTATION_POLICY.resultPreviewChars,
          result.highlighted,
        );
        sections.push(`### ${renderBoundedTitle(result.title, PRESENTATION_POLICY)}`);
        sections.push(snippet);
        sections.push("");
        outputSize += snippet.length + result.title.length;
      }
      continue;
    }

    sections.push("No matching sections found.");
    sections.push("");
  }

  return sections;
}

// ─────────────────────────────────────────────────────────
// batch_execute runner — used by ctx_batch_execute handler
// ─────────────────────────────────────────────────────────

export interface BatchCommand { label: string; command: string; }

export type BatchCommandStatus = "completed" | "failed" | "timed_out" | "skipped" | "error";

export interface BatchCommandExecution {
  stdout: string;
  stderr?: string;
  exitCode: number;
  timedOut?: boolean;
}

export interface BatchRunResult {
  outputs: string[];
  searchableOutputs: string[];
  searchableBodies: string[];
  statuses: BatchCommandStatus[];
  exitCodes: Array<number | null>;
  timedOut: boolean;
}

export interface BatchRunOptions {
  /**
   * Total budget (concurrency=1, shared) or per-command (concurrency>1).
   * When `undefined`, no server-side timer fires — the MCP host's RPC
   * timeout governs (Issue #406).
   */
  timeout: number | undefined;
  concurrency: number;
  nodeOptsPrefix: string;
  cwd?: string;
  isolation?: BubblewrapIsolation;
  onFsBytes?: (bytes: number) => void;
}

interface BatchExecutor {
  execute(input: {
    language: "shell";
    code: string;
    timeout: number | undefined;
    cwd?: string;
    isolation?: BubblewrapIsolation;
  }): Promise<Partial<BatchCommandExecution> & Pick<BatchCommandExecution, "stdout">>;
}

function quotePosixSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildBatchNodeOptionsPrefix(shellPath: string, preloadPath: string): string {
  // NODE_OPTIONS is parsed again by Node after the shell assigns it. Preserve
  // the preload path as one argument for both parsers, including spaces and
  // quotes in host-authorized temporary paths.
  const option = `--require ${JSON.stringify(preloadPath)}`;
  const shell = shellPath.toLowerCase();
  const base = shell.split(/[\\/]/).pop() ?? shell;

  if (shell.includes("powershell") || shell.includes("pwsh")) {
    return `$env:NODE_OPTIONS=${quotePowerShellSingle(option)};\n`;
  }

  if (base === "cmd" || base === "cmd.exe") {
    return `set "NODE_OPTIONS=${option.replace(/"/g, '""')}"\r\n`;
  }

  return `export NODE_OPTIONS=${quotePosixSingle(option)}\n`;
}

/**
 * Default execution timeout (ms) applied ONLY under Antigravity CLI (`agy`).
 * agy does not enforce an MCP RPC timeout, so a ctx_execute with a runaway or
 * blocking script hangs forever — the host never kills it and the user must
 * interrupt. Every other host enforces its own RPC timeout, so we keep the
 * no-server-timer behavior there (Issue #406 — long builds need an unbounded
 * run). A caller can still pass an explicit `timeout` to override on any host.
 */
export const AGY_DEFAULT_EXEC_TIMEOUT_MS = 120_000;
export function resolveExecTimeout(timeout: number | undefined): number | undefined {
  if (timeout !== undefined) return timeout;
  // Only agy gets a default — every other host enforces its own RPC timeout, so
  // keep the unbounded behavior there. Detected via the env the agy bundle pins
  // (CONTEXT_MODE_PLATFORM=antigravity-cli). Tunable via CONTEXT_MODE_AGY_EXEC_TIMEOUT_MS.
  if (detectPlatform().platform !== "antigravity-cli") return undefined;
  const override = Number(process.env.CONTEXT_MODE_AGY_EXEC_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : AGY_DEFAULT_EXEC_TIMEOUT_MS;
}

/**
 * Build the source-code preamble surfaced before tool stdout. Provenance
 * remains directly visible for the #717/#736 audit contract while one typed
 * policy bounds every response branch.
 */
function buildExecuteEcho(language: string, code: string, path?: string): string {
  return renderExecutionSource(language, code, PRESENTATION_POLICY, path);
}

function formatCommandOutput(label: string, command: string, raw: string, onFsBytes?: (bytes: number) => void): string {
  const sanitized = stripFsMarkers(raw, onFsBytes);
  const output = sanitized || "(no output)";
  const echoed = renderCommandSource(command, PRESENTATION_POLICY);
  return `# ${label}\n\n$ ${echoed}\n\n${output}\n`;
}

function stripFsMarkers(raw: string, onFsBytes?: (bytes: number) => void): string {
  let output = raw;
  const fsMatches = output.matchAll(/__CM_FS__:(\d+)/g);
  let cmdFsBytes = 0;
  for (const m of fsMatches) cmdFsBytes += parseInt(m[1]);
  if (cmdFsBytes > 0) {
    onFsBytes?.(cmdFsBytes);
    output = output.replace(/__CM_FS__:\d+\n?/g, "");
  }
  return output;
}

function combineExecOutput(result: { stdout?: string; stderr?: string }): string {
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout}${stdout.endsWith("\n") ? "" : "\n"}${stderr}`;
}

/**
 * Execute batch commands. concurrency=1 preserves the legacy serial path
 * (shared timeout budget + cascading skip-on-timeout). concurrency>1 runs
 * commands concurrently with at most N in flight; each command receives the
 * full timeout, output is collated by input index, and per-command timeouts
 * record `(timed out)` blocks without skipping siblings.
 */
export async function runBatchCommands(
  commands: BatchCommand[],
  opts: BatchRunOptions,
  executor: BatchExecutor,
): Promise<BatchRunResult> {
  const { timeout, concurrency, nodeOptsPrefix, cwd, isolation, onFsBytes } = opts;

  if (concurrency <= 1) {
    // Serial path — shared timeout budget, cascading skip on timeout.
    // When `timeout` is undefined, no shared budget is enforced; each
    // command runs to completion (Issue #406).
    const outputs: string[] = [];
    const searchableOutputs: string[] = [];
    const searchableBodies: string[] = [];
    const statuses: BatchCommandStatus[] = [];
    const exitCodes: Array<number | null> = [];
    const startTime = Date.now();
    let timedOut = false;
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      let perCmdTimeout: number | undefined;
      if (timeout !== undefined) {
        const elapsed = Date.now() - startTime;
        const remaining = timeout - elapsed;
        if (remaining <= 0) {
          outputs.push(`# ${cmd.label}\n\n(skipped — batch timeout exceeded)\n`);
          statuses.push("skipped");
          exitCodes.push(null);
          searchableOutputs.push("");
          searchableBodies.push("");
          timedOut = true;
          continue;
        }
        perCmdTimeout = remaining;
      }
      const result = await executor.execute({
        language: "shell",
        code: `${nodeOptsPrefix}${cmd.command}`,
        timeout: perCmdTimeout,
        cwd,
        isolation,
      });
      outputs.push(formatCommandOutput(cmd.label, cmd.command, combineExecOutput(result), onFsBytes));
      const exitCode = result.exitCode ?? (result.timedOut ? 1 : 0);
      const status: BatchCommandStatus = result.timedOut
        ? "timed_out"
        : exitCode === 0
          ? "completed"
          : "failed";
      statuses.push(status);
      exitCodes.push(exitCode);
      const searchableBody = status === "completed"
        ? stripFsMarkers(result.stdout ?? "")
        : "";
      searchableBodies.push(searchableBody);
      searchableOutputs.push(searchableBody.trim()
        ? formatCommandOutput(cmd.label, cmd.command, searchableBody)
        : "");
      if (result.timedOut) {
        timedOut = true;
        for (let j = i + 1; j < commands.length; j++) {
          outputs.push(`# ${commands[j].label}\n\n(skipped — batch timeout exceeded)\n`);
          statuses.push("skipped");
          exitCodes.push(null);
          searchableOutputs.push("");
          searchableBodies.push("");
        }
        break;
      }
    }
    return { outputs, searchableOutputs, searchableBodies, statuses, exitCodes, timedOut };
  }

  // Parallel path — delegated to the shared runPool primitive.
  // Each job returns { output, timedOut }; runPool handles in-flight cap,
  // throw isolation (Promise.allSettled semantics), and order preservation.
  const jobs: PoolJob<{ output: string; searchableOutput: string; searchableBody: string; timedOut: boolean; exitCode: number }>[] = commands.map((cmd) => ({
    run: async () => {
      const result = await executor.execute({
        language: "shell",
        code: `${nodeOptsPrefix}${cmd.command}`,
        timeout,
        cwd,
        isolation,
      });
      // Always route partial output through formatCommandOutput so __CM_FS__
      // markers are stripped + counted, even when the command timed out.
      const formatted = formatCommandOutput(cmd.label, cmd.command, combineExecOutput(result), onFsBytes);
      const output = result.timedOut
        ? formatted.replace(/\n$/, "") + `\n(timed out after ${timeout ?? "?"}ms)\n`
        : formatted;
      const exitCode = result.exitCode ?? (result.timedOut ? 1 : 0);
      const searchableBody = !result.timedOut && exitCode === 0
        ? stripFsMarkers(result.stdout ?? "")
        : "";
      return {
        output,
        searchableOutput: searchableBody.trim()
          ? formatCommandOutput(cmd.label, cmd.command, searchableBody)
          : "",
        searchableBody,
        timedOut: !!result.timedOut,
        exitCode,
      };
    },
  }));

  const { settled } = await runPool(jobs, { concurrency });
  const outputs: string[] = new Array(commands.length);
  const searchableOutputs: string[] = new Array(commands.length).fill("");
  const searchableBodies: string[] = new Array(commands.length).fill("");
  const statuses: BatchCommandStatus[] = new Array(commands.length);
  const exitCodes: Array<number | null> = new Array(commands.length).fill(null);
  let timedOut = false;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      outputs[i] = r.value.output;
      searchableOutputs[i] = r.value.searchableOutput;
      searchableBodies[i] = r.value.searchableBody;
      exitCodes[i] = r.value.exitCode;
      statuses[i] = r.value.timedOut
        ? "timed_out"
        : r.value.exitCode === 0
          ? "completed"
          : "failed";
      if (r.value.timedOut) timedOut = true;
    } else {
      // Isolated executor throw (spawn EAGAIN, ENOMEM, EMFILE, …) — siblings keep running.
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      outputs[i] = `# ${commands[i].label}\n\n(executor error: ${message})\n`;
      statuses[i] = "error";
    }
  }
  return { outputs, searchableOutputs, searchableBodies, statuses, exitCodes, timedOut };
}

function formatBatchSummary(
  commands: BatchCommand[],
  statuses: BatchCommandStatus[],
  totalLines: number,
  totalBytes: number,
  options: {
    persisted: boolean;
    indexedSections?: number;
    indexedSource?: string;
    queries: number;
    queryScope: BatchQueryScope;
  },
): string {
  const attempted = statuses.filter((status) => status !== "skipped").length;
  const execution = attempted === commands.length
    ? `Executed ${commands.length} commands`
    : `Executed ${attempted}/${commands.length} commands`;
  const facts = [
    `${execution} (${totalLines} lines, ${(totalBytes / 1024).toFixed(1)}KB).`,
    `Persisted: ${options.persisted ? "yes" : "no"}.`,
  ];
  if (options.indexedSections !== undefined) {
    const source = options.indexedSource === undefined
      ? ""
      : ` as ${JSON.stringify(options.indexedSource)}`;
    facts.push(`Indexed ${options.indexedSections} sections${source}.`);
  }
  if (options.queries > 0) {
    const scope = options.persisted && options.queryScope === "global" ? "global" : "request-local";
    facts.push(`Searched ${options.queries} ${scope} queries.`);
  }
  return facts.join(" ");
}

function formatBatchCommandProof(
  commands: BatchCommand[],
  statuses: BatchCommandStatus[],
  heading = "Commands",
): string {
  return renderBatchCommandLine(
    commands.map((command, index) => ({ ...command, status: statuses[index] })),
    PRESENTATION_POLICY,
    heading,
  );
}

// ─────────────────────────────────────────────────────────
// Tool: execute
// ─────────────────────────────────────────────────────────

server.registerTool(
  "ctx_execute",
  {
    // #852: surface code execution in the host approval prompt's title (the
    // only server-controlled field the MCP permission UI renders besides args).
    title: RESTRICTED_EXECUTION_SERVER
      ? "Restricted project read-only code execution"
      : "Run code in a sandbox (executes the supplied code)",
    // #846: runs arbitrary code in a sandbox with full network access.
    annotations: RESTRICTED_EXECUTION_SERVER ? {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } : {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: `${RESTRICTED_EXECUTION_SERVER ? `Server policy: project-contained read-only execution, no network, no persistence, and no background processes. Restricted languages: shell, javascript, typescript, python.

` : ""}Run code in a sandboxed subprocess.${bunNote} Languages: ${langList}.

Think-in-Code — the core philosophy: the bytes your code processes never enter your conversation memory; only what you console.log() does. Reading a 700 KB log directly means 700 KB of your remaining reasoning capacity gets spent on raw bytes. Running code over that same log in this sandbox and printing a 3 KB summary leaves you with 697 KB of capacity for the actual work.

Concrete shape — analyze 47 source files without reading any of them:
  ctx_execute(language: "javascript", code: \`
    const fs = require('fs');
    const files = fs.readdirSync('src').filter(f => f.endsWith('.ts'));
    files.forEach(f => {
      const lines = fs.readFileSync('src/'+f,'utf8').split('\\\\n').length;
      console.log(f + ': ' + lines + ' lines');
    });
  \`)
  // 47 files analyzed, 15,314 LoC summarized — output ~3.6 KB instead of 47 Read() calls = ~700 KB.

WHEN:
  - You intend to derive an answer FROM data (filter, count, aggregate, parse, compare, transform) — do the derivation in code and print only the answer
  - Output shape or size cannot be predicted before execution (recursive finds, repo-wide greps, list endpoints, query results, log scans)
  - You would otherwise read raw output and then mentally compute — that compute belongs here, in code, where its inputs stay out of your conversation
  - You need to keep a long-running process alive (dev server, watcher, daemon) — pass \`background: true\` to detach on timeout instead of killing the process
  - The output may legitimately be large — pass an \`intent\` string to search it within this request without returning the full body
  - You have locally verified successful output and explicitly need later recall — pass \`persistence: {mode: "verified", source, provenance}\`; failed output is never persisted

WHEN NOT:
  - Single observational command whose entire short output you intend to consume verbatim (whoami, pwd, git status on a clean tree) — Bash is simpler
  - File mutations (Edit/Write) or navigation (cd/ls) — Bash is the right surface
  - You already know the output is one short fixed line and you want to read it as-is

RETURNS:
  Only what your code prints. Wrap risky calls in try/catch — uncaught errors go to stderr and may leak more than intended. Output is request-local by default. An \`intent\` searches large output only within this call. Later ctx_search recall requires explicit verified persistence.

EXAMPLE: ctx_execute(language: "javascript", code: "const out = require('child_process').execSync('npm test', {encoding:'utf8', stdio:['ignore','pipe','pipe']}); console.log(out.split('\\\\n').filter(l => /(FAIL|✗|×|Error:|Tests +.*(failed|passed))/i.test(l)).slice(0, 60).join('\\\\n'))")
EXAMPLE: ctx_execute(language: "javascript", code: "const out = require('child_process').execSync('gh issue list --json number,title --limit 100', {encoding:'utf8'}); const hooks = JSON.parse(out).filter(i => /hook|routing/i.test(i.title)); console.log(\`\${hooks.length} hook-related issues\`)")`,
    inputSchema: z.object({
      language: z
        .enum([
          "javascript",
          "typescript",
          "python",
          "shell",
          "ruby",
          "go",
          "rust",
          "php",
          "perl",
          "r",
          "elixir",
          "csharp",
        ])
        .describe("Runtime language"),
      code: z
        .string()
        .describe(
          "Source code to execute. Use console.log (JS/TS), print (Python/Ruby/Perl/R), echo (Shell), echo (PHP), fmt.Println (Go), IO.puts (Elixir), or Console.WriteLine (C#) to output a summary to context.",
        ),
      timeout: z
        .coerce.number()
        .optional()
        .describe("Max execution time in ms. When omitted, no server-side timer fires — the MCP host's RPC timeout governs (which is the right layer for this policy). Pass an explicit value for long-running builds (Gradle/Maven/SBT)."),
      // background: wrapped in coerceBoolean preprocessor so the literal
      // strings "true"/"false" arriving from OpenCode's native plugin
      // bridge (and several LLM providers' tool-call JSON) parse as the
      // boolean the handler expects. z.coerce.boolean() is unsafe here —
      // Boolean("false") is true. Fixes #627.
      background: z
        .preprocess(coerceBoolean, z.boolean())
        .optional()
        .default(false)
        .describe(RESTRICTED_EXECUTION_SERVER
          ? "Restricted server policy forbids background execution; true is rejected before launch."
          : "Keep process running after timeout (for servers/daemons). Returns partial output without killing the process. IMPORTANT: Do NOT add setTimeout/self-close timers in background scripts — the process must stay alive until the timeout detaches it. For server+fetch patterns, prefer putting both server and fetch in ONE ctx_execute call instead of using background."),
      cwd: z
        .string()
        .optional()
        .describe("Optional working directory for shell commands. Non-shell languages still execute from their sandbox temp directory."),
      intent: z
        .string()
        .optional()
        .describe(RESTRICTED_EXECUTION_SERVER
          ? "What to match in large output. Restricted mode searches only request memory, returns bounded matches, and does not make the result available to ctx_search."
          : "What you're looking for in the output. When provided and output is large (>5KB), " +
            "searches request-local output and returns matching sections instead of the full body. " +
            "This does not make output available to later ctx_search calls. Example: 'failing tests', 'HTTP 500 errors'." +
            "\n\nTIP: Use specific technical terms, not just concepts. Check 'Searchable terms' in the response for available vocabulary."),
      persistence: ExecutionPersistenceSchema
        .optional()
        .default({ mode: "none" })
        .describe("Default none keeps output request-local. verified persists only successful output with bounded locally verified provenance."),
    }),
  },
  async ({ language, code, timeout, background, cwd, intent, persistence }) => {
    const decision = currentExecutionPolicy();
    const invocation = validateRestrictedInvocation(decision, { language, background, cwd });
    if (!invocation.ok) {
      return executionPolicyErrorResult(
        decision,
        "ctx_execute",
        invocation.errorCode ?? "CTX_EXEC_POLICY_INVALID",
      );
    }
    if (decision.mode === "restricted" && persistence.mode === "verified") {
      return executionPolicyErrorResult(decision, "ctx_execute", "CTX_EXEC_PERSISTENCE_FORBIDDEN");
    }
    const effectiveCwd = invocation.cwd ?? cwd;

    // Security: deny-only firewall
    if (language === "shell") {
      const denied = checkDenyPolicy(code, "execute");
      if (denied) return finalizeExecutionResponse(decision, "ctx_execute", denied);
    } else {
      const denied = checkNonShellDenyPolicy(code, language, "execute");
      if (denied) return finalizeExecutionResponse(decision, "ctx_execute", denied);
    }

    const echo = buildExecuteEcho(language, code);
    try {
      // For JS/TS: wrap in async IIFE with fetch + http/https interceptors to track network bytes
      let instrumentedCode = code;
      if (decision.mode === "compatibility" && (language === "javascript" || language === "typescript")) {
        // Wrap user code in a closure that shadows CJS require with http/https interceptor.
        // globalThis.require does NOT work because CJS require is module-scoped, not global.
        // The closure approach (function(__cm_req){ var require=...; })(require) correctly
        // shadows the CJS require for all code inside, including __cm_main().
        instrumentedCode = `
// FS read instrumentation — count bytes read via fs.readFileSync/readFile
let __cm_fs=0;
process.on('exit',()=>{if(__cm_fs>0)try{process.stderr.write('__CM_FS__:'+__cm_fs+'\\n')}catch{}});
(function(){
  try{
    var f=typeof require!=='undefined'?require('fs'):null;
    if(!f)return;
    var ors=f.readFileSync;
    f.readFileSync=function(){var r=ors.apply(this,arguments);if(Buffer.isBuffer(r))__cm_fs+=r.length;else if(typeof r==='string')__cm_fs+=Buffer.byteLength(r);return r;};
    var orf=f.readFile;
    if(orf)f.readFile=function(){var a=Array.from(arguments),cb=a.pop();orf.apply(this,a.concat([function(e,d){if(!e&&d){if(Buffer.isBuffer(d))__cm_fs+=d.length;else if(typeof d==='string')__cm_fs+=Buffer.byteLength(d);}cb(e,d);}]));};
  }catch{}
})();
let __cm_net=0;
// Report network bytes on process exit — works with both promise and callback patterns.
// process.on('exit') fires after all I/O completes, unlike .finally() which fires
// when __cm_main() resolves (immediately for callback-based http.get without await).
process.on('exit',()=>{if(__cm_net>0)try{process.stderr.write('__CM_NET__:'+__cm_net+'\\n')}catch{}});
;(function(__cm_req){
// Intercept globalThis.fetch
const __cm_f=globalThis.fetch;
globalThis.fetch=async(...a)=>{const r=await __cm_f(...a);
try{const cl=r.clone();const b=await cl.arrayBuffer();__cm_net+=b.byteLength}catch{}
return r};
// Shadow CJS require with http/https network tracking.
const __cm_hc=new Map();
const __cm_hm=new Set(['http','https','node:http','node:https']);
function __cm_wf(m,origFn){return function(...a){
  const li=a.length-1;
  if(li>=0&&typeof a[li]==='function'){const oc=a[li];a[li]=function(res){
    res.on('data',function(c){__cm_net+=c.length});oc(res);};}
  const req=origFn.apply(m,a);
  const oOn=req.on.bind(req);
  req.on=function(ev,cb,...r){
    if(ev==='response'){return oOn(ev,function(res){
      res.on('data',function(c){__cm_net+=c.length});cb(res);
    },...r);}
    return oOn(ev,cb,...r);
  };
  return req;
}}
var require=__cm_req?function(id){
  const m=__cm_req(id);
  if(!__cm_hm.has(id))return m;
  const k=id.replace('node:','');
  if(__cm_hc.has(k))return __cm_hc.get(k);
  const w=Object.create(m);
  if(typeof m.get==='function')w.get=__cm_wf(m,m.get);
  if(typeof m.request==='function')w.request=__cm_wf(m,m.request);
  __cm_hc.set(k,w);return w;
}:__cm_req;
if(__cm_req){if(__cm_req.resolve)require.resolve=__cm_req.resolve;
if(__cm_req.cache)require.cache=__cm_req.cache;}
async function __cm_main(){
${code}
}
__cm_main().catch(e=>{console.error(e);process.exitCode=1});${background ? '\nsetInterval(()=>{},2147483647);' : ''}
})(typeof require!=='undefined'?require:null);`;
      }
      const effTimeout = resolveExecTimeout(timeout);
      const result = await executor.execute({
        language,
        code: instrumentedCode,
        timeout: effTimeout,
        background,
        cwd: effectiveCwd,
        isolation: decision.isolation ?? undefined,
      });

      // Echo the executed source code before stdout so users can audit
      // and tooling can block command patterns (Issues #717 + #736).
      // Built from the user-supplied `code`, NOT the instrumented variant.
      if (decision.mode === "compatibility") {
        // These counters and their cleanup are compatibility telemetry only.
        // Restricted execution must not accept caller-controlled marker lines
        // as a route into persistent session accounting.
        const netMatch = result.stderr?.match(/__CM_NET__:(\d+)/);
        if (netMatch) {
          sessionStats.bytesSandboxed += parseInt(netMatch[1]);
          result.stderr = result.stderr.replace(/\n?__CM_NET__:\d+\n?/g, "");
        }
        const fsMatch = result.stderr?.match(/__CM_FS__:(\d+)/);
        if (fsMatch) {
          sessionStats.bytesSandboxed += parseInt(fsMatch[1]);
          result.stderr = result.stderr.replace(/\n?__CM_FS__:\d+\n?/g, "");
        }
      }

      if (result.timedOut) {
        const partialOutput = result.stdout?.trim();
        if (result.backgrounded && partialOutput) {
          // Background mode: process is still running, return partial output as success
          return finalizeExecutionResponse(decision, "ctx_execute", {
            content: [
              {
                type: "text" as const,
                text: `${echo}${decision.mode === "restricted" ? restrictedOutput(partialOutput, `execute:${language}`, intent) : partialOutput}\n\n_(process backgrounded after ${effTimeout}ms — still running)_`,
              },
            ],
          });
        }
        if (partialOutput) {
          // Timeout with partial output — return as success with note
          return finalizeExecutionResponse(decision, "ctx_execute", {
            content: [
              {
                type: "text" as const,
                text: `${echo}${decision.mode === "restricted" ? restrictedOutput(partialOutput, `execute:${language}`, intent) : partialOutput}\n\n_(timed out after ${effTimeout}ms — partial output shown above)_`,
              },
            ],
          });
        }
        return finalizeExecutionResponse(decision, "ctx_execute", {
          content: [
            {
              type: "text" as const,
              text: `${echo}Execution timed out after ${effTimeout}ms\n\nstderr:\n${result.stderr}`,
            },
          ],
          isError: true,
        });
      }

      if (result.exitCode !== 0) {
        const { isError, output } = classifyNonZeroExit({
          language, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        });
        if (decision.mode === "restricted") {
          return finalizeExecutionResponse(decision, "ctx_execute", {
            content: [{ type: "text" as const, text: `${echo}${restrictedOutput(output, `execute:${language}:error`, intent)}` }],
            isError,
          });
        }
        if (Buffer.byteLength(output) > INTENT_SEARCH_THRESHOLD) {
          return finalizeExecutionResponse(decision, "ctx_execute", {
            content: [
              { type: "text" as const, text: `${echo}${requestLocalOutput(output, `execute:${language}:error`, intent)}` },
            ],
            isError,
          });
        }
        return finalizeExecutionResponse(decision, "ctx_execute", {
          content: [
            { type: "text" as const, text: `${echo}Persisted: no (failed output).\n\n${output}` },
          ],
          isError,
        });
      }

      const rawStdout = result.stdout ?? "";
      const stdout = rawStdout || "(no output)";

      if (decision.mode === "restricted") {
        return finalizeExecutionResponse(decision, "ctx_execute", {
          content: [{ type: "text" as const, text: `${echo}${restrictedOutput(stdout, `execute:${language}`, intent)}` }],
        });
      }

      if (persistence.mode === "verified") {
        return finalizeExecutionResponse(decision, "ctx_execute", {
          content: [
            { type: "text" as const, text: `${echo}${persistVerifiedOutput(rawStdout, intent, persistence)}` },
          ],
        });
      }

      if (Buffer.byteLength(stdout) > INTENT_SEARCH_THRESHOLD) {
        return finalizeExecutionResponse(decision, "ctx_execute", {
          content: [{ type: "text" as const, text: `${echo}${requestLocalOutput(stdout, `execute:${language}`, intent)}` }],
        });
      }

      return finalizeExecutionResponse(decision, "ctx_execute", {
        content: [
          { type: "text" as const, text: `${echo}Persisted: no (request-only).\n\n${stdout}` },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return finalizeExecutionResponse(decision, "ctx_execute", {
        content: [
          { type: "text" as const, text: `${echo}Runtime error: ${message}` },
        ],
        isError: true,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────
// Helper: index stdout into FTS5 knowledge base
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Helper: intent-driven search on execution output
// ─────────────────────────────────────────────────────────

const INTENT_SEARCH_THRESHOLD = 5_000; // bytes — ~80-100 lines
function persistVerifiedOutput(
  stdout: string,
  intent: string | undefined,
  persistence: Extract<ExecutionPersistence, { mode: "verified" }>,
  maxResults: number = 5,
): string {
  if (!stdout.trim()) {
    return "Persisted: no (empty stdout). No persistent source was created.";
  }

  const totalLines = stdout.split("\n").length;
  const totalBytes = Buffer.byteLength(stdout);

  const persistent = getStore();
  trackIndexed(totalBytes);
  const indexed = persistent.indexPlainText(
    stdout,
    persistence.source,
    undefined,
    currentAttribution(),
    undefined,
    buildVerifiedProvenance(stdout, persistence),
  );

  if (!intent?.trim()) {
    return `Persisted: yes. Indexed ${indexed.totalChunks} verified sections as "${indexed.label}".\nUse ctx_search(queries: ["..."], source: "${indexed.label}") to query this content.`;
  }

  const results = persistent.searchWithFallback(intent, maxResults, persistence.source);

  // Extract distinctive terms as vocabulary hints for the LLM
  const distinctiveTerms = persistent.getDistinctiveTerms(
    indexed.sourceId,
    PRESENTATION_POLICY.searchableTerms + 1,
  );

  if (results.length === 0) {
    const lines = [
      `Persisted: yes. Indexed ${indexed.totalChunks} verified sections as "${persistence.source}".`,
      `No sections matched intent "${intent}" in ${totalLines}-line output (${(totalBytes / 1024).toFixed(1)}KB).`,
    ];
    const termLine = renderSearchableTerms(distinctiveTerms, PRESENTATION_POLICY);
    if (termLine) {
      lines.push("");
      lines.push(termLine);
    }
    lines.push("");
    lines.push("Use ctx_search(queries: [...]) to explore the indexed content.");
    return lines.join("\n");
  }

  // Return ONLY titles + first-line previews — not full content
  const lines = [
    `Persisted: yes. Indexed ${indexed.totalChunks} verified sections as "${persistence.source}".`,
    `${results.length} sections matched "${intent}" (${totalLines} lines, ${(totalBytes / 1024).toFixed(1)}KB):`,
    "",
  ];

  for (const r of results) {
    const preview = boundedText(r.content.split("\n")[0], PRESENTATION_POLICY.resultPreviewChars);
    lines.push(`  - ${renderBoundedTitle(r.title, PRESENTATION_POLICY)}: ${preview}`);
  }

  const termLine = renderSearchableTerms(distinctiveTerms, PRESENTATION_POLICY);
  if (termLine) {
    lines.push("");
    lines.push(termLine);
  }

  lines.push("");
  lines.push("Use ctx_search(queries: [...]) to retrieve full content of any section.");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────
// Tool: execute_file
// ─────────────────────────────────────────────────────────

server.registerTool(
  "ctx_execute_file",
  {
    // #852: the host's MCP approval prompt renders only the tool name/title +
    // raw args — the title is the one server-controlled signal, so make it
    // unambiguously announce code execution + file read for the reviewer.
    title: RESTRICTED_EXECUTION_SERVER
      ? "Restricted read-only code execution over a project file"
      : "Run code over a file (executes code, reads the given path)",
    // #846: runs arbitrary code over a file in a sandbox with full network access.
    annotations: RESTRICTED_EXECUTION_SERVER ? {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } : {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: `${RESTRICTED_EXECUTION_SERVER ? `Server policy: project-contained read-only execution, no network, no persistence, and no background processes. Restricted languages: shell, javascript, typescript, python.

` : ""}Read a file into a sandboxed FILE_CONTENT variable and run code over it. Only what you console.log() enters your conversation — the file bytes stay in the sandbox.

Think-in-Code applied to file-level analysis: Reading the whole file means every byte enters your conversation memory and costs reasoning capacity for the rest of the session. Running code over it here lets you keep the raw bytes out and only the derived answer in. Same principle as ctx_execute, scoped to one named file via the FILE_CONTENT variable.

WHEN:
  - You want to KNOW SOMETHING ABOUT a file (line count, matches of a pattern, parsed structure, statistical aggregate) without needing to SEE all of it
  - The file is structured (CSV, JSON, log, code) and a code-level derivation is cheaper than reading verbatim
  - The file is large enough that reading the full content would burn meaningful conversation memory you need for the actual work
  - The derivation may itself produce a large output — pass an \`intent\` string to search it within this request
  - You have locally verified successful output and explicitly need later recall — pass \`persistence: {mode: "verified", source, provenance}\`; failed output is never persisted

WHEN NOT:
  - You intend to EDIT the file — use Read so the subsequent Edit can match the exact text
  - You only need one specific line and you know its offset — Read with offset/limit is the simplest path
  - The file is small AND you will consume all of it for understanding/editing — Read directly

RETURNS:
  Only what your code prints. The FILE_CONTENT variable holds the raw bytes inside the sandbox; nothing else leaves. Output is request-local by default; \`intent\` searches a large result only within this call. Later ctx_search recall requires explicit verified persistence.

EXAMPLE: ctx_execute_file(path: "huge.log", language: "javascript", code: "const errs = FILE_CONTENT.split('\\\\n').filter(l => /ERROR|FATAL/.test(l)); console.log(\`\${errs.length} error lines\`); console.log(errs.slice(-5).join('\\\\n'))")
EXAMPLE: ctx_execute_file(path: "data.csv", language: "javascript", code: "const rows = FILE_CONTENT.split('\\\\n'); console.log(\`rows: \${rows.length - 1}, header: \${rows[0]}\`)")`,
    inputSchema: z.object({
      path: z
        .string()
        .describe("Absolute file path or relative to project root"),
      language: z
        .enum([
          "javascript",
          "typescript",
          "python",
          "shell",
          "ruby",
          "go",
          "rust",
          "php",
          "perl",
          "r",
          "elixir",
          "csharp",
        ])
        .describe("Runtime language"),
      code: z
        .string()
        .describe(
          "Code to process FILE_CONTENT (file_content in Elixir). Print summary via console.log/print/echo/IO.puts/Console.WriteLine.",
        ),
      timeout: z
        .coerce.number()
        .optional()
        .describe("Max execution time in ms. When omitted, no server-side timer fires — the MCP host's RPC timeout governs."),
      intent: z
        .string()
        .optional()
        .describe(RESTRICTED_EXECUTION_SERVER
          ? "What to match in large output. Restricted mode searches only request memory and never writes the file or result to FTS5."
          : "What you're looking for in the output. When provided and output is large (>5KB), " +
            "returns only matching sections via BM25 search instead of truncated output."),
      persistence: ExecutionPersistenceSchema
        .optional()
        .default({ mode: "none" })
        .describe("Default none keeps output request-local. verified persists only successful output with bounded locally verified provenance."),
    }),
  },
  async ({ path, language, code, timeout, intent, persistence }) => {
    const decision = currentExecutionPolicy();
    const invocation = validateRestrictedInvocation(decision, { language, filePath: path });
    if (!invocation.ok) {
      return executionPolicyErrorResult(
        decision,
        "ctx_execute_file",
        invocation.errorCode ?? "CTX_EXEC_POLICY_INVALID",
      );
    }

    if (decision.mode === "restricted" && persistence.mode === "verified") {
      return executionPolicyErrorResult(decision, "ctx_execute_file", "CTX_EXEC_PERSISTENCE_FORBIDDEN");
    }

    // Security: check file path against Read deny patterns
    const pathDenied = checkFilePathDenyPolicy(path, "ctx_execute_file");
    if (pathDenied) return finalizeExecutionResponse(decision, "ctx_execute_file", pathDenied);

    // Security: check code parameter against Bash deny patterns
    if (language === "shell") {
      const codeDenied = checkDenyPolicy(code, "execute_file");
      if (codeDenied) return finalizeExecutionResponse(decision, "ctx_execute_file", codeDenied);
    } else {
      const codeDenied = checkNonShellDenyPolicy(code, language, "execute_file");
      if (codeDenied) return finalizeExecutionResponse(decision, "ctx_execute_file", codeDenied);
    }

    const echo = buildExecuteEcho(language, code, path);
    try {
      const effTimeout = resolveExecTimeout(timeout);
      const result = await executor.executeFile({
        path: invocation.filePath ?? path,
        language,
        code,
        timeout: effTimeout,
        isolation: decision.isolation ?? undefined,
      });

      // Echo path + executed source code before stdout for audit/debug
      // (Issues #717 + #736).
      if (result.timedOut) {
        return finalizeExecutionResponse(decision, "ctx_execute_file", {
          content: [
            {
              type: "text" as const,
              text: `${echo}Timed out processing ${path} after ${effTimeout}ms`,
            },
          ],
          isError: true,
        });
      }

      if (result.exitCode !== 0) {
        const { isError, output } = classifyNonZeroExit({
          language, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        });
        if (decision.mode === "restricted") {
          return finalizeExecutionResponse(decision, "ctx_execute_file", {
            content: [{ type: "text" as const, text: `${echo}${restrictedOutput(output, `file:${path}:error`, intent)}` }],
            isError,
          });
        }
        if (Buffer.byteLength(output) > INTENT_SEARCH_THRESHOLD) {
          return finalizeExecutionResponse(decision, "ctx_execute_file", {
            content: [
              { type: "text" as const, text: `${echo}${requestLocalOutput(output, `file:${path}:error`, intent)}` },
            ],
            isError,
          });
        }
        return finalizeExecutionResponse(decision, "ctx_execute_file", {
          content: [
            { type: "text" as const, text: `${echo}Persisted: no (failed output).\n\n${output}` },
          ],
          isError,
        });
      }

      const rawStdout = result.stdout ?? "";
      const stdout = rawStdout || "(no output)";

      if (decision.mode === "restricted") {
        return finalizeExecutionResponse(decision, "ctx_execute_file", {
          content: [{ type: "text" as const, text: `${echo}${restrictedOutput(stdout, `file:${path}`, intent)}` }],
        });
      }

      if (persistence.mode === "verified") {
        return finalizeExecutionResponse(decision, "ctx_execute_file", {
          content: [
            { type: "text" as const, text: `${echo}${persistVerifiedOutput(rawStdout, intent, persistence)}` },
          ],
        });
      }

      if (Buffer.byteLength(stdout) > INTENT_SEARCH_THRESHOLD) {
        return finalizeExecutionResponse(decision, "ctx_execute_file", {
          content: [{ type: "text" as const, text: `${echo}${requestLocalOutput(stdout, `file:${path}`, intent)}` }],
        });
      }

      return finalizeExecutionResponse(decision, "ctx_execute_file", {
        content: [
          { type: "text" as const, text: `${echo}Persisted: no (request-only).\n\n${stdout}` },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return finalizeExecutionResponse(decision, "ctx_execute_file", {
        content: [
          { type: "text" as const, text: `${echo}Runtime error: ${message}` },
        ],
        isError: true,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────
// Tool: index
// ─────────────────────────────────────────────────────────

server.registerTool(
  "ctx_index",
  {
    title: "Index Content",
    // #846: writes content into the local FTS5 store (additive, not destructive;
    // re-indexing the same content adds rows, so not idempotent). No network.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description: `Explicitly retain locally verified content in a searchable knowledge base (BM25 over FTS5). Splits markdown by headings, keeps code blocks intact, and persists the raw chunks until purged.

WHEN:
  - The user explicitly wants later recall of a selected local file or bounded directory
  - An external candidate has first been saved locally, checked against an authoritative source, and explicitly approved for retention
  - A narrow API reference, README, migration guide, or other stable document must be queried repeatedly

WHEN NOT:
  - Whole-repository source scanning, live code search, symbol/call analysis, or authoritative project facts — use current local tools or an approved CodeGraph index
  - Unverified Fast Context, web, external API, or other external candidates
  - Log files, test output, CSV, or build output — use ctx_execute_file, which processes in-sandbox without persisting bytes
  - Single-use ephemeral content you will not query later — keep it inline if it fits, or ctx_execute_file it

RETURNS:
  Indexing metadata: chunk counts (total, code-bearing), source label, and the exact ctx_search call shape to query the indexed content. Raw content is NOT echoed back — it lives in storage, retrievable via ctx_search(source: "<label>"). When \`path\` is provided, a content hash is stored so ctx_search results auto-flag staleness on future calls.

EXAMPLE: ctx_index(content: "# React useEffect\\n\\nThe Effect Hook lets you ...", source: "react-useeffect-docs")
EXAMPLE: ctx_index(path: "/path/to/large-spec.md", source: "openapi-v2-spec")`,
    inputSchema: z.object({
      content: z
        .string()
        .optional()
        .describe(
          "Raw text/markdown to index. Provide this OR path, not both.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Locally verified file OR deliberately selected bounded directory to retain. Not a default whole-repository indexer. Provide this OR content.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Label for the indexed content (e.g., 'Context7: React useEffect', 'Skill: frontend-design')",
        ),
      include: z.array(z.string()).optional().describe(
        "Directory-only: glob patterns to include (default: all matching extensions).",
      ),
      exclude: z.array(z.string()).optional().describe(
        "Directory-only: glob patterns to exclude. Merged with defaults (node_modules, .git, dist, build, .next, coverage, .venv, __pycache__, .DS_Store).",
      ),
      maxDepth: z.number().int().min(0).optional().describe(
        "Directory-only: max recursion depth from root (default: 5).",
      ),
      maxFiles: z.number().int().min(1).optional().describe(
        "Directory-only: hard cap on files indexed (default: 200) — FTS5 blow-up guard.",
      ),
      extensions: z.array(z.string()).optional().describe(
        "Directory-only: allowed file extensions (default: .md .mdx .txt .json .yaml .yml .ts .tsx .js .jsx .py .rs .go .sh).",
      ),
      respectGitignore: z.boolean().optional().describe(
        "Directory-only compatibility option. Git-ignored tool/runtime paths, hidden paths, .trellis/, and .codegraph/ remain excluded regardless of this value.",
      ),
      followSymlinks: z.boolean().optional().describe(
        "Directory-only: follow directory symlinks (default: false — cycle hazard + escape risk).",
      ),
    }),
  },
  async ({ content, path, source, include, exclude, maxDepth, maxFiles, extensions, respectGitignore, followSymlinks }) => {
    if (!content && !path) {
      return trackResponse("ctx_index", {
        content: [
          {
            type: "text" as const,
            text: "Error: Either content or path must be provided",
          },
        ],
        isError: true,
      });
    }

    if (path && isRecoveryBriefIndexPath(path)) {
      return trackResponse("ctx_index", {
        content: [{
          type: "text" as const,
          text: "Error: controlled RecoveryBrief state cannot be indexed.",
        }],
        isError: true,
      });
    }

    // Apply Read deny-policy to prevent indexing sensitive files into the
    // FTS5 store, which would otherwise be queryable via ctx_search and
    // exfiltrate content into the model's context (issue #442). Mirrors the
    // check ctx_execute_file already performs.
    if (path) {
      const pathDenied = checkFilePathDenyPolicy(path, "ctx_index");
      if (pathDenied) return pathDenied;
    }

    try {
      const resolvedPath = path ? resolveProjectPath(path) : undefined;

      // Directory dispatch (#687, reported by @matiasduartee). When the
      // resolved path is a directory, walk it bounded and re-enter `index()`
      // per-file so the security gate at store.ts:845 (TOCTOU defense from
      // #442 round-3) keeps running for every file.
      //
      // Root-level symlink defense: the deny-glob check above ran on the
      // user-supplied `path`. If `path` is a symlink whose target lands in
      // a sensitive directory (e.g. `/tmp/link -> /etc`), statSync would
      // happily report directory and walkDirectoryDetailed would
      // realpathSync internally, walking /etc with the user's deny globs
      // bound to /tmp/link instead of the real target. Detect the symlink
      // with lstatSync, follow it once, and re-apply the deny check
      // against the realpath so the user's deny globs see the actual
      // walk root.
      if (resolvedPath && existsSync(resolvedPath)) {
        const lst = lstatSync(resolvedPath);
        if (lst.isSymbolicLink()) {
          let realTarget: string;
          try {
            realTarget = realpathSync(resolvedPath);
          } catch {
            return trackResponse("ctx_index", {
              content: [{ type: "text" as const, text: "Error: symlink target could not be resolved." }],
            });
          }
          if (realTarget !== resolvedPath) {
            const realDenied = checkFilePathDenyPolicy(realTarget, "ctx_index");
            if (realDenied) return realDenied;
          }
        }
      }
      if (resolvedPath && existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
        const store = getStore();
        const projectDir = getProjectDir();
        const denyGlobs = readToolDenyPatterns("Read", projectDir);
        const isWin32 = process.platform === "win32";
        const perFileDeny = (absPath: string): boolean => {
          try {
            return isRecoveryBriefIndexPath(absPath)
              || evaluateFilePath(absPath, denyGlobs, isWin32, projectDir).denied;
          } catch {
            return false; // fail-open consistent with checkFilePathDenyPolicy
          }
        };
        const dirResult = store.indexDirectory({
          path: resolvedPath,
          source: source ?? resolvedPath,
          attribution: currentAttribution(),
          perFileDeny,
          include,
          exclude,
          maxDepth,
          maxFiles,
          extensions,
          respectGitignore,
          followSymlinks,
        });
        const capNote = dirResult.capped
          ? ` (cap reached — only first ${dirResult.filesIndexed} of ${dirResult.totalSeen}+ files; raise maxFiles to index more)`
          : "";
        const denyNote = dirResult.denied > 0
          ? ` (${dirResult.denied} file${dirResult.denied === 1 ? "" : "s"} blocked by Read deny policy)`
          : "";
        const failNote = dirResult.failed > 0
          ? ` (${dirResult.failed} file${dirResult.failed === 1 ? "" : "s"} failed to read)`
          : "";
        return trackResponse("ctx_index", {
          content: [
            {
              type: "text" as const,
              text: `Indexed ${dirResult.filesIndexed} file${dirResult.filesIndexed === 1 ? "" : "s"} ` +
                `(${dirResult.totalChunks} sections) from directory: ${dirResult.label}${capNote}${denyNote}${failNote}. ` +
                `Search: ctx_search(queries: ["..."], source: "${dirResult.label}").`,
            },
          ],
        });
      }

      // Track the raw bytes being indexed (content or file)
      if (content) trackIndexed(Buffer.byteLength(content));
      else if (resolvedPath) {
        try {
          const fs = await import("fs");
          trackIndexed(fs.readFileSync(resolvedPath).byteLength);
        } catch { /* ignore — file read errors handled by store */ }
      }
      const store = getStore();
      const result = store.index({ content, path: resolvedPath, source: source ?? resolvedPath, attribution: currentAttribution() });

      return trackResponse("ctx_index", {
        content: [
          {
            type: "text" as const,
            text: `Indexed ${result.totalChunks} sections (${result.codeChunks} with code) from: ${result.label}. ` +
              `Search: ctx_search(queries: ["..."], source: "${result.label}").`,
          },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return trackResponse("ctx_index", {
        content: [
          { type: "text" as const, text: `Index error: ${message}` },
        ],
        isError: true,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────
// Tool: search — progressive throttling
// ─────────────────────────────────────────────────────────

// Track search calls per N-second window for progressive throttling.
// Defaults preserve the historical behavior (60s window, soft-cap at 3
// calls, hard-block at 8). All three thresholds are overridable via env
// vars so users can loosen or tighten the policy without forking. Invalid
// values (non-positive numbers, NaN) fall back to the default to avoid
// silently disabling the protection.
function readPositiveEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const SEARCH_WINDOW_MS = readPositiveEnv("CONTEXT_MODE_SEARCH_WINDOW_MS", 60_000);
const SEARCH_MAX_RESULTS_AFTER = readPositiveEnv("CONTEXT_MODE_SEARCH_MAX_RESULTS_AFTER", 3); // after N calls: 1 result per query
const SEARCH_BLOCK_AFTER = readPositiveEnv("CONTEXT_MODE_SEARCH_BLOCK_AFTER", 8); // after N calls: refuse, demand batching

// #769: progressive throttle bucketed PER agent-context, not machine-global.
// Concurrent subagents share ONE MCP server process; a single global counter
// summed their independent searches into one budget and hard-blocked
// legitimate parallel fan-out. The guard keys each actor's window separately
// so single-actor flood protection is preserved while fan-out is not starved.
const searchFloodGuard = new FloodGuard({
  windowMs: SEARCH_WINDOW_MS,
  softCapAfter: SEARCH_MAX_RESULTS_AFTER,
  blockAfter: SEARCH_BLOCK_AFTER,
});

/**
 * Per-agent flood-guard key. Each concurrent subagent in a Claude Code
 * Task/Workflow fan-out runs under its own session id (written to SessionDB
 * via hooks), so currentAttribution().sessionId is the per-agent discriminator
 * already available MCP-side. Falls back to a single shared bucket when no
 * identity is resolvable (preserves today's single-threaded behaviour).
 */
function searchFloodGuardKey(): string {
  try {
    return currentAttribution()?.sessionId ?? "__default__";
  } catch {
    return "__default__";
  }
}

/**
 * Defensive coercion: parse stringified JSON arrays, AND lift a bare
 * non-empty string into a single-element array.
 *
 * Two shapes show up from the wild:
 *   1. `"[\"a\",\"b\"]"` — Claude Code double-serialization bug
 *      (https://github.com/anthropics/claude-code/issues/34520).
 *   2. `"single query"` — some LLM providers / OpenCode's native plugin
 *      bridge deliver a single string when the schema expects `string[]`
 *      (issue #627). v1.0.139 (#621) made the bridge run the Zod schema,
 *      so this now surfaces as `Expected array, received string`. The
 *      ergonomic recovery is to treat it as `["single query"]`.
 *
 * An empty string is intentionally NOT lifted — empty input should still
 * fail Zod's `.min(1)` check rather than masquerade as `[""]`.
 */
function coerceJsonArray(val: unknown): unknown {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length === 0) return val; // let zod produce "non-empty" error
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through — not JSON, treat as bare-string lift */ }
    // Bare-string lift (#627): single query delivered as a plain string.
    return [val];
  }
  return val;
}

/**
 * Defensive coercion: accept the string literals "true"/"false" as
 * booleans. The OpenCode native plugin bridge (and several LLM providers'
 * tool-call JSON) stringifies primitives — `background:"false"` instead
 * of `background:false`, `confirm:"true"` instead of `confirm:true`.
 *
 * We deliberately do NOT use `z.coerce.boolean()` for boolean fields:
 * `Boolean("false")` is `true`, so Zod's coerce path silently flips the
 * meaning. This helper recognises only the documented literal forms and
 * passes anything else through untouched so Zod surfaces the right error.
 *
 * Fixes #627.
 */
function coerceBoolean(val: unknown): unknown {
  if (typeof val === "string") {
    const t = val.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return val;
}

/**
 * Coerce commands array: handles double-serialization AND the case where
 * the model passes plain command strings instead of {label, command} objects.
 */
function coerceCommandsArray(val: unknown): unknown {
  const arr = coerceJsonArray(val);
  if (Array.isArray(arr)) {
    return arr.map((item, i) =>
      typeof item === "string" ? { label: `cmd_${i + 1}`, command: item } : item
    );
  }
  return arr;
}

server.registerTool(
  "ctx_search",
  {
    title: "Search Indexed Content",
    // #846: read-only query over the local FTS5 store. No mutation, no network.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: `Search content that already exists in context-mode's persistent FTS5 knowledge base. This is not online search, a live filesystem or repository scan, CodeGraph-style relationship analysis, or an authoritative source of current project facts. Porter stemming, trigram substring matching, Reciprocal Rank Fusion, proximity reranking, typo correction, and matched-term windows improve retrieval.

Queries reach content explicitly retained by ctx_index, trusted ctx_fetch_and_index calls, verified execution persistence, and auto-captured session memory written by hooks. Default ctx_execute, ctx_execute_file, and ctx_batch_execute output is request-local and is not visible here. File-backed sources carry a content hash and can flag staleness when the source file changes.

WHEN:
  - You want to recall something that exists in storage (recently indexed content, prior session events, auto-memory) instead of re-reading raw sources
  - You have multiple related questions about the same body of knowledge — batch every question into one call (the ranking pipeline runs per-query but the round-trip cost is paid once)
  - You want to scope the query to one labelled source (pass \`source\` — partial match is fine)
  - You want a chronological view across current session + prior sessions + persistent auto-memory (pass \`sort: "timeline"\` — the default \`relevance\` mode only ranks within the current session)
  - You want to filter ranked results by content shape (pass \`contentType: "code"\` to surface implementation snippets or \`contentType: "prose"\` to surface explanations)

WHEN NOT:
  - The data has never been explicitly retained and no session memory covers it — use current local tools, CodeGraph, or request-local context-mode processing instead
  - You have one ad-hoc question against data that is not in the knowledge base — answer it inline by running code in the sandbox tool; one round-trip instead of capture-then-query

RETURNS:
  Per-query ranked sections with window-extracted snippets. Use 2-4 specific technical terms per query. Common session-memory source labels: \`decision\` (user corrections / preferences), \`error\` and \`error-resolution\` (past failures + their fixes), \`blocker\`, \`plan\`, \`user-prompt\`, \`rejected-approach\`, \`compaction\` (post-compact session guide). See ctx_stats for live category counts. Each response carries a throttle counter (call #N/M in the rolling time window); results taper toward the soft cap and calls block after the hard cap. Tune via CONTEXT_MODE_SEARCH_WINDOW_MS, CONTEXT_MODE_SEARCH_MAX_RESULTS_AFTER, CONTEXT_MODE_SEARCH_BLOCK_AFTER.

EXAMPLE: ctx_search(queries: ["root cause", "proposed fix", "test coverage"], source: "issue-#683")
EXAMPLE: ctx_search(queries: ["what did we decide about caching"], source: "decision", sort: "timeline")
EXAMPLE: ctx_search(queries: ["useEffect cleanup pattern"], source: "react-docs", contentType: "code", limit: 5)
EXAMPLE: ctx_search(queries: ["last user prompt", "active skills", "open blockers"], sort: "timeline")`,
    // Schema construction is centralised in `src/search/ctx-search-schema.ts`
    // so the conditional `project` field (only registered when the host runs
    // in shared-DB mode, `CONTEXT_MODE_PROJECT_DIR` set at module load) is a
    // hard property of the tool surface — not a runtime hint. Fixes #737.
    inputSchema: buildCtxSearchInputSchema(CTX_SEARCH_SHARED_MODE),
  },
  async (params) => {
    try {
      const store = getStore();
      const sort = (params as Record<string, unknown>).sort as string || "relevance";

      // Guard: redirect when the index is empty — ctx_search is a follow-up
      // tool that requires prior indexing. Skip for timeline mode (SessionDB/auto-memory may have data).
      if (sort !== "timeline" && store.getStats().chunks === 0) {
        return trackResponse("ctx_search", {
          content: [{
            type: "text" as const,
            text: "Knowledge base is empty. Query current data with local tools or request-local execution. " +
              "For later recall, explicitly retain locally verified content with ctx_index(path, source), " +
              "verified execution persistence, or a trusted ctx_fetch_and_index request.",
          }],
          isError: true,
        });
      }

      const raw = params as Record<string, unknown>;

      // Normalize: accept both query (string) and queries (array)
      const queryList: string[] = [];
      if (Array.isArray(raw.queries) && raw.queries.length > 0) {
        queryList.push(...(raw.queries as string[]));
      } else if (typeof raw.query === "string" && raw.query.length > 0) {
        queryList.push(raw.query as string);
      }

      if (queryList.length === 0) {
        return trackResponse("ctx_search", {
          content: [{ type: "text" as const, text: "Error: provide query or queries." }],
          isError: true,
        });
      }

      const { limit = 3, source, contentType, project } = params as {
        limit?: number;
        source?: string;
        contentType?: "code" | "prose";
        project?: string;
      };

      // Resolve the per-project scope (#737). When shared-DB mode is off the
      // resolver returns `undefined` and `project` is silently ignored — the
      // per-project DB is naturally isolated by directory hash, so there is
      // nothing for an in-process filter to do.
      const projectScope = resolveProjectScope(
        project,
        CTX_SEARCH_SHARED_MODE,
        () => getProjectDir(),
      );

      // Progressive throttling: track calls per agent-context window (#769).
      const now = Date.now();
      const flood = searchFloodGuard.record(searchFloodGuardKey(), now);
      const searchCallCount = flood.count;

      // After SEARCH_BLOCK_AFTER calls (for THIS agent): refuse
      if (flood.blocked) {
        return trackResponse("ctx_search", {
          content: [{
            type: "text" as const,
            text: `BLOCKED: ${searchCallCount} search calls in ${Math.round((now - flood.windowStart) / 1000)}s. ` +
              "Use one ctx_batch_execute(commands, queries) call for the next research step.",
          }],
          isError: true,
        });
      }

      // Determine per-query result limit based on throttle level
      const effectiveLimit = flood.softCapped
        ? 1 // after soft cap: only 1 result per query
        : Math.min(limit, 2); // normal: max 2

      const MAX_TOTAL = 40 * 1024; // 40KB total cap
      let totalSize = 0;
      const sections: string[] = [];

      // Open SessionDB once before the loop (Blocker 4: avoid open/close per query).
      // Issue #737: also open in relevance mode when a string `projectScope`
      // is in play — the 2-step IN-clause needs SessionDB to translate
      // `project_dir` → allow-set of session ids for the ContentStore filter.
      let timelineDB: InstanceType<typeof SessionDB> | null = null;
      const needsSessionDB = sort === "timeline" || typeof projectScope === "string";
      if (needsSessionDB) {
        try {
          const sessionsDir = getSessionDir();
          const projectDir = getProjectDir();
          const dbFile = resolveSessionDbPath({ projectDir, sessionsDir });
          if (existsSync(dbFile)) {
            timelineDB = new SessionDB({ dbPath: dbFile });
          }
        } catch { /* SessionDB unavailable — search ContentStore + auto-memory only */ }
      }

      // Resolve the session-id allow-set once for the relevance-mode path —
      // searchAllSources resolves its own copy for timeline mode. Empty set
      // is preserved (means "no events for this project"), which surfaces
      // only legacy `session_id=''` chunks via the post-filter.
      let relevanceAllowSet: Set<string> | undefined;
      if (typeof projectScope === "string" && timelineDB) {
        try {
          relevanceAllowSet = new Set(timelineDB.getSessionIdsForProject(projectScope));
        } catch { /* best-effort */ }
      }

      const configDir = _detectedAdapter?.getConfigDir() ?? resolveClaudeConfigDir();

      try {
      for (const q of queryList) {
        const queryTitle = renderBoundedTitle(q, PRESENTATION_POLICY);
        if (totalSize > MAX_TOTAL) {
          sections.push(`## ${queryTitle}\n(output cap reached)\n`);
          continue;
        }

        let results;
        if (sort === "timeline") {
          results = searchAllSources({
            query: q,
            limit: effectiveLimit,
            store,
            sort,
            source,
            contentType,
            sessionDB: timelineDB,
            projectDir: getProjectDir(),
            configDir,
            adapter: _detectedAdapter ?? undefined,
            projectScope,
          });
        } else {
          results = store.searchWithFallback(
            q,
            effectiveLimit,
            source,
            contentType,
            "like",
            relevanceAllowSet,
          );
        }

        if (results.length === 0) {
          sections.push(`## ${queryTitle}\nNo results found.`);
          continue;
        }

        const formatted = results
          .map((r, i) => {
            const origin = (r as any).origin || "current-session";
            const ts = (r as any).timestamp ? (r as any).timestamp.slice(0, 16).replace("T", " ") : "";
            const header = `--- [${origin}${ts ? " | " + ts : ""} | ${r.source}] ---`;
            const heading = `### ${renderBoundedTitle(r.title, PRESENTATION_POLICY)}`;
            const snippet = extractSnippet(
              r.content,
              q,
              PRESENTATION_POLICY.resultPreviewChars,
              r.highlighted,
            );
            return `${header}\n${heading}\n\n${snippet}`;
          })
          .join("\n\n");

        sections.push(`## ${queryTitle}\n\n${formatted}`);
        totalSize += formatted.length;
      }
      } finally {
        try { timelineDB?.close(); } catch {}
      }

      let output = sections.join("\n\n---\n\n");

      // Report auto-refreshed stale sources
      if (store.lastRefreshCount > 0) {
        output = `> Auto-refreshed ${store.lastRefreshCount} stale source${store.lastRefreshCount > 1 ? "s" : ""} (file changed since indexing).\n\n` + output;
      }

      // Throttle counter — always surfaced so agents can pace themselves
      // proactively instead of discovering the limit only after results are
      // already truncated. Soft warning after SEARCH_MAX_RESULTS_AFTER calls;
      // gentle informational line before that.
      const throttleRemaining = Math.max(0, SEARCH_BLOCK_AFTER - searchCallCount);
      const softCapRemaining = Math.max(0, SEARCH_MAX_RESULTS_AFTER - searchCallCount);
      if (searchCallCount >= SEARCH_MAX_RESULTS_AFTER) {
        output += `\n\n⚠ search call #${searchCallCount}/${SEARCH_BLOCK_AFTER}; ` +
          `${effectiveLimit} result/query; ${throttleRemaining} calls before block. Batch queries in one call.`;
      } else {
        output += `\n\nThrottle: call #${searchCallCount}/${SEARCH_BLOCK_AFTER}; ` +
          `${softCapRemaining} calls before soft cap. Batch queries in one call.`;
      }

      if (output.trim().length === 0) {
        const sources = store.listSources();
        const sourceList = sources.length > 0
          ? `\nIndexed sources: ${sources.map((s) => `"${s.label}" (${s.chunkCount} sections)`).join(", ")}`
          : "";
        return trackResponse("ctx_search", {
          content: [{ type: "text" as const, text: `No results found.${sourceList}` }],
        });
      }

      return trackResponse("ctx_search", {
        content: [{ type: "text" as const, text: output }],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return trackResponse("ctx_search", {
        content: [{ type: "text" as const, text: `Search error: ${message}` }],
        isError: true,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────
// Turndown path resolution (external dep, like better-sqlite3)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Tool: fetch_and_index
// ─────────────────────────────────────────────────────────

// Subprocess code that fetches a URL, detects Content-Type, and outputs a
// __CM_CT__:<type> marker on the first line so the handler can route to the
// appropriate indexing strategy.  HTML is converted to markdown via Turndown.
export function buildFetchCode(url: string, outputPath: string): string {
  const fetchWorkerPath = resolve(getPackageRoot(), "fetch-worker.bundle.cjs");
  if (!existsSync(fetchWorkerPath)) {
    throw new Error(
      `context-mode fetch worker is missing: ${fetchWorkerPath}. Rebuild the release bundle before starting the plugin.`,
    );
  }

  const strict = process.env.CTX_FETCH_STRICT === "1";
  const fetchWorkerSource = readFileSync(fetchWorkerPath, "utf8");
  return `${fetchWorkerSource}\nmodule.exports.runFetchWorker(${JSON.stringify(url)}, ${JSON.stringify(outputPath)}, ${JSON.stringify(strict)}).catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });\n`;
}

// ─────────────────────────────────────────────────────────
// fetch_and_index helpers — split into parallel-safe fetch and serial-only index
// ─────────────────────────────────────────────────────────

const FETCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_PREVIEW_LIMIT = 3072;

function formatFetchTtl(ttlMs: number): string {
  if (ttlMs === 0) return "0ms";
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (ttlMs % day === 0) return `${ttlMs / day}d`;
  if (ttlMs % hour === 0) return `${ttlMs / hour}h`;
  if (ttlMs % minute === 0) return `${ttlMs / minute}m`;
  return `${ttlMs}ms`;
}

type FetchOneResult =
  | { kind: "cached"; label: string; chunkCount: number; estimatedBytes: number; ageStr: string; ttlStr: string }
  | { kind: "fetched"; url: string; source?: string; markdown: string; header: string }
  | { kind: "fetch_error"; url: string; error: string; reason: "exit" | "read" | "empty" | "throw" };

/**
 * Pure fetch step — TTL cache check + subprocess fetch. SAFE TO RUN IN PARALLEL.
 * Performs zero SQLite writes (only reads source meta). Caller must funnel
 * fetched results through `indexFetched` serially to avoid FTS5 WAL contention.
 */
/**
 * SSRF guard for ctx_fetch_and_index: validate URL scheme + resolve target IP +
 * block link-local / IMDS / multicast / reserved IP ranges. Returns null if
 * safe; returns a FetchOneResult fetch_error if blocked.
 *
 * Policy (PR #401 ops review, developer-friendly default):
 *
 * **HARD BLOCK** (no legitimate dev workflow):
 *   - file://, gopher://, javascript:, data: schemes (only http: and https:)
 *   - 169.254.0.0/16 link-local (INCLUDES 169.254.169.254 = AWS/GCP/Azure IMDS
 *     cloud credential endpoint — high-value target for indirect prompt injection)
 *   - IPv6 link-local fe80::/10
 *   - Multicast (224+ IPv4, ff00::/8 IPv6) and reserved (0.0.0.0/8) ranges
 *
 * **ALLOW by default** (legitimate developer use cases dominate):
 *   - localhost, 127.x.x.x, ::1 (local dev servers — Next.js, Vite, Postgres, …)
 *   - 10.x, 172.16-31.x, 192.168.x RFC1918 private (developer's internal network)
 *
 * **STRICT MODE** opt-in via env var: `CTX_FETCH_STRICT=1`
 *   - Blocks loopback + RFC1918 too
 *   - For hosted/CI environments where the runtime isn't the user's own machine
 *
 * DNS resolution is performed against the resolved IP (not just URL parse) so a
 * hostname like `evil.com` pointing to 169.254.169.254 is rejected — defends
 * against attacker-controlled DNS records and DNS rebinding.
 */
async function ssrfGuard(rawUrl: string): Promise<FetchOneResult | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "fetch_error", url: rawUrl, error: "invalid URL", reason: "exit" };
  }

  // 1. Scheme allowlist — http and https only
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      kind: "fetch_error",
      url: rawUrl,
      error: `URL scheme "${parsed.protocol}" not allowed (only http: and https:)`,
      reason: "exit",
    };
  }

  const strict = process.env.CTX_FETCH_STRICT === "1";

  // 2. DNS resolve + check IP ranges (hard-block + optional strict-mode block)
  try {
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(parsed.hostname, { all: true, verbatim: true });
    for (const rec of records) {
      const verdict = classifyIp(rec.address);
      if (verdict === "block") {
        return {
          kind: "fetch_error",
          url: rawUrl,
          error: `URL "${parsed.hostname}" resolves to ${rec.address} — blocked (link-local / IMDS / multicast / reserved)`,
          reason: "exit",
        };
      }
      if (verdict === "private" && strict) {
        return {
          kind: "fetch_error",
          url: rawUrl,
          error: `URL "${parsed.hostname}" resolves to private IP ${rec.address} — blocked under CTX_FETCH_STRICT=1`,
          reason: "exit",
        };
      }
    }
  } catch (err) {
    // libuv DNS error codes that typically indicate the resolver itself can't
    // reach a nameserver — common when the MCP host process is running under
    // a sandbox that blocks outbound network, OR a transient upstream DNS
    // hiccup. Append an imperative retry hint so the agent does not capitulate
    // to training data on the FIRST transient failure (PR #654 substitute —
    // sibling-tool consistency with hooks/core/routing.mjs WebFetch wording).
    const errCode = (err as NodeJS.ErrnoException | undefined)?.code ?? "";
    const isTransientDns = errCode === "ETIMEOUT" || errCode === "ETIMEDOUT" ||
      errCode === "EAI_AGAIN" || errCode === "ENETUNREACH" || errCode === "EPERM";
    const baseMsg = err instanceof Error ? err.message : String(err);
    const hint = isTransientDns
      ? " — transient DNS error; retry once before falling back. If it keeps failing, the MCP host may be running under a network sandbox; restart the host with network access enabled."
      : "";
    return {
      kind: "fetch_error",
      url: rawUrl,
      error: `DNS lookup failed for "${parsed.hostname}": ${baseMsg}${hint}`,
      reason: "exit",
    };
  }

  return null; // safe to fetch
}

/**
 * Classify an IP address.
 *   - "block":    always blocked (link-local/IMDS/multicast/reserved/malformed)
 *   - "private":  loopback or RFC1918 — allowed by default, blocked in strict mode
 *   - "public":   safe to fetch
 *
 * Exported (via the function name) so SSRF tests can exercise the matcher directly.
 */
export function classifyIp(rawIp: string): "block" | "private" | "public" {
  // RFC 6874 zone identifiers (`fe80::1%eth0`, URL-encoded `%25eth0`) must
  // be stripped BEFORE any prefix/equality classification. Without the strip,
  // a loopback `::1%eth0` no longer matches `lower === "::1"` and falls
  // through to "public" — silently bypassing the SSRF guard. Strip first,
  // classify second.
  const pctIdx = rawIp.indexOf("%");
  const ip = pctIdx === -1 ? rawIp : rawIp.slice(0, pctIdx);
  const lower = ip.toLowerCase();

  // IPv6 takes priority — check for `:` first so IPv4-mapped addresses
  // (`::ffff:127.0.0.1`) don't get incorrectly routed through the IPv4 parser.
  if (lower.includes(":")) {
    // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — recurse through IPv4 classifier
    const v4MappedMatch = lower.match(/^::ffff:([\d.]+)$/);
    if (v4MappedMatch) return classifyIp(v4MappedMatch[1]);
    // Hard-block
    if (lower === "::") return "block"; // unspecified
    if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
        lower.startsWith("fea") || lower.startsWith("feb")) return "block"; // fe80::/10 link-local
    if (lower.startsWith("ff")) return "block"; // ff00::/8 multicast
    // Private (loopback + ULA)
    if (lower === "::1") return "private";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "private"; // fc00::/7 ULA
    return "public";
  }

  // IPv4 (or non-IP string — malformed = block)
  if (!ip.includes(".")) return "block"; // not an IP at all
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return "block";
  const [a, b] = parts;
  // Hard-block (no legitimate use)
  if (a === 169 && b === 254) return "block"; // link-local incl. 169.254.169.254 (IMDS)
  if (a === 0) return "block";                 // 0.0.0.0/8 (current network)
  if (a >= 224) return "block";                // 224.0.0.0+ multicast/reserved
  // Private (loopback + RFC1918) — allow by default
  if (a === 127) return "private";                          // 127.0.0.0/8 loopback
  if (a === 10) return "private";                           // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return "private";    // 172.16.0.0/12
  if (a === 192 && b === 168) return "private";             // 192.168.0.0/16
  return "public";
}

async function fetchOneUrl(url: string, source: string | undefined, force: boolean | undefined, ttl: number | undefined): Promise<FetchOneResult> {
  // SSRF guard — reject file://, javascript:, loopback, RFC1918, IMDS, link-local
  // BEFORE any cache lookup or subprocess spawn. Even cached entries shouldn't
  // serve a previously-poisoned source label.
  const ssrfBlock = await ssrfGuard(url);
  if (ssrfBlock) return ssrfBlock;

  if (!force && ttl !== 0) {
    const store = getStore();
    // Cache key composes (source, url) so two distinct URLs sharing the same
    // `source` label do not collide — they each get their own cache slot
    // (commit 1f1243e regression test enforced).
    const cacheKey = composeFetchCacheKey(source, url);
    const meta = store.getSourceMeta(cacheKey);
    if (meta) {
      const indexedAt = new Date(meta.indexedAt + "Z"); // SQLite datetime is UTC without Z
      const ageMs = Date.now() - indexedAt.getTime();
      const cacheTtlMs = ttl ?? FETCH_TTL_MS;
      if (ageMs < cacheTtlMs) {
        const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
        const ageMin = Math.floor(ageMs / (60 * 1000));
        const ageStr = ageHours > 0 ? `${ageHours}h ago` : ageMin > 0 ? `${ageMin}m ago` : "just now";
        const estimatedBytes = meta.chunkCount * 1600; // ~1.6KB/chunk avg
        return { kind: "cached", label: meta.label, chunkCount: meta.chunkCount, estimatedBytes, ageStr, ttlStr: formatFetchTtl(cacheTtlMs) };
      }
      // Stale — fall through to re-fetch silently
    }
  }

  const outputPath = join(tmpdir(), `ctx-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}.dat`);
  try {
    const fetchCode = buildFetchCode(url, outputPath);
    const result = await executor.execute({
      language: "javascript",
      code: fetchCode,
      timeout: 30_000,
    });
    if (result.exitCode !== 0) {
      // Subprocess fetch failure — undici / fetch can surface EAI_AGAIN /
      // ETIMEDOUT / ENETUNREACH in stderr when the resolver is overloaded
      // or the network is briefly unavailable. Append the same retry hint
      // ssrfGuard's pre-flight DNS path emits so the agent doesn't capitulate
      // to training data on the first transient failure (PR #654 substitute —
      // sibling-tool consistency with hooks/core/routing.mjs WebFetch wording).
      const raw = result.stderr || result.stdout || "unknown error";
      const isTransientDns = /\b(EAI_AGAIN|ETIMEDOUT|ETIMEOUT|ENETUNREACH|EPERM|getaddrinfo)\b/.test(raw);
      const hint = isTransientDns
        ? " — transient DNS error; retry once before falling back. If it keeps failing, the MCP host may be running under a network sandbox; restart the host with network access enabled."
        : "";
      return { kind: "fetch_error", url, error: `${raw}${hint}`, reason: "exit" };
    }
    const header = (result.stdout || "").trim();
    let markdown: string;
    try {
      // Parent-side defense-in-depth on the subprocess output size. The
      // embedded safeText() in buildFetchCode already caps before writing,
      // but a torn write (subprocess killed mid-write, fs cache desync,
      // etc.) could still leave an oversized file. Bail before slurping
      // multiple gigabytes into the long-running MCP server's heap.
      const MAX_FETCH_OUTPUT_BYTES = 50 * 1024 * 1024;
      const fileSize = statSync(outputPath).size;
      if (fileSize > MAX_FETCH_OUTPUT_BYTES) {
        return { kind: "fetch_error", url, error: `subprocess output ${fileSize} bytes exceeds cap ${MAX_FETCH_OUTPUT_BYTES}`, reason: "read" };
      }
      markdown = readFileSync(outputPath, "utf-8").trim();
    } catch {
      return { kind: "fetch_error", url, error: "could not read subprocess output", reason: "read" };
    }
    if (markdown.length === 0) {
      return { kind: "fetch_error", url, error: "empty content", reason: "empty" };
    }
    return { kind: "fetched", url, source, markdown, header };
  } catch (err: unknown) {
    return {
      kind: "fetch_error",
      url,
      error: err instanceof Error ? err.message : String(err),
      reason: "throw",
    };
  } finally {
    try { rmSync(outputPath); } catch { /* already gone */ }
  }
}

interface IndexedFetchResult {
  label: string;
  totalChunks: number;
  totalBytes: number;
  preview: string;
}

/**
 * Serial-only indexing step — single FTS5 write per call. Caller loops over
 * fetched results and calls this one-at-a-time to avoid SQLite WAL contention
 * (PRD finding E).
 */
function indexFetched(f: { url: string; source?: string; markdown: string; header: string }): IndexedFetchResult {
  const store = getStore();
  // Storage label composed via composeFetchCacheKey so two URLs sharing a
  // `source` label do not overwrite each other (commit 1f1243e). ctx_search()
  // still finds both via LIKE-mode source filter on the `source` substring.
  const storageLabel = composeFetchCacheKey(f.source, f.url);
  const attribution = currentAttribution();
  let indexed: IndexResult;
  if (f.header === "__CM_CT__:json") {
    indexed = store.indexJSON(f.markdown, storageLabel, undefined, attribution);
  } else if (f.header === "__CM_CT__:text") {
    indexed = store.indexPlainText(f.markdown, storageLabel, undefined, attribution);
  } else {
    indexed = store.index({ content: f.markdown, source: storageLabel, attribution });
  }
  // Track AFTER the FTS5 write succeeds — failed indexes shouldn't inflate the counter.
  trackIndexed(Buffer.byteLength(f.markdown));
  const preview = f.markdown.length > FETCH_PREVIEW_LIMIT
    ? charSafePrefix(f.markdown, FETCH_PREVIEW_LIMIT) + "\n\n…[truncated — use ctx_search() for full content]"
    : f.markdown;
  return {
    label: indexed.label,
    totalChunks: indexed.totalChunks,
    totalBytes: Buffer.byteLength(f.markdown),
    preview,
  };
}

server.registerTool(
  "ctx_fetch_and_index",
  {
    title: "Fetch & Index URL(s)",
    // #846: fetches external URLs (open world) and writes them into the store.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: `Explicitly fetch and retain user-selected, trusted URL content. HTML is converted to markdown, JSON is chunked by key path, and plain text is indexed directly. This tool performs network I/O and persistent FTS5 writes; it is not the default web or external-candidate workflow.

Caching: every fetch is cached on disk and reused for repeat calls within the TTL window. The default TTL is 24 hours; override per-call with the \`ttl\` parameter (milliseconds, \`ttl: 0\` bypasses cache like \`force: true\`). Stored content older than 14 days is cleaned up on startup.

WHEN:
  - The user selected a trusted documentation/spec URL and explicitly wants persistent later recall
  - Multi-URL research (library evaluation, migration scans, doc comparisons): pass the \`requests\` array and a \`concurrency\` value 2-8 for parallel I/O
  - You want repeat lookups against the same URL to be cheap (TTL cache hits return only a hint, no re-fetch)
  - You want a long-lived cache window (override \`ttl\` upward for stable specs) or a guaranteed-fresh fetch (\`ttl: 0\` or \`force: true\`)

WHEN NOT:
  - Fast Context or another external tool returned an unverified candidate — preserve its direct protocol, verify locally, and do not persist by default
  - One-shot web/API analysis that does not require retention — use the original protocol or a host-written artifact with ctx_execute_file
  - You already have locally verified content — retain a selected path with ctx_index(path) only when later recall is explicitly needed
  - The page is SPA-rendered (JavaScript-required to materialize content) — this is a plain HTTP fetch, no headless browser

RETURNS:
  Per-source preview windows extracted around indexable headings plus indexing metadata (chunk counts, source labels, cache state). Raw content is NOT echoed back — retrieve any section on-demand via ctx_search(source: "<label>"). Concurrency parallelizes the fetch phase up to your chosen value (capped by the host's logical CPU count); the FTS5 write phase always runs serially because SQLite is a single-writer store. Net latency = max(fetch latency across the pool) + sum(per-source index write time). Cache hits skip both phases and return a small freshness hint instead of re-fetching. Use 4-8 for stable I/O-bound batches; lower the value when the target host enforces a per-IP rate limit you cannot raise.

EXAMPLE: ctx_fetch_and_index(
  requests: [{url: "https://react.dev/...", source: "react"}, {url: "https://vuejs.org/...", source: "vue"}],
  concurrency: 5
)`,
    inputSchema: z.object({
      url: z.string().optional().describe("Single URL to fetch and index (legacy single-shape)"),
      source: z
        .string()
        .optional()
        .describe(
          "Label for the indexed content when using single `url` (e.g., 'React useEffect docs', 'Supabase Auth API'). For batch, put source in each requests entry.",
        ),
      requests: z
        .preprocess(
          coerceJsonArray,
          z.array(
            z.object({
              url: z.string().describe("URL to fetch"),
              source: z.string().optional().describe("Label for this URL's indexed content"),
            }),
          ).min(1),
        )
        .optional()
        .describe(
          "Batch shape: array of {url, source?} entries. Use with concurrency>1 for parallel fetch. " +
          "Each request indexed under its own source label. Output preserves input order.",
        ),
      concurrency: z
        .coerce.number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .default(1)
        .describe(
          "Max URLs to fetch in parallel (1-8, default: 1). " +
          "Use 4-8 for I/O-bound multi-URL batches (library docs, changelogs, pricing pages). " +
          "Capped by os.cpus().length on small machines (response notes when capped). " +
          "Indexing is always serial regardless — only fetches race.",
        ),
      force: z
        .preprocess(coerceBoolean, z.boolean())
        .optional()
        .describe("Skip cache and re-fetch even if content was recently indexed"),
      ttl: z
        .coerce.number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Override the cache freshness window for this call, in milliseconds. " +
          "`ttl: 0` bypasses the cache like `force: true`; omit to use the default 24h TTL.",
        ),
    }),
  },
  async ({ url, source, requests, concurrency, force, ttl }) => {
    // Normalize input: legacy {url} or new {requests: [...]}.
    // requests wins when both are provided (explicit batch intent).
    const batch: { url: string; source?: string }[] = requests
      ? requests
      : url
        ? [{ url, source }]
        : [];

    if (batch.length === 0) {
      return trackResponse("ctx_fetch_and_index", {
        content: [{
          type: "text" as const,
          text: "ctx_fetch_and_index requires either `url` (single) or `requests: [{url, source?}, ...]` (batch).",
        }],
        isError: true,
      });
    }

    const isLegacySingle = !requests && batch.length === 1;
    const requestedConcurrency = concurrency ?? 1;

    // Parallel fetch via shared runPool primitive. capByCpuCount only for batch
    // — single-URL doesn't need the cap (only one job, executor is one subprocess).
    const jobs: PoolJob<FetchOneResult>[] = batch.map((req) => ({
      run: () => fetchOneUrl(req.url, req.source, force, ttl),
    }));
    const { settled, effectiveConcurrency, capped } = await runPool(jobs, {
      concurrency: requestedConcurrency,
      capByCpuCount: !isLegacySingle && requestedConcurrency > 1,
    });

    // Serial index drain — workers race on fetch, but store.index* runs one at a time.
    type Finalized =
      | { kind: "cached"; label: string; chunkCount: number; ageStr: string; ttlStr: string }
      | { kind: "fetched"; indexed: IndexedFetchResult }
      | { kind: "fetch_error"; url: string; error: string; reason: "exit" | "read" | "empty" | "throw" }
      | { kind: "job_error"; url: string; error: string };

    const finalized: Finalized[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === "rejected") {
        const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
        finalized.push({ kind: "job_error", url: batch[i].url, error: message });
        continue;
      }
      const v = r.value;
      if (v.kind === "cached") {
        sessionStats.cacheHits++;
        sessionStats.cacheBytesSaved += v.estimatedBytes;
        // D2 Phase 5/7 — cache-hit event emission. `bytes_avoided` is the
        // size of the cached payload that would have re-entered context
        // had the TTL window missed. Best-effort, off the hot path.
        const cachedBytes = v.estimatedBytes;
        const cachedLabel = v.label;
        setImmediate(() =>
          emitCacheHitEvent({
            sessionDbPath: getSessionDbPath(),
            source: cachedLabel,
            bytesAvoided: cachedBytes,
          })
        );
        finalized.push({ kind: "cached", label: v.label, chunkCount: v.chunkCount, ageStr: v.ageStr, ttlStr: v.ttlStr });
      } else if (v.kind === "fetch_error") {
        finalized.push({ kind: "fetch_error", url: v.url, error: v.error, reason: v.reason });
      } else {
        // Serial FTS5 write here — no parallel store.index calls.
        // Cache miss: the URL was not in the TTL window so we paid the
        // network round-trip + re-indexed. Counted here so ctx_stats can
        // report nominal cache_hit_rate alongside the existing hit metrics.
        sessionStats.cacheMisses++;
        finalized.push({ kind: "fetched", indexed: indexFetched(v) });
      }
    }

    // Backward-compat single-URL response shape — preserve the EXACT original wording.
    if (isLegacySingle) {
      const r = finalized[0];
      if (r.kind === "cached") {
        return trackResponse("ctx_fetch_and_index", {
          content: [{
            type: "text" as const,
            text: `Cached **${r.label}**: ${r.chunkCount} sections; age ${r.ageStr}; TTL ${r.ttlStr}. ` +
              `Search: ctx_search(queries: [...], source: "${r.label}"); refresh with force: true.`,
          }],
        });
      }
      if (r.kind === "fetched") {
        const totalKB = (r.indexed.totalBytes / 1024).toFixed(1);
        const text = [
          `Fetched and indexed **${r.indexed.totalChunks} sections** (${totalKB}KB) from: ${r.indexed.label}`,
          `Search: ctx_search(queries: [...], source: "${r.indexed.label}").`,
          "",
          "---",
          "",
          r.indexed.preview,
        ].join("\n");
        return trackResponse("ctx_fetch_and_index", {
          content: [{ type: "text" as const, text }],
        });
      }
      // fetch_error — preserve original error wording per reason
      if (r.kind === "fetch_error") {
        const text =
          r.reason === "empty" ? `Fetched ${r.url} but got empty content`
          : r.reason === "read" ? `Fetched ${r.url} but could not read subprocess output`
          : r.reason === "exit" ? `Failed to fetch ${r.url}: ${r.error}`
          : /* throw */         `Fetch error: ${r.error}`;
        return trackResponse("ctx_fetch_and_index", {
          content: [{ type: "text" as const, text }],
          isError: true,
        });
      }
      // job_error
      return trackResponse("ctx_fetch_and_index", {
        content: [{ type: "text" as const, text: `Fetch error: ${r.error}` }],
        isError: true,
      });
    }

    // Batch response — aggregated summary; isError only when EVERY URL failed.
    // Per-URL preview capped tightly so a 8-URL batch doesn't undo the
    // context-savings the tool exists to deliver (PRD review finding G1).
    const FETCH_BATCH_PREVIEW_LIMIT = 384; // ~3KB total for 8-URL batches
    const lines: string[] = [];
    let totalSections = 0;
    let totalBytes = 0;
    let cachedCount = 0;
    let fetchedCount = 0;
    let errorCount = 0;
    const snippets: string[] = [];
    for (const r of finalized) {
      if (r.kind === "cached") {
        cachedCount++;
        lines.push(`- [cache] ${r.label} — ${r.chunkCount} sections (${r.ageStr}, TTL: ${r.ttlStr})`);
      } else if (r.kind === "fetched") {
        fetchedCount++;
        totalSections += r.indexed.totalChunks;
        totalBytes += r.indexed.totalBytes;
        const kb = (r.indexed.totalBytes / 1024).toFixed(1);
        lines.push(`- [new]   ${r.indexed.label} — ${r.indexed.totalChunks} sections (${kb}KB)`);
        const snippet = r.indexed.preview.length > FETCH_BATCH_PREVIEW_LIMIT
          ? r.indexed.preview.slice(0, FETCH_BATCH_PREVIEW_LIMIT).trimEnd() + "…"
          : r.indexed.preview;
        snippets.push(`### ${r.indexed.label}\n\n${snippet}`);
      } else {
        errorCount++;
        lines.push(`- [err]   ${r.url}: ${r.error}`);
      }
    }

    const totalKB = (totalBytes / 1024).toFixed(1);
    const cappedNote = capped
      ? ` cap=${effectiveConcurrency}/${cpus().length}cpu`
      : "";
    // Status line: counts + sections + size, with singular/plural agreement
    // (count=1 → "1 error" not "1 errors") so the line stays grammatical.
    const fmt = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;
    const headerLine =
      `fetched ${batch.length} c=${effectiveConcurrency}${cappedNote}. ` +
      `ok=${fetchedCount} cache=${cachedCount} err=${errorCount}. ` +
      `${fmt(totalSections, "section", "sections")} ${totalKB}KB.`;

    const text = [
      headerLine,
      "",
      ...lines,
      "",
      `ctx_search(queries: [...], source: "<label>") for full content.`,
      ...(snippets.length > 0 ? ["", "---", "", ...snippets] : []),
    ].join("\n");

    return trackResponse("ctx_fetch_and_index", {
      content: [{ type: "text" as const, text }],
      isError: errorCount === batch.length, // only mark error if every URL failed
    });
  },
);

// ─────────────────────────────────────────────────────────
// Tool: batch_execute
// ─────────────────────────────────────────────────────────

server.registerTool(
  "ctx_batch_execute",
  {
    title: RESTRICTED_EXECUTION_SERVER
      ? "Restricted project read-only batch execution"
      : "Batch Execute & Search",
    // #846: runs arbitrary shell commands (with network). Successful output
    // stays request-local unless verified persistence is explicitly requested.
    annotations: RESTRICTED_EXECUTION_SERVER ? {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    } : {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: `${RESTRICTED_EXECUTION_SERVER ? `Server policy: project-contained read-only shell execution, no network, no persistent index, and request-local query results only.

` : ""}Run multiple commands in ONE call. Successful command output is queried in request memory by default; if you also pass \`queries\`, matching sections come back in the same round trip. Explicit \`persistence.mode=verified\` is required to make verified successful output available to later ctx_search calls. Failed output is never persisted.

Concurrency parallelizes the FETCH phase (run-the-commands). The DERIVATION phase — turning raw output into an answer — still belongs in code: add a processing command that consumes locally available data and prints only the answer, so the raw bytes never enter your conversation (Think-in-Code, same principle as the sandbox tool).

WHEN:
  - You have 3+ related commands you would otherwise run sequentially (multi-issue lookups, git log + git diff + git blame, multi-file reads, multi-region cloud queries)
  - You want to gather AND query in one round trip — pass \`queries\` so the matching sections come back inline
  - ${RESTRICTED_EXECUTION_SERVER ? "You want to parallelize independent reads inside the trusted project — pass `concurrency` 2-8" : "You want to parallelize I/O-bound work — pass `concurrency` 2-8 (network calls, gh CLI, cloud APIs, multi-repo git reads)"}
  - You need bounded request-local matches without retaining output for later search

WHEN NOT:
  - Single command with no follow-up query — run it in the sandbox tool directly
  - CPU-bound or stateful commands — keep concurrency at 1 (npm test, build, lint, port-binding servers, lock-file holders, anything that races on the same resource)

RETURNS:
  Request-local section list plus bounded matches per query by default; persisted=no and later ctx_search cannot recall the output. With explicit verified persistence, successful stdout is indexed under the caller-supplied source with provenance. Raw output is NOT echoed in full — only matched windows. Concurrency>1 switches each command to its own per-command timeout (no shared budget); concurrency=1 preserves the legacy shared-budget cascading-skip-on-timeout path.

EXAMPLE: ctx_batch_execute(
  commands: [
    {label: "issue 1", command: "gh issue view 1"},
    {label: "issue 2", command: "gh issue view 2"},
    {label: "summarize", command: "echo done"}
  ],
  queries: ["root cause", "proposed fix"],
  concurrency: 2
)`,
    inputSchema: z.object({
      commands: z.preprocess(coerceCommandsArray, z
        .array(
          z.object({
            label: z
              .string()
              .describe(
                "Section header for this command's output (e.g., 'README', 'Package.json', 'Source Tree')",
              ),
            command: z
              .string()
              .describe("Shell command to execute"),
          }),
        )
        .min(1)
        .describe(
          "Commands to execute as a batch. Output is labeled with the section header. " +
          "Default order is sequential; pass concurrency>1 to run in parallel (output stays in input order).",
        )),
      queries: z.preprocess(coerceJsonArray, z
        .array(z.string())
        .min(1)
        .describe(RESTRICTED_EXECUTION_SERVER
          ? "Search queries over this request's output only. Results are bounded and discarded after the response."
          : "Search queries to extract information from successful output within this request. Use 5-8 comprehensive queries. " +
            "Each returns top 5 matching sections with full content. " +
            "This is your ONLY chance — put ALL your questions here. No follow-up calls needed.")),
      timeout: z
        .coerce.number()
        .optional()
        .describe("Max execution time in ms. When omitted, no server-side timer fires — the MCP host's RPC timeout governs. With concurrency=1, the value (when set) is a shared budget across commands; with concurrency>1, it is applied per-command."),
      concurrency: z
        .coerce.number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .default(1)
        .describe(
          "Max commands to run in parallel (1-8, default: 1). " +
          (RESTRICTED_EXECUTION_SERVER
            ? "Use parallelism only for independent project reads; network and writable shared state are unavailable. "
            : "Use 4-8 for I/O-bound batches (network, gh, curl, multi-repo git reads). Keep at 1 for CPU-bound or stateful commands. ") +
          ">1 switches to per-command timeouts (no shared budget) and individual `(timed out)` blocks instead of cascading skip.",
        ),
      cwd: z
        .string()
        .optional()
        .describe("Optional working directory for all shell commands in this batch."),
      query_scope: z
        .enum(["batch", "global"])
        .optional()
        .default("batch")
        .describe(RESTRICTED_EXECUTION_SERVER
          ? "Restricted mode accepts only `batch`, which searches request-local output. `global` is rejected because persistent index access is outside the execution contract."
          : "Scope for `queries` (default: `batch`). `batch` searches ONLY the chunks produced by this batch's commands. " +
            "`global` searches the entire persistent index (same scope as ctx_search)."),
      persistence: ExecutionPersistenceSchema
        .optional()
        .default({ mode: "none" })
        .describe("Default none keeps successful command bodies request-local. verified persists only successful stdout with bounded locally verified provenance."),
    }),
  },
  async ({ commands, queries, timeout, concurrency, cwd, query_scope, persistence }) => {
    const decision = currentExecutionPolicy();
    const invocation = validateRestrictedInvocation(decision, {
      language: "shell",
      cwd,
      queryScope: query_scope,
    });
    if (!invocation.ok) {
      return executionPolicyErrorResult(
        decision,
        "ctx_batch_execute",
        invocation.errorCode ?? "CTX_EXEC_POLICY_INVALID",
      );
    }
    if (decision.mode === "restricted" && persistence.mode === "verified") {
      return executionPolicyErrorResult(decision, "ctx_batch_execute", "CTX_EXEC_PERSISTENCE_FORBIDDEN");
    }
    // Security: check each command against deny patterns
    for (const cmd of commands) {
      const denied = checkDenyPolicy(cmd.command, "batch_execute");
      if (denied) return finalizeExecutionResponse(decision, "ctx_batch_execute", denied);
    }

    try {
      // Inject NODE_OPTIONS for FS read tracking in spawned Node processes.
      // The executor denies NODE_OPTIONS in its env (security), so a shell
      // preamble initializes it before the caller's complete, unmodified script.
      const nodeOptsPrefix = decision.mode === "compatibility"
        ? buildBatchNodeOptionsPrefix(runtimes.shell, CM_FS_PRELOAD)
        : "";

      // Full output is retained for this response; only successful stdout is
      // eligible for request-local queries or explicit verified persistence.
      const effTimeout = resolveExecTimeout(timeout);
      const {
        outputs: perCommandOutputs,
        searchableOutputs,
        searchableBodies,
        statuses,
        exitCodes,
        timedOut,
      } = await runBatchCommands(
        commands,
        {
          timeout: effTimeout,
          concurrency,
          nodeOptsPrefix,
          cwd: invocation.cwd ?? cwd,
          isolation: decision.isolation ?? undefined,
          onFsBytes: decision.mode === "compatibility"
            ? (bytes) => { sessionStats.bytesSandboxed += bytes; }
            : undefined,
        },
        executor,
      );

      const stdout = perCommandOutputs.join("\n");
      const requestLocalStdout = searchableOutputs.filter(Boolean).join("\n");
      const persistentStdout = searchableBodies.filter((body) => body.trim()).join("\n\n");
      const totalBytes = Buffer.byteLength(stdout);
      const totalLines = stdout.split("\n").length;

      if (timedOut && perCommandOutputs.length === 0) {
        return finalizeExecutionResponse(decision, "ctx_batch_execute", {
          content: [
            {
              type: "text" as const,
              text: [
                `Batch timed out after ${effTimeout}ms. No output captured.`,
                formatBatchCommandProof(commands, statuses),
              ].join("\n"),
            },
          ],
          isError: true,
        });
      }

      const source = `batch:${commands
        .map((command) => command.label)
        .join(",")
        .slice(0, 80)}`;

      if (decision.mode === "restricted") {
        const output = [
          formatBatchSummary(commands, statuses, totalLines, totalBytes, {
            persisted: false,
            queries: queries.length,
            queryScope: query_scope,
          }),
          formatBatchCommandProof(commands, statuses),
          "",
          formatEphemeralSearch(requestLocalStdout || "(no successful command output)", queries, source, PRESENTATION_POLICY, { compactWrapper: true }),
        ].join("\n");
        return finalizeExecutionResponse(decision, "ctx_batch_execute", {
          content: [{ type: "text" as const, text: output }],
        });
      }

      if (persistence.mode === "none") {
        const queryOutput = query_scope === "global"
          ? formatBatchQueryResults(getStore(), queries, source, undefined, "global").join("\n")
          : formatEphemeralSearch(
              requestLocalStdout || "(no successful command output)",
              queries,
              source,
              PRESENTATION_POLICY,
              { compactWrapper: true },
            );
        const output = [
          formatBatchSummary(commands, statuses, totalLines, totalBytes, {
            persisted: false,
            queries: queries.length,
            queryScope: query_scope,
          }),
          formatBatchCommandProof(commands, statuses),
          "",
          queryOutput,
        ].join("\n");
        return finalizeExecutionResponse(decision, "ctx_batch_execute", {
          content: [{ type: "text" as const, text: output }],
          isError: statuses.some((status) => status === "failed" || status === "error" || status === "timed_out"),
        });
      }

      if (!persistentStdout.trim()) {
        return finalizeExecutionResponse(decision, "ctx_batch_execute", {
          content: [{
            type: "text" as const,
            text: `${formatBatchSummary(commands, statuses, totalLines, totalBytes, { persisted: false, queries: 0, queryScope: query_scope })}\n${formatBatchCommandProof(commands, statuses)}\nNo successful stdout was eligible for verified persistence. Exit codes: ${exitCodes.map((code) => code ?? "not-run").join(", ")}.`,
          }],
          isError: true,
        });
      }

      trackIndexed(Buffer.byteLength(persistentStdout));

      // Persist only successful stdout bodies. Labels, command echoes, stderr,
      // status text, and renderer diagnostics remain response-only evidence.
      const store = getStore();
      const indexed = store.indexPlainText(
        persistentStdout,
        persistence.source,
        undefined,
        currentAttribution(),
        undefined,
        buildVerifiedProvenance(persistentStdout, persistence),
      );

      // Run all search queries — default scope is batch-local (legacy behavior).
      // When the caller passes query_scope: "global", searches reach the entire
      // persistent index in the same round trip. Cross-source search remains
      // available via explicit ctx_search() as well.
      const queryResults = formatBatchQueryResults(store, queries, persistence.source, undefined, query_scope);

      // Get searchable terms for edge cases where follow-up is needed
      const distinctiveTerms = store.getDistinctiveTerms
        ? store.getDistinctiveTerms(indexed.sourceId, PRESENTATION_POLICY.searchableTerms + 1)
        : [];
      const searchableTerms = renderSearchableTerms(distinctiveTerms, PRESENTATION_POLICY);

      const output = [
        formatBatchSummary(commands, statuses, totalLines, totalBytes, {
          persisted: true,
          indexedSections: indexed.totalChunks,
          indexedSource: persistence.source,
          queries: queries.length,
          queryScope: query_scope,
        }),
        formatBatchCommandProof(commands, statuses),
        "",
        ...queryResults,
        searchableTerms ? `\n${searchableTerms}` : "",
      ].join("\n");

      return finalizeExecutionResponse(decision, "ctx_batch_execute", {
        content: [{ type: "text" as const, text: output }],
        isError: statuses.some((status) => status === "failed" || status === "error" || status === "timed_out"),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return finalizeExecutionResponse(decision, "ctx_batch_execute", {
        content: [
          {
            type: "text" as const,
            text: [
              renderBatchCommandLine(commands, PRESENTATION_POLICY, "Submitted commands"),
              `Batch execution error: ${message}`,
            ].join("\n"),
          },
        ],
        isError: true,
      });
    }
  },
);

/**
 * Pi byte accounting: patch lifetime.totalEvents from bytes_sandboxed
 * in stats-*.json files instead of the default events × 256 heuristic.
 * Only active for Pi adapter — other platforms use getLifetimeStats() as-is.
 */
function patchPiLifetimeFromStatsFiles(lifetime: ReturnType<typeof getLifetimeStats>, sessionsDir: string): void {
  if (!existsSync(sessionsDir)) return;
  let sandboxedBytes = 0;
  try {
    for (const f of readdirSync(sessionsDir)) {
      if (!f.startsWith("stats-") || !f.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(sessionsDir, f), "utf-8"));
        sandboxedBytes += (raw?.bytes_sandboxed ?? 0) + (raw?.bytes_indexed ?? 0);
      } catch { /* corrupt file — skip */ }
    }
  } catch { /* never block ctx_stats on stats file I/O */ }
  if (sandboxedBytes > 0) {
    const rescueTokens = (lifetime.rescueBytes ?? 0) / 4;
    lifetime.totalEvents = Math.round((sandboxedBytes / 4 + rescueTokens) / 256);
  }
}

// ─────────────────────────────────────────────────────────
// Tool: stats
// ─────────────────────────────────────────────────────────

/**
 * Create a minimal in-memory DB adapter for when the session DB is unavailable.
 * All queries return empty results so AnalyticsEngine.queryAll() still works.
 */
function createMinimalDb(): import("./session/analytics.js").DatabaseAdapter {
  return {
    prepare: () => ({
      run: () => undefined,
      get: (..._args: unknown[]) => ({ cnt: 0, compact_count: 0, minutes: null, rate: 0, avg: 0, outcome: "exploratory" }),
      all: () => [],
    }),
  };
}

server.registerTool(
  "ctx_stats",
  {
    title: "Session Statistics",
    // #846: read-only diagnostics. Was cancelled by Codex when unannotated.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Returns context consumption statistics for the current session. " +
      "Shows total bytes returned to context, breakdown by tool, call counts, " +
      "estimated token usage, and context savings ratio.",
    inputSchema: z.object({}),
  },
  async () => {
    // ONE call, ONE source — AnalyticsEngine.queryAll()
    let text: string;
    try {
      const projectDir = getProjectDir();
      // Canonical hash + migration-aware path. The downstream
      // getConversationStats / getRealBytesStats reconstruct the DB
      // filename from worktreeHash; pass the SAME canonical hash that
      // resolveSessionDbPath used so they hit the same file.
      const dbHash = hashProjectDirCanonical(projectDir);
      const sessionDbPath = resolveSessionDbPath({
        projectDir,
        sessionsDir: getSessionDir(),
      });

      if (existsSync(sessionDbPath)) {
        const Database = loadDatabase();
        const sdb = new Database(sessionDbPath, { readonly: true });
        try {
          const engine = new AnalyticsEngine(sdb);
          const report = engine.queryAll(sessionStats);
          // MCP usage is read-only and cheap; only available when DB exists.
          const mcpUsage = engine.getMcpToolUsage();
          // Lifetime stats span every project's SessionDB + auto-memory dir
          // (Bugs #3/#4); failures are absorbed inside getLifetimeStats so a
          // corrupt sidecar can never break ctx_stats.
          // B3b Slice 3.1: scope to active adapter via getSessionDir() so
          // non-Claude platforms (Cursor, OpenCode, JetBrains, ...) read
          // from THEIR sessions dir — not the hardcoded ~/.claude/ default.
          // Mirrors the statusline contract at src/server.ts:540.
          const lifetime = getLifetimeStats({ sessionsDir: getSessionDir() });
          // B3b Slices 3.2-3.6: cross-adapter aggregation so the renderer
          // can show "Where it came from" + the "across N AI tools"
          // headline. Best-effort — failures absorbed so a corrupt
          // sidecar in any adapter dir cannot break ctx_stats.
          let multiAdapter;
          try { multiAdapter = getMultiAdapterLifetimeStats(); } catch { /* never block ctx_stats */ }
          // F1: wire conversation + realBytes opts so formatReport renders the
          // narrative 5-section "kitap gibi" layout (timeline, ladder, receipt,
          // example cost, auto-memory). Without these, formatReport falls back
          // to the legacy active-session header. Best-effort — failures absorbed.
          // Resolve session_id: prefer env (CLAUDE_SESSION_ID), else most-recent
          // UUID session_id from session_events in this DB.
          let conversation;
          let realBytes;
          try {
            let sid = process.env.CLAUDE_SESSION_ID;
            if (!sid) {
              const row = sdb.prepare(
                "SELECT session_id FROM session_events WHERE session_id LIKE '________-____-____-____-____________' ORDER BY created_at DESC LIMIT 1"
              ).get() as { session_id: string } | undefined;
              sid = row?.session_id;
            }
            if (sid) {
              conversation = getConversationStats({ sessionId: sid, sessionsDir: getSessionDir(), worktreeHash: dbHash });
              // v1.0.133 Slice 3: pass contentDbPath so getRealBytesStats can
              // join chunks WHERE session_id = sid and fold the indexed
              // content bytes into the per-conversation bar. Without this,
              // Mert's session showed ~200B (event metadata only) even with
              // 49 MB of indexed content sitting in the content DB.
              // Render-time read-only — no DB mutation, no backfill.
              const contentDbPath = getStorePath();
              // v1.0.148 Bug E+F: a conversation typically spans many
              // session_ids (resume cycles, /compact rebirths, PID
              // sub-process sessions launched by ctx_execute). Scoping
              // per-session loses sandbox-burst bytes_avoided that the
              // PID-sessions own. Look up THIS session's project_dir
              // from META and aggregate via META subquery so all
              // sibling sessions in the same cwd attribute together.
              // Fallback to sessionId scope if the META lookup fails
              // (best-effort — the original metric is still defensible).
              let convReal;
              try {
                const Database = loadDatabase();
                const dbFiles = (await import("node:fs"))
                  .readdirSync(getSessionDir())
                  .filter((f) => f.endsWith(".db") && (!dbHash || f.startsWith(dbHash)));
                let projectDirForSid: string | undefined;
                for (const file of dbFiles) {
                  try {
                    const sdb = new Database(
                      (await import("node:path")).join(getSessionDir(), file),
                      { readonly: true },
                    );
                    try {
                      const r = sdb
                        .prepare("SELECT project_dir FROM session_meta WHERE session_id = ?")
                        .get(sid) as { project_dir: string } | undefined;
                      if (r?.project_dir) {
                        projectDirForSid = r.project_dir;
                        break;
                      }
                    } finally {
                      sdb.close();
                    }
                  } catch { /* skip unreadable DB */ }
                }
                // Section 1 "Where you are now" = the LIVE conversation window.
                // Sub-agents + ctx_execute sub-process sessions write to this
                // SAME worktree DB (same worktreeHash = sha256(cwd)) under their
                // own session_ids; their retrieval hit their own disposable
                // windows, not yours. getConversationWindowStats credits the
                // whole worktree's kept-out bytes while counting only THIS
                // session's retrieval as "With context-mode", and the
                // worktreeHash scope keeps the user's OTHER parallel worktrees
                // out. projectDirForSid is intentionally dropped — it
                // under-counted (missed empty-project_dir sub-process sessions)
                // and could not separate sub-agent retrieval from the window's.
                void projectDirForSid;
                convReal = getConversationWindowStats({ sessionId: sid, worktreeHash: dbHash, sessionsDir: getSessionDir(), contentDbPath });
              } catch {
                convReal = getConversationWindowStats({ sessionId: sid, worktreeHash: dbHash, sessionsDir: getSessionDir(), contentDbPath });
              }
              const lifeRealBase = getRealBytesStats({ sessionsDir: getSessionDir() });
              // v1.0.134 SLICE C: lifetime tier sums ALL chunks (no
              // session_id filter). Without this fold, lifetime "kept out"
              // only counts session_events.bytes_avoided and ignores the
              // bulk of indexed payload across every prior conversation.
              const lifeContentBytes = getContentBytesAllSessions(contentDbPath);
              const lifeReal = {
                ...lifeRealBase,
                contentBytes: lifeRealBase.contentBytes + lifeContentBytes,
                bytesAvoided: lifeRealBase.bytesAvoided + lifeContentBytes,
                totalSavedTokens: Math.floor(
                  (lifeRealBase.eventDataBytes
                    + lifeRealBase.bytesAvoided
                    + lifeContentBytes
                    + lifeRealBase.snapshotBytes) / 4,
                ),
              };
              realBytes = { conversation: convReal, lifetime: lifeReal };
            }
          } catch { /* never block ctx_stats */ }
          // Pi byte accounting: patch lifetime from stats-*.json files
          // (actual bytes_sandboxed, not events × 256 heuristic).
          if (_detectedAdapter?.name === "Pi") {
            patchPiLifetimeFromStatsFiles(lifetime, getSessionDir());
          }
          // v1.0.117: pass projectDir as cwd so the narrative renderer's
          // "started in <path>" line matches the user's actual project.
          // Snapshot the persistent store so the renderer can show
          // total_chunks / last_indexed_at without callers having to query
          // separately. Best-effort — getStore() is process-local and may
          // be unavailable on cold paths; failures are absorbed.
          let indexState;
          try { indexState = getStore().getIndexState(); } catch { /* never block ctx_stats */ }
          text = formatReport(report, VERSION, _latestVersion, { lifetime, mcpUsage, multiAdapter, conversation, realBytes, indexState, cwd: projectDir });
        } finally {
          sdb.close();
        }
      } else {
        // No session DB — build a minimal report from runtime stats only.
        // Lifetime still meaningful (other projects, auto-memory) so include it.
        const engine = new AnalyticsEngine(createMinimalDb());
        const report = engine.queryAll(sessionStats);
        const lifetime = getLifetimeStats({ sessionsDir: getSessionDir() });
        if (_detectedAdapter?.name === "Pi") {
          patchPiLifetimeFromStatsFiles(lifetime, getSessionDir());
        }
        let multiAdapter;
        try { multiAdapter = getMultiAdapterLifetimeStats(); } catch { /* never block ctx_stats */ }
        let indexState;
        try { indexState = getStore().getIndexState(); } catch { /* never block ctx_stats */ }
        text = formatReport(report, VERSION, _latestVersion, { lifetime, multiAdapter, indexState });
      }
    } catch {
      // Session DB not available or incompatible — build minimal report from runtime stats
      const engine = new AnalyticsEngine(createMinimalDb());
      const report = engine.queryAll(sessionStats);
      let lifetime;
      try { lifetime = getLifetimeStats({ sessionsDir: getSessionDir() }); } catch { /* never block ctx_stats */ }
      if (_detectedAdapter?.name === "Pi" && lifetime) {
        patchPiLifetimeFromStatsFiles(lifetime, getSessionDir());
      }
      let multiAdapter;
      try { multiAdapter = getMultiAdapterLifetimeStats(); } catch { /* never block ctx_stats */ }
      text = formatReport(report, VERSION, _latestVersion, (lifetime || multiAdapter) ? { lifetime, multiAdapter } : undefined);
    }

    return trackResponse("ctx_stats", {
      content: [{ type: "text" as const, text }],
    });
  },
);

// ── ctx-checkpoint-report: confirmed compaction reliability ──────────────

server.registerTool(
  "ctx_checkpoint_report",
  {
    title: "Checkpoint Reliability Report",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: `Checkpoint lifecycle reliability for the local project worktree.

WHEN:
- You need local confirmation, claim, latency, or projection-mode metrics for confirmed Codex compaction checkpoints.

WHEN NOT:
- You need checkpoint payload content, semantic recovery scoring, or a cross-project report.

RETURNS:
- Local JSON aggregates for one to thirty days, including content-free compact SessionStart diagnostic counts. It never returns checkpoint payloads, prompts, tool input, tool output, or Trellis artifact contents. A diagnostic code of DELIVERED means only that the handler emitted additionalContext; it does not acknowledge host persistence or model consumption.

EXAMPLE:
ctx_checkpoint_report({ "window_days": 7 })`,
    inputSchema: z.object({
      window_days: z.number().int().min(1).max(30).optional(),
    }),
  },
  async ({ window_days }) => {
    const projectDir = getProjectDir();
    const configDir = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    const report = getCheckpointReliabilityReport(projectDir, configDir, {
      windowDays: window_days,
    });

    return trackResponse("ctx_checkpoint_report", compactTypedResult(report));
  },
);

// ── ctx-recovery-brief: controlled semantic recovery state ───────────────

server.registerTool(
  "ctx_recovery_brief_init",
  {
    title: "Initialize Project RecoveryBrief Provider",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description: `Explicitly initialize the project-local RecoveryBrief fallback for projects without an active Trellis pointer.

WHEN:
- You explicitly want this project to maintain a RecoveryBrief without Trellis.

WHEN NOT:
- A valid active Trellis task exists, or you only need to inspect current recovery state.

RETURNS:
- Storage mode, registered evidence count, and a stable error code. It never creates a Brief implicitly and never returns source content.

EXAMPLE:
ctx_recovery_brief_init({ "storage": "local", "source_paths": ["docs/plan.md"] })`,
    inputSchema: z.object({
      storage: z.enum(["local", "tracked"]),
      source_paths: z.array(z.string().min(1).max(512)).max(16).default([]),
    }),
  },
  async ({ storage, source_paths }) => {
    const result = initializeProjectRecoveryBriefProvider(getProjectDir(), {
      storage,
      sourcePaths: source_paths,
    });
    return trackResponse("ctx_recovery_brief_init", compactTypedResult(result, !result.ok));
  },
);

server.registerTool(
  "ctx_recovery_brief_status",
  {
    title: "RecoveryBrief Provider Status",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: `Inspect the RecoveryBrief provider selected for the current session.

WHEN:
- You need content-free recovery state before continuation, handoff, or controlled update.

WHEN NOT:
- You need the RecoveryBrief body, checkpoint payload content, or an arbitrary session lookup.

RETURNS:
- Content-free provider health, task/path state, digest, size, timestamp, source drift, and stable error code.
- The active Trellis runtime pointer takes precedence. Without that pointer, an explicitly initialized project provider may be selected. Unsafe or stale Trellis state fails closed and does not fall back.
- Never returns RecoveryBrief text, checkpoint payloads, prompts, tool input/output, or artifact bodies.

EXAMPLE:
ctx_recovery_brief_status({})`,
    inputSchema: z.object({
      [RECOVERY_BRIEF_CAPABILITY_FIELD]: z.unknown().optional(),
    }),
  },
  async (args) => {
    const status = await withRecoveryBriefAttribution(
      args[RECOVERY_BRIEF_CAPABILITY_FIELD],
      (projectRoot, sessionId) => getRecoveryBriefProviderStatus(projectRoot, sessionId),
    );
    return trackResponse(
      "ctx_recovery_brief_status",
      compactTypedResult(status, status.errorCode === "SESSION_UNAVAILABLE"),
    );
  },
);

server.registerTool(
  "ctx_recovery_brief_update",
  {
    title: "Update RecoveryBrief",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description: `Compare-and-swap update for the RecoveryBrief selected for the current session.

WHEN:
- Current task facts changed and a selected live provider needs a controlled update.

WHEN NOT:
- You need to inspect state only, initialize a project provider, or reconstruct historical checkpoint content.

The expected SHA-256 must match the current canonical Brief, or use "absent" only when no Brief exists. Project-provider updates validate registered explicit project evidence and current Git-status evidence before atomically writing. An optional source_paths list explicitly refreshes registered project evidence.

RETURNS:
- Content-free write result, digest, size, timestamp, source count, and stable error code.
- Never echoes the submitted Brief or source contents.

EXAMPLE:
ctx_recovery_brief_update({
  "expected_sha256": "absent",
  "brief": {
    "schema_version": 1,
    "updated_at": "2026-08-10T00:00:00.000Z",
    "objective": {
      "value": "Finish the current task",
      "priority": "critical",
      "source_kind": "trellis_task",
      "source_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "valid_at": "2026-08-10T00:00:00.000Z"
    },
    "hard_constraints": [],
    "decisions": [],
    "completed_work": [],
    "open_work": [],
    "latest_blocker": null,
    "next_action": null,
    "project_state": null
  }
})`,
    inputSchema: z.object({
      expected_sha256: z.union([
        z.literal("absent"),
        z.string().regex(/^[a-f0-9]{64}$/),
      ]),
      brief: recoveryBriefV1Schema,
      source_paths: z.array(z.string().min(1).max(512)).max(16).optional(),
      [RECOVERY_BRIEF_CAPABILITY_FIELD]: z.unknown().optional(),
    }),
  },
  async ({ expected_sha256, brief, source_paths, ...args }) => {
    const result = await withRecoveryBriefAttribution(
      args[RECOVERY_BRIEF_CAPABILITY_FIELD],
      (projectRoot, sessionId) => updateRecoveryBriefProvider(projectRoot, sessionId, {
        expectedSha256: expected_sha256,
        brief,
        sourcePaths: source_paths,
      }),
    );
    return trackResponse("ctx_recovery_brief_update", compactTypedResult(result, !result.ok));
  },
);

// ── ctx-doctor: diagnostics (server-side) ─────────────────────────────────
server.registerTool(
  "ctx_doctor",
  {
    title: "Run Diagnostics",
    // #846: read-only diagnostics (runs an internal self-test, mutates nothing).
    // Was cancelled by Codex when unannotated.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Diagnose context-mode installation. Runs all checks server-side and " +
      "returns a plain-text status report with [OK]/[FAIL]/[WARN] prefixes " +
      "(renderer-safe across MCP clients). No CLI execution needed.",
    inputSchema: z.object({}),
  },
  async () => {
    // Renderer-safe output (Mickey #3 — Z.ai GLM 4.7 ReferenceError):
    // Z.ai's MCP renderer mounts a custom React component for GitHub-flavored
    // markdown task-list syntax (`- [x]` / `- [ ]` / `- [-]`) that depends on
    // a missing `client` context, throwing `ReferenceError: client is not
    // defined`. We avoid both task-list syntax AND `## ` h2 headings to stay
    // safe across all MCP renderers — using plain-text status prefixes
    // (`[OK]` / `[FAIL]` / `[WARN]`) instead.
    const lines: string[] = ["context-mode doctor", ""];
    let currentPlatform: PlatformId | undefined;
    try {
      currentPlatform = detectPlatform(server.server.getClientVersion() ?? undefined).platform;
    } catch {
      currentPlatform = detectPlatform().platform;
    }
    // __pkg_dir is build/ for tsc, plugin root for bundle — resolve to the
    // package root actually loaded by this MCP process. The Codex plugin list
    // path is reported separately as the installed cache root by the adapter.
    const pluginRoot = getPackageRoot();

    // Runtimes
    const total = 11;
    const pct = ((available.length / total) * 100).toFixed(0);
    lines.push(`[OK] Runtimes: ${available.length}/${total} (${pct}%) — ${available.join(", ")}`);

    // Performance
    if (hasBunRuntime()) {
      lines.push("[OK] Performance: FAST (Bun)");
    } else {
      lines.push("[WARN] Performance: NORMAL — install Bun for 3-5x speed boost");
    }

    const sessionStorage = resolveSessionStorageDir(getDefaultSessionDir);
    const contentStorage = resolveContentStorageDir(getDefaultSessionDir);
    const statsStorage = resolveStatsStorageDir(getDefaultSessionDir);
    lines.push(`[OK] Storage sessions: ${sessionStorage.path} (${describeStorageDirectorySource(sessionStorage)})`);
    lines.push(`[OK] Storage content: ${contentStorage.path} (${describeStorageDirectorySource(contentStorage)})`);
    lines.push(`[OK] Storage stats: ${statsStorage.path} (${describeStorageDirectorySource(statsStorage)})`);

    // Server test — cleanup executor to prevent resource leaks (#247)
    {
      const testExecutor = new PolyglotExecutor({ runtimes });
      try {
        const result = await testExecutor.execute({ language: "javascript", code: 'console.log("ok");', timeout: 5000 });
        if (result.exitCode === 0 && result.stdout.trim() === "ok") {
          lines.push("[OK] Server test: PASS");
        } else {
          const detail = result.stderr?.trim() ? ` (${result.stderr.trim().slice(0, 200)})` : "";
          lines.push(`[FAIL] Server test: FAIL — exit ${result.exitCode}${detail}`);
        }
      } catch (err: unknown) {
        lines.push(`[FAIL] Server test: FAIL — ${err instanceof Error ? err.message : err}`);
      } finally {
        testExecutor.cleanupBackgrounded();
      }
    }

    // FTS5 / SQLite — close in finally to prevent GC segfault (#247)
    {
      let testDb: ReturnType<typeof loadDatabase> extends (...args: any[]) => infer R ? R : never;
      try {
        const Database = loadDatabase();
        testDb = new Database(":memory:");
        testDb.exec("CREATE VIRTUAL TABLE fts_test USING fts5(content)");
        testDb.exec("INSERT INTO fts_test(content) VALUES ('hello world')");
        const row = testDb.prepare("SELECT * FROM fts_test WHERE fts_test MATCH 'hello'").get() as { content: string } | undefined;
        if (row && row.content === "hello world") {
          lines.push("[OK] FTS5 / SQLite: PASS — native module works");
        } else {
          lines.push("[FAIL] FTS5 / SQLite: FAIL — unexpected result");
        }
      } catch (err: unknown) {
        lines.push(`[FAIL] FTS5 / SQLite: FAIL — ${err instanceof Error ? err.message : err}`);
      } finally {
        try { testDb!?.close(); } catch { /* best effort */ }
      }
    }

    // Hooks
    const diagnosticAdapter = await getDiagnosticAdapter();
    if (diagnosticAdapter) {
      for (const result of diagnosticAdapter.validateHooks(pluginRoot)) {
        const prefix = result.status === "pass" ? "[OK]" : result.status === "warn" ? "[WARN]" : "[FAIL]";
        const fix = result.fix ? ` — fix: ${result.fix}` : "";
        lines.push(`${prefix} ${result.check}: ${result.message}${fix}`);
      }

      const structuredDiagnostic = diagnosticAdapter.getStructuredDiagnosticSummary?.(pluginRoot);
      if (structuredDiagnostic) {
        lines.push(`[OK] Codex Plugin diagnostic (JSON): ${structuredDiagnostic}`);
      }

      const registration = diagnosticAdapter.checkPluginRegistration(pluginRoot);
      const registrationPrefix = registration.status === "pass"
        ? "[OK]"
        : registration.status === "warn"
          ? "[WARN]"
          : "[FAIL]";
      const registrationFix = registration.fix ? ` — fix: ${registration.fix}` : "";
      lines.push(`${registrationPrefix} ${registration.check}: ${registration.message}${registrationFix}`);

      const hookScriptPaths = getHookScriptPaths(diagnosticAdapter, pluginRoot);
      if (hookScriptPaths.length === 0) {
        lines.push("[OK] Hook scripts: no direct .mjs script paths to verify");
      }
      for (const scriptPath of hookScriptPaths) {
        const hookPath = resolve(pluginRoot, scriptPath);
        if (existsSync(hookPath)) {
          lines.push(`[OK] Hook script: PASS — ${hookPath}`);
        } else {
          lines.push(`[FAIL] Hook script: FAIL — not found at ${hookPath}`);
        }
      }
    } else {
      lines.push("[WARN] Hooks: adapter detection unavailable");
    }

    // Codex checkpoint continuity is deliberately Hook-driven. This is a
    // passive registration check only; diagnostics never read Brief content.
    try {
      const codexHooksPath = join(pluginRoot, ".codex-plugin", "hooks.json");
      const codexHooks = JSON.parse(readFileSync(codexHooksPath, "utf8")) as {
        hooks?: Record<string, unknown>;
      };
      const hookEntries = codexHooks.hooks ?? {};
      const hookContains = (event: string, marker: string): boolean =>
        JSON.stringify(hookEntries[event] ?? []).includes(marker);
      const sessionStartEntries = JSON.stringify(hookEntries.SessionStart ?? []);
      const preCompact = hookContains("PreCompact", "checkpoint-precompact");
      const postCompact = hookContains("PostCompact", "checkpoint-postcompact");
      const sessionStart = sessionStartEntries.includes("checkpoint-sessionstart")
        && sessionStartEntries.includes("compact");
      lines.push(`${preCompact ? "[OK]" : "[FAIL]"} Codex PreCompact checkpoint hook: ${preCompact ? "registered" : "missing"}`);
      lines.push(`${postCompact ? "[OK]" : "[FAIL]"} Codex PostCompact checkpoint hook: ${postCompact ? "registered" : "missing"}`);
      lines.push(`${sessionStart ? "[OK]" : "[FAIL]"} Codex SessionStart(compact) checkpoint hook: ${sessionStart ? "registered" : "missing"}`);
      const recoveryBriefMatcher = Array.isArray(hookEntries.PreToolUse)
        && JSON.stringify(hookEntries.PreToolUse).includes(CODEX_RECOVERY_BRIEF_TOOL_MATCHER);
      if (currentPlatform === "codex") {
        const readiness = getRecoveryBriefCapabilityReadiness();
        const bridgeReady = readiness.ready && recoveryBriefMatcher;
        lines.push(`${bridgeReady ? "[OK]" : "[FAIL]"} Codex RecoveryBrief identity bridge: ${bridgeReady ? "ready (private storage and exact default matcher)" : "unavailable; explicit RecoveryBrief calls fail closed"}`);
      } else {
        lines.push(`[WARN] Codex RecoveryBrief identity bridge: unavailable outside Codex runtime`);
      }
      const checkpointBundlePath = join(pluginRoot, "hooks", "checkpoint.bundle.mjs");
      lines.push(`${existsSync(checkpointBundlePath) ? "[OK]" : "[FAIL]"} Checkpoint bundle: ${checkpointBundlePath}`);

      const projectDir = getProjectDir();
      const projectProviderPath = join(projectDir, ".context-mode", "recovery-provider.json");
      const trellisRuntimeRoot = join(projectDir, ".trellis", ".runtime", "sessions");
      const providerState = existsSync(projectProviderPath)
        ? "project provider configured"
        : existsSync(trellisRuntimeRoot)
          ? "Trellis runtime directory present"
          : "no project provider configured";
      lines.push(`[OK] RecoveryBrief provider availability: ${providerState}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`[WARN] Codex checkpoint registration: ${message}`);
    }

    // Version
    lines.push(`[OK] Version: v${VERSION}`);

    const successful = lines.filter((line) => line.startsWith("[OK] "));
    const standaloneSuccess = successful.filter((line) =>
      line.includes("Codex RecoveryBrief identity bridge"),
    );
    const groupedSuccess = successful.filter((line) => !standaloneSuccess.includes(line));
    const findings = lines.filter((line) => line.startsWith("[WARN] ") || line.startsWith("[FAIL] "));
    const compact = [
      "context-mode doctor",
      `[OK] ${groupedSuccess.length} checks: ${groupedSuccess.map((line) => line.slice(5)).join(" | ")}`,
      ...standaloneSuccess,
      ...findings,
    ];
    return trackResponse("ctx_doctor", {
      content: [{ type: "text" as const, text: compact.join("\n") }],
    });
  },
);

// ── ctx-upgrade: upgrade meta-tool ─────────────────────────────────────────
server.registerTool(
  "ctx_upgrade",
  {
    title: "Upgrade Plugin",
    // #846: an action tool (returns an upgrade command to run); not read-only,
    // but non-destructive and idempotent. No direct network from the call.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Upgrade context-mode to the latest version. Returns a shell command to execute. " +
      "You MUST run the returned command using your shell tool (Bash, shell_execute, " +
      "run_in_terminal, etc.) and display the output as a checklist. " +
      "Tell the user to restart their session after upgrade.",
    inputSchema: z.object({}),
  },
  async () => {
    // Issue #542 — thread MCP clientInfo into the spawned upgrade
    // process. detectPlatform() runs IN-PROCESS here (no spawn boundary)
    // so clientInfo from the MCP handshake is the highest-confidence
    // signal available. We forward the resolved PlatformId as a
    // --platform flag (cross-shell safe on POSIX, Git Bash, PowerShell,
    // and cmd.exe — unlike env-var prefixes). If detection fails we
    // skip the flag and let upgrade()'s own detectPlatform() fall back.
    let platformFlag = "";
    let nodeOpts: { platform: string; jsRuntime: string } | undefined =
      undefined;
    let platformId: PlatformId | undefined;
    try {
      const clientInfo = server.server.getClientVersion();
      const signal = detectPlatform(clientInfo ?? undefined);
      platformId = signal.platform;
      platformFlag = ` --platform ${signal.platform}`;
      nodeOpts = isInProcessPluginPlatform(signal.platform) && runtimes.javascript
        ? { platform: signal.platform, jsRuntime: runtimes.javascript }
        : undefined;
    } catch {
      try { platformId = detectPlatform().platform; } catch { /* best effort — fall back to upgrade()'s own detect */ }
    }

    // __pkg_dir is build/ for tsc, plugin root for bundle — resolve to plugin root.
    // Only Codex may replace it with the plugin-manager runtime root; other
    // adapters can coexist with Codex on the same machine.
    const pluginRoot = getRuntimeAwarePackageRoot(platformId);
    const bundlePath = resolve(pluginRoot, "cli.bundle.mjs");
    const fallbackPath = resolve(pluginRoot, "build", "cli.js");

    // Insight pivoted to the hosted dashboard (context-mode.com/insight), so
    // ctx_insight no longer builds a local cache. On upgrade, sweep the legacy
    // insight-cache and stop any stale local dashboard left from old versions.
    try {
      const sessDir = getSessionDir();
      const insightCacheDir = join(dirname(sessDir), "insight-cache");
      if (existsSync(insightCacheDir)) {
        // Kill any running insight server first via the shared helper —
        // this is locale-independent on Windows (PR #469) and isolates per-pid
        // failures. We ignore the structured result: cache cleanup is
        // best-effort and must never block ctx_upgrade.
        killProcessOnPort(4747);
        rmSync(insightCacheDir, { recursive: true, force: true });
      }
    } catch { /* best effort — don't block upgrade */ }


    let cmd: string;

    if (existsSync(bundlePath)) {
      cmd = `${buildNodeCommand(bundlePath, nodeOpts)} upgrade${platformFlag}`;
    } else if (existsSync(fallbackPath)) {
      cmd = `${buildNodeCommand(fallbackPath, nodeOpts)} upgrade${platformFlag}`;
    } else {
      if (platformId === "codex") {
        return trackResponse("ctx_upgrade", {
          content: [{
            type: "text" as const,
            text: "Codex marketplace-managed installs must be updated through their configured marketplace and plugin version. The legacy clone/global upgrade fallback is intentionally disabled.",
          }],
          isError: true,
        });
      }
      // Inline fallback: neither CLI file exists (e.g. marketplace installs).
      // Generate a self-contained node -e script that performs the upgrade.
      const repoUrl = "https://github.com/mksglu/context-mode.git";
      // Write inline script to a temp .mjs file — avoids quote-escaping issues
      // across cmd.exe, PowerShell, and bash (node -e '...' breaks on Windows).
      const scriptLines = [
        `import{execFileSync}from"node:child_process";`,
        `import{cpSync,rmSync,existsSync,mkdtempSync,readFileSync,writeFileSync,lstatSync}from"node:fs";`,
        `import{join,resolve,sep}from"node:path";`,
        `import{tmpdir}from"node:os";`,
        `const P=${JSON.stringify(pluginRoot)};`,
        `const T=mkdtempSync(join(tmpdir(),"ctx-upgrade-"));`,
        `try{`,
        `console.log("- [x] Starting inline upgrade (no CLI found)");`,
        `execFileSync("git",["clone","--depth","1","${repoUrl}",T],{stdio:"inherit"});`,
        `console.log("- [x] Cloned latest source");`,
        `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["install"],{cwd:T,stdio:"inherit",shell:process.platform==="win32"});`,
        `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["run","build"],{cwd:T,stdio:"inherit",shell:process.platform==="win32"});`,
        `console.log("- [x] Built from source");`,
        `const pkg=JSON.parse(readFileSync(join(T,"package.json"),"utf8"));`,
        `const items=[...(Array.isArray(pkg.files)?pkg.files:[]),"src","package.json"];`,
        // Supply-chain containment on items[]. Mirror the cli.ts upgrade()
        // guard: a compromised upstream package.json with files:["../etc"]
        // would otherwise let path.join follow ".." out of pluginRoot.
        // path.resolve normalizes "..", so the lexical startsWith catches
        // both relative-".." traversal and absolute-path bypass. Plus a
        // symlink filter so a committed symlink inside the clone can't
        // plant itself in pluginRoot (cpSync default preserves source
        // symlinks; a planted symlink in pluginRoot/src then redirects
        // every subsequent load through to an attacker target).
        `const PW=resolve(P)+sep;const TW=resolve(T)+sep;`,
        `const noSymlink=(src)=>{try{return !lstatSync(src).isSymbolicLink()}catch{return false}};`,
        `for(const item of items){const from=resolve(T,item);const to=resolve(P,item);if(!(to+sep).startsWith(PW))continue;if(!(from+sep).startsWith(TW))continue;if(!noSymlink(from))continue;if(existsSync(from)){rmSync(to,{recursive:true,force:true});cpSync(from,to,{recursive:true,force:true,filter:noSymlink});}}`,
        // Issue #609: do NOT write .mcp.json into the cache dir. Claude Code reads
        // .claude-plugin/plugin.json.mcpServers as the canonical MCP source — the
        // per-version .mcp.json file is a stale-write vector. Same architectural
        // fix as the cli.ts upgrade() path; both writers were the only producers.
        `console.log("- [x] Copied package files");`,
        `execFileSync(process.platform==="win32"?"npm.cmd":"npm",["install","--production"],{cwd:P,stdio:"inherit",shell:process.platform==="win32"});`,
        `console.log("- [x] Installed production dependencies");`,
        `console.log("## context-mode upgrade complete");`,
        `}catch(e){`,
        `console.error("- [ ] Upgrade failed:",e.message);`,
        `process.exit(1);`,
        `}finally{`,
        `try{rmSync(T,{recursive:true,force:true})}catch{}`,
        `}`,
      ].join("\n");

      // Server writes the temp script file — avoids shell quoting issues entirely
      const tmpScript = resolve(pluginRoot, ".ctx-upgrade-inline.mjs");
      const { writeFileSync: writeTmp } = await import("node:fs");
      writeTmp(tmpScript, scriptLines);
      cmd = buildNodeCommand(tmpScript, nodeOpts);
    }

    const text = [
      "Run this command, report each upgrade check as success/failure, then restart the session:",
      "```shell",
      cmd,
      "```",
    ].join("\n");

    return trackResponse("ctx_upgrade", {
      content: [{ type: "text" as const, text }],
    });
  },
);

// ── ctx-purge: explicit knowledge base wipe ─────────────────────────────────
//
// Issue #520 — scoped purge.
// The schema is ADDITIVE: bare {confirm:true} preserves the legacy
// project-wide wipe verbatim (with a stderr deprecation warning so
// future callers migrate to explicit scope). When sessionId is given,
// only that session's rows + FTS5 chunks are removed; project-wide
// files (events.md, FTS5 store file, stats file) are preserved.
// Passing both sessionId AND scope:"project" is ambiguous (does the
// caller want a per-session wipe or a project-wide one?) and is
// rejected by an explicit check in the handler body — NOT a schema-level
// .refine(). MCP SDK's normalizeObjectSchema() reads `.shape` to project
// inputSchema → JSON Schema for tools/list; a ZodEffects (refine wrapper)
// has no `.shape`, so the SDK silently emits `properties: {}`, and Claude
// Code's strict-input-validation gate then rejects EVERY call to this
// tool with "input_schema does not support fields". Issue #563.
server.registerTool(
  "ctx_purge",
  {
    title: "Purge Knowledge Base",
    // #846: permanently deletes indexed content — destructive. Purging an
    // already-purged scope has no further effect (idempotent). No network.
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: `DESTRUCTIVE: permanently delete indexed content. Cannot be undone. Requires confirm:true and exactly one scope.

WHEN:
  - User explicitly asks to clear a specific session ('purge this session', 'wipe this conversation')
  - User explicitly asks to reset the whole project ('reset everything', 'wipe the knowledge base')

WHEN NOT:
  - User says 'reset', 'clear', or 'wipe' without naming a scope -> ask which scope before calling
  - User wants to free memory or improve performance -> recommend ctx_stats first, do not purge

SCOPES (pass exactly one):
  - Per-session: ctx_purge(confirm: true, sessionId: "<uuid>") deletes that session's events (auto-captured decisions, errors, plans, user prompts, rejected approaches, etc.) and per-session FTS5 chunks; sibling sessions and stats file are preserved.
  - Per-source: ctx_purge(confirm: true, scope: "source", source: "<exact label>") deletes one exact FTS5 source and its chunks; session events and stats are preserved.
  - Per-project: ctx_purge(confirm: true, scope: "project") wipes FTS5 knowledge base, every session DB row, events markdown, and resets the stats file. Use ctx_stats first to preview category counts before purging.

CONTRACT:
  - confirm:true is required; confirm:false returns 'purge cancelled'.
  - sessionId and scope:'project' together return 'ambiguous - pick one'.
  - scope:'session' without sessionId throws (sessionId required).
  - Bare {confirm:true} is deprecated: maps to scope:'project' with a stderr warning; will hard-error in a future major.

RETURNS:
  A summary of removed rows + the resolved scope.

EXAMPLE: ctx_purge(confirm: true, sessionId: "7c8a-1234-5678-9abc-def012345678")
EXAMPLE: ctx_purge(confirm: true, scope: "source", source: "verified-build-output")
EXAMPLE: ctx_purge(confirm: true, scope: "project")`,
    // NOTE: schema MUST be a plain z.object — no .refine()/.transform()/
    // .superRefine() wrapper. See block comment above & issue #563. The
    // cross-field ambiguity check lives in the handler body below.
    inputSchema: z.object({
      // confirm: wrapped in coerceBoolean preprocessor — OpenCode's native
      // plugin bridge can deliver `confirm:"true"` / `confirm:"false"` as
      // string literals. Without this, v1.0.139's inputSchema.parse() path
      // rejects valid intent as "Expected boolean, received string" (#627).
      confirm: z.preprocess(coerceBoolean, z.boolean()).describe(
        "MUST be true. Destructive operation; false returns 'purge cancelled'."
      ),
      sessionId: z.string().optional().describe(
        "UUID of a single session. Pairs with confirm:true to wipe only that " +
        "session's events + per-session FTS5 chunks. Sibling sessions and the " +
        "stats file are preserved. MUST NOT be combined with scope:'project'."
      ),
      scope: z.enum(["session", "source", "project"]).optional().describe(
        "Explicit scope selector. 'session' REQUIRES sessionId. 'project' wipes " +
        "the entire project (FTS5 + every session + stats). Omit only for the " +
        "deprecated bare-{confirm:true} back-compat path."
      ),
      source: z.string().min(1).max(160).optional().describe(
        "Exact persistent FTS5 source label. Required with scope:'source' and invalid for other scopes."
      ),
    }),
  },
  async ({ confirm, sessionId, scope, source }) => {
    // Cross-field ambiguity check — formerly a schema .refine(), moved
    // into the handler so the inputSchema stays a plain ZodObject and
    // the MCP SDK can serialize `.shape` into JSON Schema (issue #563).
    // Same human-readable message as the original refine() preserved.
    if ((sessionId && scope !== undefined && scope !== "session") || (source && scope !== "source")) {
      return trackResponse("ctx_purge", {
        content: [{
          type: "text" as const,
          text:
            "Ambiguous purge: sessionId is valid only for session scope and source is valid only for source scope.",
        }],
        isError: true,
      });
    }
    if (!confirm) {
      return trackResponse("ctx_purge", {
        content: [{
          type: "text" as const,
          text: "Purge cancelled. Pass confirm: true to proceed.",
        }],
      });
    }
    if (scope === "source") {
      if (!source) {
        return trackResponse("ctx_purge", {
          content: [{ type: "text" as const, text: "Source purge requires an exact source label." }],
          isError: true,
        });
      }
      const removed = getStore().removeSource(source);
      return trackResponse("ctx_purge", {
        content: [{
          type: "text" as const,
          text: removed
            ? `Purged exact source "${source}". Session events and stats preserved.`
            : `No persistent source matched exact label "${source}". Nothing deleted.`,
        }],
      });
    }

    // Effective scope resolution:
    //   - explicit scope wins
    //   - else "session" iff sessionId is given
    //   - else "project" (back-compat — emit deprecation warning so
    //     callers migrate to the explicit form before a future major).
    const effectiveScope: "session" | "project" =
      scope === "session" || scope === "project"
        ? scope
        : (sessionId ? "session" : "project");
    if (!scope && !sessionId) {
      console.warn(
        "[context-mode] ctx_purge: bare {confirm:true} is deprecated. " +
        "Pass scope:'project' for the whole-project wipe, or scope:'session' + sessionId " +
        "for a scoped wipe. See issue #520."
      );
    }

    // Close the persistent FTS5 content store handle BEFORE delegating to
    // purgeSession so the store's lock is released on Windows. The handle
    // is recreated lazily on the next getStore() call.
    let storePathForPurge: string | undefined;
    try {
      storePathForPurge = getStorePath();
    } catch { /* best effort — store path may be unresolvable on fresh install */ }
    if (_store) {
      try { _store.cleanup(); } catch { /* best effort */ }
      _store = null;
    }

    // FTS5 store: pass contentDir so purgeSession sweeps BOTH canonical
    // and legacy raw-casing variants (dual-hash, mirrors session events).
    // storePath is also passed for the rare case where the resolver picked
    // an absolute path that differs from the dual-hash pair (e.g. caller
    // pre-migrated). Both paths are de-duped during unlink.
    const contentDir = storePathForPurge ? dirname(storePathForPurge) : undefined;
    const { deleted } = purgeSession({
      projectDir: getProjectDir(),
      sessionsDir: getSessionDir(),
      storePath: storePathForPurge,
      contentDir,
      legacyContentDir: join(homedir(), ".context-mode", "content"),
      // hashProjectDirLegacy mirrors the deployed (≤ v1.0.111) raw-casing
      // hash that named files under ~/.context-mode/content/. Using the
      // legacy hash here is correct: that pre-pre-legacy directory was
      // never migrated and still uses raw casing.
      contentHash: hashProjectDirLegacy(getProjectDir()),
      scope: effectiveScope,
      sessionId,
    });

    // Stats are PROJECT-scoped (one stats file per project, summing all
    // sessions). A scoped per-session purge MUST leave stats alone — they
    // still belong to other sessions in the same project. Stats reset
    // happens ONLY when scope === "project".
    if (effectiveScope === "project") {
      // Reset in-memory session stats
      sessionStats.calls = {};
      sessionStats.bytesReturned = {};
      sessionStats.bytesIndexed = 0;
      sessionStats.bytesSandboxed = 0;
      sessionStats.cacheHits = 0;
      sessionStats.cacheBytesSaved = 0;
      sessionStats.sessionStart = Date.now();
      deleted.push("session stats");

      // Also drop the persisted stats file so external readers see a fresh state
      try {
        const statsFile = getStatsFilePath();
        if (existsSync(statsFile)) unlinkSync(statsFile);
      } catch { /* best effort */ }
    }

    const message = effectiveScope === "session"
      ? `Purged session ${sessionId}: ${deleted.length ? deleted.join(", ") : "no matching rows"}. ` +
        `Other sessions and project-wide stats preserved.`
      : `Purged: ${deleted.join(", ")}. All session data for this project has been permanently deleted.`;
    return trackResponse("ctx_purge", {
      content: [{
        type: "text" as const,
        text: message,
      }],
    });
  },
);

// ── ctx_insight process helpers ──────────────────────────────────────────────
// Cross-platform process helpers used by ctx_insight (below) and the dashboard
// launcher in cli.ts. All entry points use argv arrays — never `sh -c <string>`
// — so caller-derived values cannot escape into shell context. See issue #441.
//
// `browserOpenArgv` is duplicated as a private 16-LOC copy in cli.ts to avoid
// pulling server.ts top-level boot side effects into the cli bundle.

export type SpawnSyncFn = (
  cmd: string,
  args: readonly string[],
  opts?: SpawnSyncOptions,
) => SpawnSyncReturns<string | Buffer>;

export type BrowserOpenResult =
  | { ok: true; method: string }
  | { ok: false; method: "none"; reason: string };

export type KillResult = {
  killedPids: string[];
  attemptedPids: string[];
  errors: string[];
};

// Hard upper bound on every helper-internal spawnSync call. Caps tail-latency
// when an external binary hangs (xdg-open waiting for an X11 session, lsof
// stalling on /proc, taskkill blocking on an unresponsive process, etc.) so
// the MCP tool surfaces a diagnostic instead of blocking the agent loop.
// 5s is comfortably above the 99th-percentile completion of every command we
// invoke; anything past that is hung.
const HELPER_SPAWN_TIMEOUT_MS = 5000;

// Returns the argv attempts for opening `url` on `platform`, in fall-back order.
// Pure data — no I/O.
export function browserOpenArgv(
  url: string,
  platform: NodeJS.Platform,
): readonly { cmd: string; args: readonly string[] }[] {
  if (platform === "darwin") return [{ cmd: "open", args: [url] }];
  if (platform === "win32") {
    // `start` is a cmd.exe builtin; the empty title arg ("") prevents the URL
    // from being consumed as the window title.
    return [{ cmd: "cmd", args: ["/c", "start", "", url] }];
  }
  // linux/bsd: try xdg-open, then sensible-browser (Debian/Ubuntu).
  return [
    { cmd: "xdg-open", args: [url] },
    { cmd: "sensible-browser", args: [url] },
  ];
}

// Opens a browser synchronously, waiting for each attempt to complete.
// Returns a structured result so callers can surface auto-open failures
// to the user instead of falsely reporting success.
export function openBrowserSync(
  url: string,
  platform: NodeJS.Platform = process.platform,
  runner: SpawnSyncFn = spawnSync,
): BrowserOpenResult {
  const attempts = browserOpenArgv(url, platform);
  const errors: string[] = [];
  for (const { cmd, args } of attempts) {
    try {
      const r = runner(cmd, args, { stdio: "ignore", timeout: HELPER_SPAWN_TIMEOUT_MS });
      // Treat signal-kill (status === null) and any non-zero status as failure
      // so the next fallback fires.
      if (!r.error && r.status === 0) return { ok: true, method: cmd };
      const reason = r.error?.message ?? `status=${r.status === null ? "signaled" : r.status}`;
      errors.push(`${cmd}: ${reason}`);
    } catch (e) {
      errors.push(`${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: false, method: "none", reason: errors.join("; ") };
}

// Kills any process listening on `port`. Returns a structured result so
// the caller can distinguish between (a) port was free, (b) kill succeeded,
// (c) kill failed (perms, missing binary, or per-pid failure mid-loop).
//
// On Windows the netstat parser is locale-independent: the STATE column
// ("LISTENING" / "ESTABLISHED" / ...) is translated on non-English Windows
// (Windows-FR shows "À l'écoute", Windows-DE "ABHÖREN", etc.), but the REMOTE
// ADDRESS column is not. A listening TCP socket always has remote
// "0.0.0.0:0" (IPv4) or "[::]:0" (IPv6); a connected one has a real
// addr:port. We therefore key off the remote column instead of the state
// string. This also rules out the pre-fix bug where matching only the local
// port number cross-matched a remote :port from an outbound connection and
// taskkill'd an unrelated process.
export function killProcessOnPort(
  port: number,
  platform: NodeJS.Platform = process.platform,
  runner: SpawnSyncFn = spawnSync,
): KillResult {
  const result: KillResult = { killedPids: [], attemptedPids: [], errors: [] };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    result.errors.push(`invalid port: ${port}`);
    return result;
  }

  try {
    if (platform === "win32") {
      const r = runner("netstat", ["-ano"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: HELPER_SPAWN_TIMEOUT_MS,
      });
      if (r.error) {
        result.errors.push(`netstat: ${r.error.message}`);
        return result;
      }
      if (r.status !== 0 || typeof r.stdout !== "string") return result;

      const portSuffix = `:${port}`;
      const pids = new Set<string>();
      for (const rawLine of r.stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const tokens = line.split(/\s+/);
        // netstat -ano LISTENING row (en-US): "TCP  0.0.0.0:4747  0.0.0.0:0  LISTENING  1234"
        // The STATE column is locale-translated and may itself contain spaces
        // (Windows-FR `À l'écoute` splits into two tokens), so we cannot index
        // STATE by position. PID is always the trailing column; PROTO/LOCAL/
        // REMOTE are the first three. We anchor on those + a remote-wildcard
        // check that's locale-independent.
        if (tokens.length < 5) continue;
        const proto = tokens[0];
        const local = tokens[1];
        const remote = tokens[2];
        const pid = tokens[tokens.length - 1];
        if (proto !== "TCP") continue;
        if (!local.endsWith(portSuffix)) continue;
        // Listening sockets carry a wildcard remote; anything else is a
        // connection (and matching it would kill an unrelated process).
        if (remote !== "0.0.0.0:0" && remote !== "[::]:0") continue;
        if (!/^\d+$/.test(pid)) continue;
        pids.add(pid);
      }
      for (const pid of pids) {
        result.attemptedPids.push(pid);
        try {
          const k = runner("taskkill", ["/F", "/PID", pid], {
            stdio: "ignore",
            timeout: HELPER_SPAWN_TIMEOUT_MS,
          });
          if (k.error || k.status !== 0) {
            result.errors.push(
              `taskkill ${pid}: ${k.error?.message ?? `status=${k.status}`}`,
            );
          } else {
            result.killedPids.push(pid);
          }
        } catch (e) {
          result.errors.push(`taskkill ${pid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      const r = runner("lsof", ["-ti", `:${port}`], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: HELPER_SPAWN_TIMEOUT_MS,
      });
      if (r.error) {
        // ENOENT (lsof not installed) is a real diagnostic; surface it.
        result.errors.push(`lsof: ${r.error.message}`);
        return result;
      }
      // lsof exits 1 with empty stdout when the port is free — not an error.
      if (r.status !== 0 || typeof r.stdout !== "string") return result;

      const pids = r.stdout.split(/\r?\n/).filter(p => /^\d+$/.test(p));
      for (const pid of pids) {
        result.attemptedPids.push(pid);
        try {
          const k = runner("kill", [pid], {
            stdio: "ignore",
            timeout: HELPER_SPAWN_TIMEOUT_MS,
          });
          if (k.error || k.status !== 0) {
            result.errors.push(
              `kill ${pid}: ${k.error?.message ?? `status=${k.status}`}`,
            );
          } else {
            result.killedPids.push(pid);
          }
        } catch (e) {
          result.errors.push(`kill ${pid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
  }
  return result;
}

// ── ctx-insight: open the hosted Insight dashboard ───────────────────────────
// Insight pivoted from a locally-built dashboard to the hosted B2B product at
// context-mode.com/insight (the landing page is the single source of truth).
// The tool now simply opens that URL in the user default browser via the same
// cross-platform helper (openBrowserSync) used elsewhere.
const INSIGHT_URL = "https://context-mode.com/insight";

server.registerTool(
  "ctx_insight",
  {
    title: "Open Insight Dashboard",
    // #846: opens a hosted dashboard URL in the browser — an external side
    // effect (open world), not a read-only query; safe to repeat.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Opens the context-mode Insight dashboard (https://context-mode.com/insight) in your " +
      "default browser — a dashboard launcher for the hosted analytics layer, not a Q&A engine. " +
      "Insight surfaces per-engineer productive rate, retry waste, blocker detection, and " +
      "role-narrowed views for CTO, EM, IC, CISO, FinOps, and DevOps. " +
      "For natural-language queries over your indexed content, use ctx_search.",
    inputSchema: z.object({}),
  },
  async () => {
    const open = openBrowserSync(INSIGHT_URL);
    const text = open.ok
      ? `Opening Insight in your browser: ${INSIGHT_URL}`
      : `Could not auto-open your browser (${open.reason}).\nOpen Insight manually: ${INSIGHT_URL}`;
    return trackResponse("ctx_insight", {
      content: [{ type: "text" as const, text }],
    });
  },
);

// ─────────────────────────────────────────────────────────
// Server startup
// ─────────────────────────────────────────────────────────

async function main() {
  // Clean up stale DB files from previous sessions
  const cleaned = RESTRICTED_EXECUTION_SERVER ? 0 : cleanupStaleDBs();
  if (cleaned > 0) {
    console.error(`Cleaned up ${cleaned} stale DB file(s) from previous sessions`);
  }

  // MCP readiness sentinel path (#230, #347)
  // Uses process.pid (not ppid) — hooks use directory-scan to find any live sentinel.
  // Hardcoded /tmp on Unix to avoid TMPDIR mismatch (#347).
  const mcpSentinelDir = process.platform === "win32" ? tmpdir() : "/tmp";
  const mcpSentinel = join(mcpSentinelDir, `context-mode-mcp-ready-${process.pid}`);
  // #844: handle to the periodic sentinel refresh timer (started after connect).
  let sentinelRefresh: ReturnType<typeof setInterval> | undefined;

  // Clean up own DB + backgrounded processes + preload script on shutdown
  const shutdown = () => {
    executor.cleanupBackgrounded();
    if (_store) _store.close(); // persist DB for --continue sessions
    if (!RESTRICTED_EXECUTION_SERVER) {
      try { unlinkSync(CM_FS_PRELOAD); } catch { /* best effort */ }
    }
    // Remove only a sentinel this execution mode was allowed to create.
    if (!RESTRICTED_EXECUTION_SERVER) {
      try { unlinkSync(mcpSentinel); } catch { /* best effort */ }
    }
    // #844: stop refreshing the sentinel mtime on shutdown.
    if (sentinelRefresh) clearInterval(sentinelRefresh);
  };
  const gracefulShutdown = async () => {
    // Final stats flush — bypass throttle so the last 0-500ms of
    // bytes_indexed / bytes_returned aren't silently lost on SIGTERM/SIGINT
    // (PR #401 grill-me review B1: persistStats early-returns inside throttle
    // window; gracefulShutdown previously did NOT bypass).
    if (!RESTRICTED_EXECUTION_SERVER) {
      try {
        _lastStatsPersist = 0;
        persistStats();
      } catch { /* best effort — never block shutdown */ }
    }
    shutdown();
    process.exit(0);
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => { gracefulShutdown(); });
  process.on("SIGTERM", () => { gracefulShutdown(); });

  // Lifecycle guard: detect parent death + stdin close to prevent orphaned processes (#103)
  startLifecycleGuard({ onShutdown: () => gracefulShutdown() });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // #854: refresh the bridge-child idle clock on each inbound MCP message so an
  // abandoned bridge child (CONTEXT_MODE_BRIDGE_DEPTH>0) self-terminates instead
  // of accumulating under a long-lived Pi/omp parent. Best-effort; no stdin touch.
  attachMcpActivityTap(
    transport as unknown as { onmessage?: (message: unknown, extra?: unknown) => unknown },
  );

  // Detect the active host before deriving installation-channel behavior.
  // Codex marketplace, npm, and source/Git installs have different version
  // authorities and must not share the npm registry update path.
  try {
    const { detectPlatform, getAdapter } = await import("./adapters/detect.js");
    const clientInfo = server.server.getClientVersion();
    const signal = detectPlatform(clientInfo ?? undefined);
    _detectedAdapter = await getAdapter(signal.platform);
    if (clientInfo) {
      console.error(`MCP client: ${clientInfo.name} v${clientInfo.version} → ${signal.platform}`);
    }
  } catch { /* best effort — _detectedAdapter stays null, falls back to .claude */ }

  // Write MCP readiness sentinel (#230)
  const packageRoot = getPackageRoot();
  const installedVersion = _detectedAdapter?.getInstalledVersion() ?? "standalone";
  _installationChannel = inferInstallationChannel({
    adapterName: _detectedAdapter?.name ?? "unknown",
    installedVersion,
    packageRoot,
    sourceCheckout: existsSync(resolve(packageRoot, ".git")),
  });
  if (!RESTRICTED_EXECUTION_SERVER) {
    try { writeFileSync(mcpSentinel, String(process.pid)); } catch { /* best effort */ }
  }

  // #844: refresh the sentinel mtime while the server is alive so readiness
  // probes from a foreign PID namespace (shared /tmp) can trust a recent
  // sentinel even when process.kill(pid, 0) cannot see this PID. The reader's
  // freshness window is 90s (hooks/core/mcp-ready.mjs); refresh at 30s (3x).
  // unref() so this timer never keeps the event loop alive on its own.
  if (!RESTRICTED_EXECUTION_SERVER) {
    sentinelRefresh = setInterval(() => {
      try { writeFileSync(mcpSentinel, String(process.pid)); } catch { /* best effort */ }
    }, 30_000);
    sentinelRefresh.unref();
  }

  // Restore tool-call counters from SessionDB BEFORE the heartbeat fires
  // so the very first persistStats() carries the prior PID's totals into
  // the sidecar JSON the statusline reads. Otherwise `/ctx-upgrade` flashes
  // `0 calls / $0.00` until the user makes another MCP tool call. Wrapped
  // in try/catch — a stats-restore failure must never block server startup.
  if (!RESTRICTED_EXECUTION_SERVER) {
    try {
      const restored = restoreSessionStats(getSessionDbPath());
      if (restored) {
        for (const [tool, count] of Object.entries(restored.calls)) {
          sessionStats.calls[tool] = count;
        }
        for (const [tool, bytes] of Object.entries(restored.bytesReturned)) {
          sessionStats.bytesReturned[tool] = bytes;
        }
        // Anchor uptime_ms to the original session start so `/ctx-upgrade`
        // doesn't reset the "session age" the statusline shows.
        if (restored.sessionStart > 0) {
          sessionStats.sessionStart = restored.sessionStart;
        }
      }
    } catch { /* best effort — never block startup on a stats restore failure */ }
  }

  // Non-blocking version check — result stored for trackResponse warnings.
  // First fetch at startup, then refresh every hour so long-running sessions
  // (some users keep the MCP server alive 24h+) catch new releases without a
  // restart. `.unref()` lets the process exit normally on SIGTERM regardless
  // of pending intervals.
  if (!RESTRICTED_EXECUTION_SERVER && channelUsesNpmRegistry(_installationChannel)) {
    fetchLatestVersion().then(v => { if (v !== "unknown") _latestVersion = v; });
    setInterval(() => {
      fetchLatestVersion().then(v => { if (v !== "unknown") _latestVersion = v; });
    }, 60 * 60 * 1000).unref();
  }

  // Stats heartbeat — keep the statusline truthful while the user works in
  // tools other than MCP (Bash/Read/Edit during long sessions or post-/compact
  // pauses). Without this, stats.updated_at only advances on MCP tool calls,
  // so bin/statusline.mjs falsely flips to "stale — restart to resume saving"
  // even though the server is alive. Heartbeat refreshes updated_at every 60s;
  // statusline staleness threshold is 30min (cliff is 30 missed ticks away).
  if (!RESTRICTED_EXECUTION_SERVER) {
    setInterval(() => persistStats(), 60_000).unref();
  }

  if (process.stdin.isTTY) {
    console.error(`Context Mode MCP server v${VERSION} running on stdio`);
    console.error(`Detected runtimes:\n${getRuntimeSummary(runtimes)}`);
    if (!hasBunRuntime()) {
      console.error(
        "\nPerformance tip: Install Bun for 3-5x faster JS/TS execution",
      );
      console.error("  curl -fsSL https://bun.sh/install | bash");
    }
  }
}

// Runs after every registerTool() above, so the SDK's default tools/list handler
// exists and can be wrapped. Makes ctx_* schemas safe for strict (Gemini
// function-calling) clients like Antigravity CLI (`agy`) / Gemini CLI.
installStrictClientSchemaCompat();

if (process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS !== "1") {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
