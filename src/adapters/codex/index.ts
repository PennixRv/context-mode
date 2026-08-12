/**
 * adapters/codex — Codex CLI platform adapter.
 *
 * Implements HookAdapter for Codex CLI's JSON stdin/stdout paradigm.
 *
 * Codex CLI hook specifics:
 *   - Default hooks: PreToolUse, PreCompact, PostCompact, SessionStart(compact)
 *   - Optional observability: PostToolUse, ordinary SessionStart,
 *     UserPromptSubmit, and Stop
 *   - Same wire protocol as Claude Code (JSON stdin → stdout)
 *   - Config: $CODEX_HOME or ~/.codex (hooks.json + config.toml)
 *   - Session dir: $CODEX_HOME/context-mode/sessions/
 *
 * Hook dispatch is stable in Codex CLI. PreToolUse deny decisions work,
 * while input rewriting remains blocked on upstream updatedInput support.
 * Track: https://github.com/openai/codex/issues/18491
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  accessSync,
  copyFileSync,
  constants,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseAdapter, resolveContextModeDataRoot } from "../base.js";
import { hashProjectDirCanonical } from "../../session/db.js";
import { CODEX_RECOVERY_BRIEF_TOOL_MATCHER } from "../../checkpoint/recovery-brief-capability.js";
import { resolveCodexConfigDir } from "./paths.js";
import {
  projectCodexPluginDiagnostic,
  type CodexPluginDiagnostic,
} from "./diagnostics.js";

import {
  type HookAdapter,
  type HookParadigm,
  type PlatformCapabilities,
  type DiagnosticResult,
  type PreToolUseEvent,
  type PostToolUseEvent,
  type PreCompactEvent,
  type SessionStartEvent,
  type PreToolUseResponse,
  type PostToolUseResponse,
  type PreCompactResponse,
  type SessionStartResponse,
  type HookEntry,
  type HookRegistration,
} from "../types.js";

// ─────────────────────────────────────────────────────────
// Codex CLI raw input types
// ─────────────────────────────────────────────────────────

interface CodexHookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  model?: string;
  permission_mode?: string;
  tool_use_id?: string;
  transcript_path?: string | null;
  turn_id?: string;
  source?: string;
}

interface CodexHooksFile {
  hooks?: HookRegistration;
}

type HooksConfigReadResult =
  | { ok: true; config: CodexHooksFile }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "invalid_json"; error: string }
  | { ok: false; reason: "read_error"; error: string };

// Codex treats this restricted-character matcher as exact alternatives. Keep
// native tools here and put every context-mode alias in one disjoint regex
// group so one tool invocation can select only one managed handler.
const PRE_TOOL_USE_MATCHER_PATTERN =
  "local_shell|shell|shell_command|exec_command|Bash|Shell|apply_patch|Edit|Write|grep_files";
const CODEX_CTX_EXECUTE_TOOL_MATCHER =
  "^(ctx_execute|ctx_execute_file|ctx_batch_execute|ctx_fetch_and_index|ctx_search|ctx_index|mcp__context_mode__ctx_execute|mcp__context_mode__ctx_execute_file|mcp__context_mode__ctx_batch_execute|mcp__context_mode__ctx_fetch_and_index|mcp__context_mode__ctx_search|mcp__context_mode__ctx_index|mcp__plugin_context-mode_context-mode__ctx_execute|mcp__plugin_context-mode_context-mode__ctx_execute_file|mcp__plugin_context-mode_context-mode__ctx_batch_execute|mcp__plugin_context-mode_context-mode__ctx_fetch_and_index|mcp__plugin_context-mode_context-mode__ctx_search|mcp__plugin_context-mode_context-mode__ctx_index)$";

const DEFAULT_HOOK_COMMANDS = {
  PreToolUse: "context-mode hook codex pretooluse",
  PreCompact: "context-mode hook codex checkpointprecompact",
  PostCompact: "context-mode hook codex checkpointpostcompact",
  SessionStart: "context-mode hook codex checkpointsessionstart",
} as const;

const OPTIONAL_OBSERVABILITY_HOOK_COMMANDS = {
  PostToolUse: [
    "context-mode hook codex observabilityposttooluse",
    "context-mode hook codex observabilitycheckpointposttooluse",
  ],
  SessionStart: ["context-mode hook codex observabilitysessionstart"],
  UserPromptSubmit: [
    "context-mode hook codex observabilityuserpromptsubmit",
    "context-mode hook codex observabilitycheckpointuserpromptsubmit",
  ],
  Stop: ["context-mode hook codex observabilitystop"],
} as const;

const LEGACY_HOOK_COMMANDS = {
  PreCompact: ["context-mode hook codex precompact"],
  PostToolUse: [
    "context-mode hook codex posttooluse",
    "context-mode hook codex checkpointposttooluse",
  ],
  SessionStart: ["context-mode hook codex sessionstart"],
  UserPromptSubmit: [
    "context-mode hook codex userpromptsubmit",
    "context-mode hook codex checkpointuserpromptsubmit",
  ],
  Stop: ["context-mode hook codex stop"],
};

const MANAGED_HOOK_PATH_SUFFIXES: Record<string, string[]> = {
  PreToolUse: ["hooks/pretooluse.mjs", "hooks/codex/pretooluse.mjs"],
  PostToolUse: ["hooks/posttooluse.mjs", "hooks/codex/posttooluse.mjs", "hooks/codex/checkpoint-posttooluse.mjs"],
  SessionStart: ["hooks/sessionstart.mjs", "hooks/codex/sessionstart.mjs", "hooks/codex/checkpoint-sessionstart.mjs"],
  PreCompact: ["hooks/precompact.mjs", "hooks/codex/precompact.mjs", "hooks/codex/checkpoint-precompact.mjs"],
  PostCompact: ["hooks/codex/checkpoint-postcompact.mjs"],
  UserPromptSubmit: ["hooks/userpromptsubmit.mjs", "hooks/codex/userpromptsubmit.mjs", "hooks/codex/checkpoint-userpromptsubmit.mjs"],
  Stop: ["hooks/stop.mjs", "hooks/codex/stop.mjs"],
};

const ALL_CONTEXT_MODE_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
] as const;

type CodexObservabilityProfile = "disabled" | "enabled" | "partial" | "unavailable";

export interface CodexObservabilityProfileStatus {
  defaultProfile: "active" | "unavailable";
  profile: CodexObservabilityProfile;
  activeHooks: string[];
  optionalHooks: string[];
  legacyHooks: string[];
  configPath: string;
  defaultHookSource?: string;
  error?: string;
}

type CodexVersionRunner = (
  file: string,
  args: string[],
  options: {
    encoding: BufferEncoding;
    stdio: ["ignore", "pipe", "ignore"];
    timeout: number;
  },
) => string | Buffer;

interface CodexAdapterOptions {
  codexPluginListRunner?: CodexVersionRunner;
}

interface CodexPluginReleaseIdentity {
  name: string;
  version: string;
}

export function probeCodexCliVersion(runCommand: CodexVersionRunner = execFileSync): string | null {
  try {
    const output = process.platform === "win32"
      ? runCommand("cmd.exe", ["/d", "/s", "/c", "codex --version"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      })
      : runCommand("codex", ["--version"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      });
    const version = String(output).trim();
    return version.length > 0 ? version : "available (version output empty)";
  } catch {
    return null;
  }
}

export function parseCodexContextModePluginRoot(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*context-mode@[^\s]+\s+installed,\s+enabled\s+\S+\s+(.+?)\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function getTomlSection(raw: string, sectionName: string): string | null {
  const lines = raw.split(/\r?\n/);
  let inSection = false;
  const body: string[] = [];

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      if (inSection) break;
      inSection = section[1]?.trim() === sectionName;
      continue;
    }
    if (inSection) body.push(line);
  }

  return inSection ? body.join("\n") : null;
}

function hasCodexHooksFeature(raw: string): boolean {
  const features = getTomlSection(raw, "features");
  return features !== null && /^\s*hooks\s*=\s*true\s*(?:#.*)?$/mi.test(features);
}

function hasDeprecatedCodexHooksFeature(raw: string): boolean {
  const features = getTomlSection(raw, "features");
  return features !== null && /^\s*codex_hooks\s*=\s*true\s*(?:#.*)?$/mi.test(features);
}

function getEnabledCodexPluginId(raw: string): string | null {
  const pluginIds = raw
    .split(/\r?\n/)
    .flatMap((line) => line.match(/^\s*\[plugins\."(context-mode@[^"\s]+)"\]\s*(?:#.*)?$/)?.[1] ?? []);

  return pluginIds.find((pluginId) => {
    const plugin = getTomlSection(raw, `plugins."${pluginId}"`);
    return plugin !== null && /^\s*enabled\s*=\s*true\s*(?:#.*)?$/mi.test(plugin);
  }) ?? null;
}

function hasCodexPluginEnabled(raw: string): boolean {
  return getEnabledCodexPluginId(raw) !== null;
}

function hasStandaloneContextModeMcp(raw: string): boolean {
  return getTomlSection(raw, "mcp_servers.context-mode") !== null;
}

function ensureCodexHooksFeature(raw: string): { text: string; changed: boolean } {
  if (hasCodexHooksFeature(raw)) return { text: raw, changed: false };

  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const featuresIndex = lines.findIndex((line) => /^\s*\[features\]\s*(?:#.*)?$/.test(line));

  if (featuresIndex === -1) {
    const prefix = raw.length > 0 && !raw.endsWith("\n") ? newline : "";
    return {
      text: `${raw}${prefix}[features]${newline}hooks = true${newline}`,
      changed: true,
    };
  }

  let endIndex = lines.length;
  for (let i = featuresIndex + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[i] ?? "")) {
      endIndex = i;
      break;
    }
  }

  for (let i = featuresIndex + 1; i < endIndex; i++) {
    if (/^\s*hooks\s*=/.test(lines[i] ?? "")) {
      lines[i] = "hooks = true";
      return { text: lines.join(newline), changed: true };
    }
  }

  lines.splice(featuresIndex + 1, 0, "hooks = true");
  return { text: lines.join(newline), changed: true };
}

function removeTomlSections(
  raw: string,
  shouldRemove: (sectionName: string) => boolean,
): { text: string; removed: string[] } {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  const removed: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      const sectionName = section[1]?.trim() ?? "";
      skipping = shouldRemove(sectionName);
      if (skipping) removed.push(sectionName);
    }
    if (!skipping) out.push(line);
  }

  return { text: out.join(newline), removed };
}

function parseTomlQuotedString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    // Codex hook-state keys are TOML quoted keys, not guaranteed JSON strings.
    // Preserve Windows backslashes such as C:\Users\... even when they are not
    // valid JSON escapes, while still handling the common escaped quote/slash.
    let out = "";
    let escaping = false;
    for (const ch of trimmed.slice(1, -1)) {
      if (escaping) {
        out += ch === '"' || ch === "\\" ? ch : `\\${ch}`;
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else {
        out += ch;
      }
    }
    if (escaping) out += "\\";
    return out;
  }
}

// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────

export class CodexAdapter extends BaseAdapter implements HookAdapter {
  private readonly codexPluginListRunner: CodexVersionRunner;

  constructor(options: CodexAdapterOptions = {}) {
    super([".codex"]);
    this.codexPluginListRunner = options.codexPluginListRunner ?? execFileSync;
  }

  readonly name = "Codex CLI";
  readonly paradigm: HookParadigm = "json-stdio";

  readonly capabilities: PlatformCapabilities = {
    preToolUse: true,
    postToolUse: true,
    preCompact: true,
    sessionStart: true,
    canModifyArgs: false,
    canModifyOutput: false,
    canInjectSessionContext: true,
  };

  // ── Input parsing ──────────────────────────────────────

  parsePreToolUseInput(raw: unknown): PreToolUseEvent {
    const input = raw as CodexHookInput;
    return {
      toolName: input.tool_name ?? "",
      toolInput: input.tool_input ?? {},
      sessionId: this.extractSessionId(input),
      projectDir: this.getProjectDir(input),
      raw,
    };
  }

  parsePostToolUseInput(raw: unknown): PostToolUseEvent {
    const input = raw as CodexHookInput;
    return {
      toolName: input.tool_name ?? "",
      toolInput: input.tool_input ?? {},
      toolOutput: input.tool_response,
      sessionId: this.extractSessionId(input),
      projectDir: this.getProjectDir(input),
      raw,
    };
  }

  parsePreCompactInput(raw: unknown): PreCompactEvent {
    const input = raw as CodexHookInput;
    return {
      sessionId: this.extractSessionId(input),
      projectDir: this.getProjectDir(input),
      raw,
    };
  }

  parseSessionStartInput(raw: unknown): SessionStartEvent {
    const input = raw as CodexHookInput;
    const rawSource = input.source ?? "startup";

    let source: SessionStartEvent["source"];
    switch (rawSource) {
      case "compact":
        source = "compact";
        break;
      case "resume":
        source = "resume";
        break;
      case "clear":
        source = "clear";
        break;
      default:
        source = "startup";
    }

    return {
      sessionId: this.extractSessionId(input),
      source,
      projectDir: this.getProjectDir(input),
      raw,
    };
  }

  // ── Response formatting ────────────────────────────────
  // Codex CLI uses hookSpecificOutput wrapper for all hook responses.
  // Unlike Claude Code, Codex does NOT support updatedInput or updatedMCPToolOutput.

  formatPreToolUseResponse(response: PreToolUseResponse): unknown {
    if (response.decision === "deny") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            response.reason ?? "Blocked by context-mode hook",
        },
      };
    }
    if (response.decision === "context" && response.additionalContext) {
      // Codex does not support additionalContext in PreToolUse (fails open).
      // Context injection works through compact SessionStart; PostToolUse is
      // available only in the explicit optional observability profile.
      return {};
    }
    // "allow" — return empty object for passthrough
    return {};
  }

  formatPostToolUseResponse(response: PostToolUseResponse): unknown {
    if (response.additionalContext) {
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: response.additionalContext,
        },
      };
    }
    return {};
  }

  formatPreCompactResponse(response: PreCompactResponse): unknown {
    // Codex PreCompact currently accepts only universal hook fields.
    // The hook script stores snapshots in context-mode's DB; SessionStart
    // injects them after compaction.
    return {};
  }

  formatSessionStartResponse(response: SessionStartResponse): unknown {
    if (response.context) {
      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: response.context,
        },
      };
    }
    return {};
  }

  // ── Configuration ──────────────────────────────────────

  getConfigDir(_projectDir?: string): string {
    return resolveCodexConfigDir();
  }

  getSettingsPath(): string {
    return join(this.getConfigDir(), "config.toml");
  }

  getSessionDir(): string {
    // Issue #649: honor CONTEXT_MODE_DATA_DIR universal storage override
    // before falling back to the $CODEX_HOME-rooted default. Settings.toml
    // and hooks.json continue to live under getConfigDir() so the Codex CLI
    // sees its own config in the expected place.
    const override = resolveContextModeDataRoot();
    const dir = override
      ? join(override, "context-mode", "sessions")
      : join(this.getConfigDir(), "context-mode", "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // C2 narrowing (2026-05): the historical `getSessionDBPath` /
  // `getSessionEventsPath` overrides were removed. Both delegated to the
  // same canonical helpers (`resolveSessionDbPath` / `hashProjectDirCanonical`
  // + `getWorktreeSuffix`) which already normalize the path internally —
  // the explicit `normalizeWorktreePath` here was a no-op. Callers now reach
  // the helpers directly through `adapter.getSessionDir()`.

  getInstructionFiles(): string[] {
    // Codex CLI honors AGENTS.md plus an optional override file.
    return ["AGENTS.md", "AGENTS.override.md"];
  }

  getMemoryDir(projectDir?: string): string {
    // Codex uses "memories" (plural), not the default "memory".
    // Issue #649: honor CONTEXT_MODE_DATA_DIR for context-mode-owned
    // persistent memory while preserving the platform-native plural folder
    // name so legacy Codex tooling continues to find it when DATA_DIR is
    // unset. Under the override, layout is `<DATA_DIR>/context-mode/memories`.
    // Issue #663: scope by projectDir hash so parallel projects can't
    // read each other's memory.
    const override = resolveContextModeDataRoot();
    const base = override
      ? join(override, "context-mode", "memories")
      : join(this.getConfigDir(), "memories");
    if (!projectDir) return base;
    return join(base, hashProjectDirCanonical(projectDir));
  }

  generateHookConfig(_pluginRoot: string): HookRegistration {
    return {
      PreToolUse: [
        {
          matcher: PRE_TOOL_USE_MATCHER_PATTERN,
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.PreToolUse,
            },
          ],
        },
        {
          matcher: CODEX_RECOVERY_BRIEF_TOOL_MATCHER,
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.PreToolUse,
            },
          ],
        },
        {
          matcher: CODEX_CTX_EXECUTE_TOOL_MATCHER,
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.PreToolUse,
            },
          ],
        },
      ],
      PreCompact: [
        {
          matcher: "^(manual|auto)$",
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.PreCompact,
            },
          ],
        },
      ],
      PostCompact: [
        {
          matcher: "^(manual|auto)$",
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.PostCompact,
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: "^compact$",
          hooks: [
            {
              type: "command",
              command: DEFAULT_HOOK_COMMANDS.SessionStart,
              additionalContextLimit: 1500,
            },
          ],
        },
      ],
    };
  }

  private generateObservabilityHookConfig(): HookRegistration {
    return {
      PostToolUse: [
        {
          matcher: PRE_TOOL_USE_MATCHER_PATTERN,
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.PostToolUse[0],
            },
          ],
        },
        {
          matcher: "^(Bash|apply_patch|Edit|Write)$",
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.PostToolUse[1],
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: "^(startup|resume|clear)$",
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.SessionStart[0],
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.UserPromptSubmit[0],
            },
          ],
        },
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.UserPromptSubmit[1],
            },
          ],
        },
      ],
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: OPTIONAL_OBSERVABILITY_HOOK_COMMANDS.Stop[0],
            },
          ],
        },
      ],
    };
  }

  getObservabilityProfileStatus(pluginRoot?: string): CodexObservabilityProfileStatus {
    const hookConfig = this.readHooksConfig();
    const pluginHookStatus = pluginRoot
      ? this.getInstalledPluginHookStatus(pluginRoot)
      : null;
    if (!hookConfig.ok) {
      return {
        defaultProfile: pluginHookStatus?.hooksAvailable ? "active" : "unavailable",
        profile: hookConfig.reason === "missing" ? "disabled" : "unavailable",
        activeHooks: pluginHookStatus?.hooksAvailable
          ? this.getDefaultProfileHookNames()
          : [],
        optionalHooks: [],
        legacyHooks: [],
        configPath: this.getHooksPath(),
        ...(pluginHookStatus?.hooksAvailable ? {
          defaultHookSource: pluginHookStatus.runtimeRoot ?? pluginHookStatus.configuredRoot,
        } : {}),
        ...(hookConfig.reason === "missing" ? {} : {
          error: hookConfig.reason === "invalid_json"
          ? `${this.getHooksPath()} is not valid JSON: ${hookConfig.error}`
            : `Could not read ${this.getHooksPath()}: ${hookConfig.error}`,
        }),
      };
    }

    return this.createObservabilityProfileStatus(
      this.getHookRegistration(hookConfig.config),
      pluginHookStatus,
    );
  }

  private createObservabilityProfileStatus(
    hooks: HookRegistration,
    pluginHookStatus?: CodexPluginDiagnostic | null,
  ): CodexObservabilityProfileStatus {
    const optionalHooks = this.collectHookNames(
      hooks,
      this.generateObservabilityHookConfig(),
      "optional",
    );
    const legacyHooks = this.collectLegacyHookNames(hooks);
    const activeHooks = [
      ...(pluginHookStatus?.hooksAvailable
        ? this.getDefaultProfileHookNames()
        : this.collectHookNames(hooks, this.generateHookConfig(""), "default")),
      ...optionalHooks,
    ];
    const expectedOptionalCount = Object.values(this.generateObservabilityHookConfig())
      .reduce((count, entries) => count + entries.length, 0);
    const configuredOptionalCount = this.countConfiguredExpectedEntries(
      hooks,
      this.generateObservabilityHookConfig(),
    );

    return {
      defaultProfile: pluginHookStatus?.hooksAvailable ? "active" : "unavailable",
      profile: configuredOptionalCount === expectedOptionalCount
        ? "enabled"
        : configuredOptionalCount > 0
          ? "partial"
          : "disabled",
      activeHooks,
      optionalHooks,
      legacyHooks,
      configPath: this.getHooksPath(),
      ...(pluginHookStatus?.hooksAvailable ? {
        defaultHookSource: pluginHookStatus.runtimeRoot ?? pluginHookStatus.configuredRoot,
      } : {}),
    };
  }

  private getDefaultProfileHookNames(): string[] {
    return [
      "PreToolUse (default)",
      "PreCompact (default)",
      "PostCompact (default)",
      "SessionStart (default)",
    ];
  }

  enableObservabilityProfile(): string[] {
    const changes: string[] = [];
    const hookConfig = this.readHooksConfig();
    const hookFile: CodexHooksFile = hookConfig.ok
      ? hookConfig.config
      : hookConfig.reason === "missing"
        ? {}
        : hookConfig.reason === "invalid_json"
          ? (() => {
            const backupPath = this.backupFile(this.getHooksPath(), ".broken");
            changes.push(`Backed up malformed Codex hooks to ${backupPath}`);
            return {};
          })()
          : (() => {
            throw new Error(`Failed to update ${this.getHooksPath()}: ${hookConfig.error}`);
          })();
    const hooks = this.getHookRegistration(hookFile);
    this.removeLegacyHookEntries(hooks, changes);
    const optionalHooks = this.generateObservabilityHookConfig();
    for (const [hookName, entries] of Object.entries(optionalHooks)) {
      this.upsertOptionalHookEntries(hooks, hookName, entries, changes);
    }
    if (changes.length > 0) this.writeHooksConfig({ ...hookFile, hooks });
    this.ensureHooksFeatureEnabled(changes);
    changes.push(
      "Enabled Codex observability profile; additional hook-panel entries and local state writes are active",
    );
    return changes;
  }

  disableObservabilityProfile(): string[] {
    const changes: string[] = [];
    const hookConfig = this.readHooksConfig();
    if (!hookConfig.ok) return [
      hookConfig.reason === "missing"
        ? `No readable ${this.getHooksPath()} found`
        : `Could not update ${this.getHooksPath()}`,
    ];
    const hooks = this.getHookRegistration(hookConfig.config);
    for (const hookName of Object.keys(this.generateObservabilityHookConfig())) {
      this.removeOptionalHookEntries(hooks, hookName, changes);
    }
    if (changes.length > 0) this.writeHooksConfig({ ...hookConfig.config, hooks });
    return changes.length > 0 ? changes : ["Codex observability profile already disabled"];
  }

  readSettings(): Record<string, unknown> | null {
    // Codex CLI uses TOML format. Full TOML parsing is complex;
    // return null for now. MCP configuration should be done manually
    // or via a dedicated TOML library in the upgrade flow.
    try {
      const raw = readFileSync(this.getSettingsPath(), "utf-8");
      // Return raw TOML as a single-key object for inspection
      return { _raw_toml: raw };
    } catch {
      return null;
    }
  }

  writeSettings(_settings: Record<string, unknown>): void {
    // Codex CLI uses TOML format. Writing TOML requires a dedicated
    // serializer. This is a no-op; TOML config should be edited
    // manually or via the `codex` CLI tool.
  }

  // ── Diagnostics (doctor) ─────────────────────────────────

  validateHooks(pluginRoot: string): DiagnosticResult[] {
    const results: DiagnosticResult[] = [];
    const codexCliVersion = probeCodexCliVersion();
    let settingsRaw = "";
    let settingsReadable = false;

    results.push({
      check: "Codex CLI binary",
      status: codexCliVersion ? "pass" : "warn",
      message: codexCliVersion
        ? `codex --version resolved to ${codexCliVersion}`
        : "Could not run codex --version; hooks need the Codex CLI available on PATH",
      ...(codexCliVersion ? {} : { fix: "Install Codex CLI or make codex available on PATH" }),
    });

    try {
      settingsRaw = readFileSync(this.getSettingsPath(), "utf-8");
      settingsReadable = true;
      const enabled = hasCodexHooksFeature(settingsRaw);
      const deprecatedOnly = !enabled && hasDeprecatedCodexHooksFeature(settingsRaw);

      results.push({
        check: "Codex hooks feature flag",
        status: enabled ? "pass" : "fail",
        message: enabled
          ? `[features].hooks enabled in ${this.getSettingsPath()}`
          : deprecatedOnly
            ? `[features].codex_hooks is deprecated; [features].hooks is missing in ${this.getSettingsPath()}`
            : `[features].hooks missing from ${this.getSettingsPath()}`,
        ...(enabled ? {} : { fix: "context-mode upgrade" }),
      });
    } catch {
      results.push({
        check: "Codex hooks feature flag",
        status: "warn",
        message: `Could not read ${this.getSettingsPath()}`,
        fix: "context-mode upgrade",
      });
    }

    const expected = this.generateHookConfig("");
    const pluginHookStatus = this.getCodexPluginHookStatus(pluginRoot, settingsRaw, settingsReadable);
    const codexPluginEnabled = pluginHookStatus.enabled;
    const codexPluginHooksAvailable = pluginHookStatus.hooksAvailable;
    if (codexPluginEnabled && pluginHookStatus.runtimeRoot) {
      const rootDrift = pluginHookStatus.rootMismatch && !pluginHookStatus.releaseMatches;
      results.push({
        check: "Codex plugin root",
        status: rootDrift ? "warn" : "pass",
        message: rootDrift
          ? `context-mode doctor is running from ${pluginHookStatus.configuredRoot}, but Codex plugin manager reports ${pluginHookStatus.runtimeRoot}`
          : pluginHookStatus.rootMismatch
            ? `Codex plugin manager reports ${pluginHookStatus.runtimeRoot}; it matches the release running from ${pluginHookStatus.configuredRoot}`
          : `Codex plugin manager reports ${pluginHookStatus.runtimeRoot}`,
        ...(rootDrift
          ? { fix: "Restart Codex after upgrade; run context-mode upgrade to keep native user-hook fallback until the plugin root converges" }
          : {}),
      });
    } else if (codexPluginEnabled) {
      results.push({
        check: "Codex plugin root",
        status: "warn",
        message: "context-mode@context-mode is enabled, but `codex plugin list` did not report its runtime root",
        fix: "Restart Codex or verify `codex plugin list` shows context-mode@context-mode installed and enabled",
      });
    }
    if (codexPluginEnabled && !codexPluginHooksAvailable) {
      const expectedRoot = pluginHookStatus.runtimeRoot ?? pluginRoot;
      const hookDetail = pluginHookStatus.runtimeRoot === null
        ? "`codex plugin list` did not report an active runtime root"
        : !pluginHookStatus.runtimeManifestAvailable
          ? `${join(expectedRoot, ".codex-plugin", "hooks.json")} is missing`
          : `required hook events are missing (${pluginHookStatus.missingHooks.join(", ")})`;
      results.push({
        check: "Codex plugin hooks",
        status: "fail",
        message: `context-mode Codex plugin is enabled, but ${hookDetail}`,
        fix: "Reinstall or upgrade the context-mode Codex plugin",
      });
    }
    if (codexPluginEnabled && hasStandaloneContextModeMcp(settingsRaw)) {
      results.push({
        check: "Standalone MCP duplicate",
        status: "warn",
        message: "[mcp_servers.context-mode] is still registered while context-mode@context-mode is enabled; Codex may start both plugin and standalone MCP surfaces",
        fix: "context-mode upgrade (removes the standalone Codex MCP registration when the plugin owns context-mode)",
      });
    }

    const hookConfig = this.readHooksConfig();
    const profileChecks = this.getProfileDiagnosticResults(
      hookConfig,
      codexPluginHooksAvailable,
    );
    if (!hookConfig.ok) {
      if (hookConfig.reason === "missing" && codexPluginHooksAvailable) {
        const pluginHookChecks = Object.keys(expected).map((hookName) => ({
          check: `${hookName} hook`,
          status: "pass" as const,
          message: `${hookName} hook provided by context-mode@context-mode plugin`,
        }));
        return results.concat(pluginHookChecks, profileChecks);
      }
      if (hookConfig.reason === "missing") {
        return results.concat([{
          check: "Hooks config",
          status: "fail",
          message: `No readable ${this.getHooksPath()} found`,
          fix: "Copy configs/codex/hooks.json to hooks.json or run context-mode upgrade",
        }], profileChecks);
      }
      if (hookConfig.reason === "invalid_json") {
        return results.concat([{
          check: "Hooks config",
          status: "fail",
          message: `${this.getHooksPath()} is not valid JSON: ${hookConfig.error}`,
          fix: "Repair hooks.json so it contains valid JSON, then rerun context-mode upgrade if needed",
        }], profileChecks);
      }

      return results.concat([{
        check: "Hooks config",
        status: "fail",
        message: `Could not read ${this.getHooksPath()}: ${hookConfig.error}`,
        fix: "Check permissions and file accessibility for hooks.json, then rerun context-mode upgrade if needed",
      }], profileChecks);
    }

    if (!hookConfig.config.hooks && !codexPluginHooksAvailable) {
      return results.concat([{
        check: "Hooks config",
        status: "fail",
        message: `${this.getHooksPath()} is missing the top-level hooks object`,
        fix: `Update ${this.getHooksPath()} to match configs/codex/hooks.json`,
      }], profileChecks);
    }

    const hookChecks = codexPluginHooksAvailable
      ? Object.keys(expected).map((hookName) => ({
        check: `${hookName} hook`,
        status: "pass" as const,
        message: `${hookName} hook provided by context-mode@context-mode plugin`,
      }))
      : Object.entries(expected).map(([hookName, entries]) => {
        const actualEntries = hookConfig.config.hooks?.[hookName];
        const ok = Array.isArray(actualEntries)
          && entries.every((expectedEntry) => actualEntries.some((entry) =>
            this.isExpectedHookEntry(hookName, entry, expectedEntry),
          ));
        const isCompactionLifecycleHook = hookName === "PreCompact" || hookName === "PostCompact";
        const missingStatus = isCompactionLifecycleHook ? "warn" : "fail";

        return {
          check: `${hookName} hook`,
          status: (ok ? "pass" : missingStatus) as "pass" | "warn" | "fail",
          message: ok
            ? `${hookName} hook configured in ${this.getHooksPath()}`
            : isCompactionLifecycleHook
              ? `${hookName} hook missing or not pointing to context-mode; confirmed checkpoints require a Codex build that emits PreCompact and PostCompact`
              : `${hookName} hook missing or not pointing to context-mode`,
          fix: ok ? undefined : `Update ${this.getHooksPath()} to match configs/codex/hooks.json`,
        };
      });

    // #603: surface duplicate context-mode entries per hook event. Codex fires
    // every matching entry, so duplicates double the work, can saturate the
    // MCP transport (`Transport closed`), and have been observed to inflate
    // codex-tui.log into the multi-GB range. `context-mode upgrade` collapses
    // them via `upsertManagedHookEntry`, so the fix is one command away.
    const duplicateChecks: DiagnosticResult[] = [];
    for (const hookName of Object.keys(expected)) {
      const actualEntries = hookConfig.config.hooks?.[hookName];
      if (!Array.isArray(actualEntries)) continue;
      const expectedEntries = expected[hookName] ?? [];
      const duplicateExpectedEntry = expectedEntries.find((expectedEntry) =>
        actualEntries.filter((entry) =>
          this.isExpectedHookEntry(hookName, entry as HookEntry, expectedEntry),
        ).length > 1,
      );
      const hasStaleManagedEntry = actualEntries.some((entry) =>
        this.isManagedContextModeEntry(hookName, entry as HookEntry)
        && !expectedEntries.some((expectedEntry) =>
          this.isExpectedHookEntry(hookName, entry as HookEntry, expectedEntry),
        ),
      );
      const managedCount = actualEntries.filter(
        (entry) => this.isManagedContextModeEntry(hookName, entry as HookEntry),
      ).length;
      if (duplicateExpectedEntry || hasStaleManagedEntry || managedCount > expectedEntries.length) {
        duplicateChecks.push({
          check: `${hookName} duplicates`,
          status: "warn",
          message: duplicateExpectedEntry
            ? `Duplicate ${duplicateExpectedEntry.hooks[0]?.command ?? "context-mode"} entries found for ${hookName} in ${this.getHooksPath()}; Codex will fire all of them`
            : hasStaleManagedEntry
              ? `Stale context-mode ${hookName} entry found in ${this.getHooksPath()}; run upgrade to install the exact default matcher`
            : `${managedCount} context-mode entries found for ${hookName} in ${this.getHooksPath()}; expected at most ${expectedEntries.length}`,
          fix: "context-mode upgrade (collapses duplicate context-mode entries; preserves unrelated hooks)",
        });
      } else if (codexPluginHooksAvailable && managedCount > 0) {
        duplicateChecks.push({
          check: `${hookName} plugin duplicate`,
          status: "warn",
          message: `${hookName} is configured in both ${this.getHooksPath()} and the context-mode Codex plugin; Codex will fire both hooks`,
          fix: "context-mode upgrade (removes user config context-mode hooks; preserves unrelated hooks)",
        });
      }
    }

    return results.concat(hookChecks, duplicateChecks, profileChecks);
  }

  checkPluginRegistration(pluginRoot = process.cwd()): DiagnosticResult {
    try {
      const raw = readFileSync(this.getSettingsPath(), "utf-8");
      const diagnostic = this.getCodexPluginHookStatus(pluginRoot, raw, true);
      const pluginId = diagnostic.pluginId;
      const pluginEnabled = diagnostic.enabled;
      const standaloneMcp = hasStandaloneContextModeMcp(raw);
      const hasMcpSection =
        raw.includes("[mcp_servers]") || raw.includes("[mcp_servers.");

      if (pluginEnabled && standaloneMcp) {
        return {
          check: "MCP registration",
          status: "warn",
          message: `${pluginId} plugin is enabled, but standalone [mcp_servers.context-mode] is also configured`,
          fix: "context-mode upgrade",
        };
      }

      if (pluginEnabled) {
        if (!diagnostic.runtimeRoot) {
          return {
            check: "MCP registration",
            status: "warn",
            message: `${pluginId} is enabled in config.toml, but codex plugin list did not report an active runtime root`,
            fix: "Restart Codex or reinstall the context-mode marketplace plugin",
          };
        }
        if (!diagnostic.hooksAvailable) {
          return {
            check: "MCP registration",
            status: "fail",
            message: `${pluginId} is enabled at ${diagnostic.runtimeRoot}, but required plugin hooks are unavailable${diagnostic.missingHooks.length ? ` (${diagnostic.missingHooks.join(", ")})` : ""}`,
            fix: "Reinstall or upgrade the context-mode Codex plugin",
          };
        }
        return {
          check: "MCP registration",
          status: "pass",
          message: `${pluginId} plugin enabled at ${diagnostic.runtimeRoot}${diagnostic.version ? ` (v${diagnostic.version})` : ""}; required hooks registered`,
        };
      }

      if (standaloneMcp) {
        return {
          check: "MCP registration",
          status: "pass",
          message: "context-mode found in [mcp_servers] config",
        };
      }

      if (hasMcpSection) {
        return {
          check: "MCP registration",
          status: "fail",
          message:
            "[mcp_servers] section exists but context-mode not found",
          fix: `Add context-mode to [mcp_servers] in ${this.getSettingsPath()}`,
        };
      }

      return {
        check: "MCP registration",
        status: "fail",
        message: "No [mcp_servers] section in config.toml",
        fix: `Add [mcp_servers.context-mode] to ${this.getSettingsPath()}`,
      };
    } catch {
      return {
        check: "MCP registration",
        status: "warn",
        message: `Could not read ${this.getSettingsPath()}`,
      };
    }
  }

  getInstalledVersion(): string {
    const runtimeRoot = this.probeCodexContextModePluginRoot();
    return runtimeRoot
      ? this.readCodexPluginReleaseIdentity(runtimeRoot)?.version ?? "standalone"
      : "standalone";
  }

  /** Shared typed facts consumed by CLI Doctor, MCP Doctor, and hook validation. */
  getCodexPluginDiagnostic(pluginRoot: string): CodexPluginDiagnostic {
    let settingsRaw = "";
    let settingsReadable = false;
    try {
      settingsRaw = readFileSync(this.getSettingsPath(), "utf-8");
      settingsReadable = true;
    } catch {
      // The projection records disabled/unavailable rather than guessing.
    }
    return this.getCodexPluginHookStatus(pluginRoot, settingsRaw, settingsReadable);
  }

  // ── Upgrade ────────────────────────────────────────────

  configureAllHooks(pluginRoot: string): string[] {
    const hookConfig = this.readHooksConfig();
    const changes: string[] = [];
    const settingsPath = this.getSettingsPath();
    let settingsRaw = "";
    try {
      settingsRaw = readFileSync(settingsPath, "utf-8");
    } catch {
      settingsRaw = "";
    }
    const pluginHookStatus = this.getCodexPluginHookStatus(pluginRoot, settingsRaw, settingsRaw.length > 0);
    const codexPluginOwnsHooks = pluginHookStatus.ownsHooksForUpgrade;
    let hookFile: CodexHooksFile;
    if (hookConfig.ok) {
      hookFile = hookConfig.config;
    } else if (hookConfig.reason === "missing") {
      hookFile = { hooks: {} };
    } else if (hookConfig.reason === "invalid_json") {
      const backupPath = this.backupFile(this.getHooksPath(), ".broken");
      changes.push(`Backed up malformed Codex hooks to ${backupPath}`);
      hookFile = { hooks: {} };
    } else {
      throw new Error(`Failed to update ${this.getHooksPath()}: ${hookConfig.error}`);
    }

    const hooks = this.getHookRegistration(hookFile);
    const desiredHooks = this.generateHookConfig(pluginRoot);
    const hookChangeStart = changes.length;

    this.removeLegacyHookEntries(hooks, changes);
    if (codexPluginOwnsHooks) {
      for (const hookName of Object.keys(desiredHooks)) {
        this.removeDefaultHookEntries(hooks, hookName, changes);
      }
    } else {
      for (const [hookName, entries] of Object.entries(desiredHooks)) {
        this.upsertDefaultHookEntries(hooks, hookName, entries, changes);
      }
    }

    if (changes.length > hookChangeStart) {
      hookFile.hooks = hooks;
      this.writeHooksConfig(hookFile);
      changes.push(
        codexPluginOwnsHooks
          ? `Removed context-mode default and legacy user hooks from ${this.getHooksPath()}`
          : `Wrote native Codex hooks to ${this.getHooksPath()}`,
      );
    }

    let settingsText = ensureCodexHooksFeature(settingsRaw).text;
    const enabledSettingsChanged = settingsText !== settingsRaw;
    if (codexPluginOwnsHooks) {
      const removedMcp = removeTomlSections(settingsText, (sectionName) =>
        sectionName === "mcp_servers.context-mode"
        || sectionName.startsWith("mcp_servers.context-mode.tools."),
      );
      if (removedMcp.removed.length > 0) {
        settingsText = removedMcp.text;
        changes.push("Removed standalone Codex context-mode MCP registration");
      }

      const prunedTrust = this.pruneStaleUserHookTrustState(settingsText, hooks);
      if (prunedTrust.removed.length > 0) {
        settingsText = prunedTrust.text;
        changes.push(`Removed ${prunedTrust.removed.length} stale Codex hook trust entr${prunedTrust.removed.length === 1 ? "y" : "ies"}`);
      }
    }

    if (settingsText !== settingsRaw) {
      const newline = settingsText.includes("\r\n") ? "\r\n" : "\n";
      const text = settingsText.endsWith("\n")
        ? settingsText
        : `${settingsText}${newline}`;
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, text, "utf-8");
      if (enabledSettingsChanged) changes.push("Enabled Codex hooks feature flag");
    }

    return changes;
  }

  backupSettings(): string | null {
    let firstBackupPath: string | null = null;
    for (const settingsPath of [this.getHooksPath(), this.getSettingsPath()]) {
      try {
        accessSync(settingsPath, constants.R_OK);
        const backupPath = this.backupFile(settingsPath);
        firstBackupPath ??= backupPath;
      } catch {
        continue;
      }
    }
    return firstBackupPath;
  }



  setHookPermissions(_pluginRoot: string): string[] {
    // Hook permissions are set during plugin install
    return [];
  }

  updatePluginRegistry(_pluginRoot: string, _version: string): void {
    // Codex CLI has no plugin registry
  }

  getRoutingInstructions(): string {
    const instructionsPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "configs",
      "codex",
      "AGENTS.md",
    );
    try {
      return readFileSync(instructionsPath, "utf-8");
    } catch {
      // Fallback inline instructions
      return "# context-mode\n\nUse context-mode MCP tools (execute, execute_file, batch_execute, fetch_and_index, search) instead of bash/cat/curl for data-heavy operations.";
    }
  }

  // ── Internal helpers ───────────────────────────────────

  /**
   * Resolve the project directory for a Codex hook input.
   * Priority: input.cwd > CODEX_PROJECT_DIR env > process.cwd().
   * Mirrors the cursor / opencode pattern so downstream hooks always
   * receive a defined projectDir even under worktrees or when the
   * platform omits cwd from the wire payload.
   */
  private getProjectDir(input: CodexHookInput): string {
    return input.cwd ?? process.env.CODEX_PROJECT_DIR ?? process.cwd();
  }

  getHooksPath(): string {
    return join(this.getConfigDir(), "hooks.json");
  }

  private backupFile(filePath: string, suffix = ""): string {
    const backupPath = suffix
      ? `${filePath}${suffix}-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
      : `${filePath}.bak`;
    copyFileSync(filePath, backupPath);
    return backupPath;
  }

  private readHooksConfig(): HooksConfigReadResult {
    const hooksPath = this.getHooksPath();
    try {
      return { ok: true, config: JSON.parse(readFileSync(hooksPath, "utf-8")) as CodexHooksFile };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

      if (code === "ENOENT") {
        return { ok: false, reason: "missing" };
      }
      if (error instanceof SyntaxError) {
        return { ok: false, reason: "invalid_json", error: message };
      }
      return { ok: false, reason: "read_error", error: message };
    }
  }

  private writeHooksConfig(config: CodexHooksFile): void {
    const hooksPath = this.getHooksPath();
    mkdirSync(dirname(hooksPath), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }

  private ensureHooksFeatureEnabled(changes: string[]): void {
    const settingsPath = this.getSettingsPath();
    let settingsRaw: string;
    try {
      settingsRaw = readFileSync(settingsPath, "utf-8");
    } catch {
      settingsRaw = "";
    }
    const settings = ensureCodexHooksFeature(settingsRaw);
    if (!settings.changed) return;
    const newline = settings.text.includes("\r\n") ? "\r\n" : "\n";
    const text = settings.text.endsWith("\n")
      ? settings.text
      : `${settings.text}${newline}`;
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, text, "utf-8");
    changes.push("Enabled Codex hooks feature flag");
  }

  private getProfileDiagnosticResults(
    hookConfig: HooksConfigReadResult,
    pluginHooksAvailable: boolean,
  ): DiagnosticResult[] {
    if (!hookConfig.ok) {
      const source = pluginHooksAvailable ? "static plugin manifest" : this.getHooksPath();
      return [
        {
          check: "Codex hook profile",
          status: pluginHooksAvailable ? "pass" : "warn",
          message: pluginHooksAvailable
            ? `default low-noise profile active from ${source}; optional observability disabled`
            : `default low-noise profile state unavailable: ${hookConfig.reason}`,
        },
        {
          check: "Codex active context-mode hooks",
          status: pluginHooksAvailable ? "pass" : "warn",
          message: pluginHooksAvailable
            ? `PreToolUse, PreCompact, PostCompact, and SessionStart(compact) from ${source}`
            : "No active context-mode user hooks could be inspected",
        },
        {
          check: "Codex optional observability capability",
          status: "pass",
          message: "available; disabled (enable with `context-mode observability enable`)",
        },
        {
          check: "Codex legacy hook registrations",
          status: "pass",
          message: "none detected",
        },
      ];
    }

    const status = this.createObservabilityProfileStatus(
      this.getHookRegistration(hookConfig.config),
    );
    const defaultHooks = pluginHooksAvailable
      ? ["PreToolUse (default)", "PreCompact (default)", "PostCompact (default)", "SessionStart (default)"]
      : status.activeHooks.filter((hook) => hook.endsWith("(default)"));
    const activeHooks = [...new Set([...defaultHooks, ...status.optionalHooks])];
    const profileStatus = status.profile === "partial" ? "warn" : "pass";
    const profileLabel = status.profile === "enabled"
      ? "default + optional observability"
      : status.profile === "partial"
        ? "default + partial observability"
        : "default low-noise";

    return [
      {
        check: "Codex hook profile",
        status: profileStatus,
        message: `${profileLabel} profile active in ${this.getHooksPath()}`,
      },
      {
        check: "Codex active context-mode hooks",
        status: activeHooks.length > 0 ? "pass" : "warn",
        message: activeHooks.length > 0 ? activeHooks.join(", ") : "none detected",
      },
      {
        check: "Codex optional observability capability",
        status: status.profile === "enabled" ? "warn" : "pass",
        message: status.profile === "enabled"
          ? "enabled; adds hook-panel entries and local state writes"
          : status.profile === "partial"
            ? "partially enabled; run `context-mode observability disable` then enable again"
            : "available; disabled (enable with `context-mode observability enable`)",
      },
      {
        check: "Codex legacy hook registrations",
        status: status.legacyHooks.length > 0 ? "warn" : "pass",
        message: status.legacyHooks.length > 0
          ? `${status.legacyHooks.join(", ")} still registered; run context-mode upgrade`
          : "none detected",
        ...(status.legacyHooks.length > 0 ? { fix: "context-mode upgrade" } : {}),
      },
    ];
  }

  private getHookRegistration(hookFile: CodexHooksFile): HookRegistration {
    return hookFile.hooks
      && typeof hookFile.hooks === "object"
      && !Array.isArray(hookFile.hooks)
      ? hookFile.hooks
      : {};
  }

  private upsertDefaultHookEntries(
    hooks: HookRegistration,
    hookName: string,
    expectedEntries: HookEntry[],
    changes: string[],
  ): void {
    const currentEntries = Array.isArray(hooks[hookName]) ? [...hooks[hookName]] : [];
    const unmanagedEntries = currentEntries.filter((entry) =>
      !this.isDefaultHookEntry(hookName, entry),
    );
    const replacement = [...unmanagedEntries, ...expectedEntries];
    if (JSON.stringify(currentEntries) === JSON.stringify(replacement)) return;
    hooks[hookName] = replacement;
    changes.push(`Updated ${hookName} hook`);
  }

  private removeDefaultHookEntries(
    hooks: HookRegistration,
    hookName: string,
    changes: string[],
  ): void {
    const currentEntries = Array.isArray(hooks[hookName]) ? [...hooks[hookName]] : [];
    const filtered = currentEntries.filter((entry) =>
      !this.isDefaultHookEntry(hookName, entry),
    );
    const removed = currentEntries.length - filtered.length;
    if (removed === 0) return;

    if (filtered.length > 0) {
      hooks[hookName] = filtered;
    } else {
      delete hooks[hookName];
    }
    changes.push(`Removed ${removed} ${hookName} context-mode user hook${removed === 1 ? "" : "s"}`);
  }

  private upsertOptionalHookEntries(
    hooks: HookRegistration,
    hookName: string,
    expectedEntries: HookEntry[],
    changes: string[],
  ): void {
    const currentEntries = Array.isArray(hooks[hookName]) ? [...hooks[hookName]] : [];
    const unmanagedEntries = currentEntries.filter((entry) =>
      !this.isOptionalHookEntry(hookName, entry),
    );
    const replacement = [...unmanagedEntries, ...expectedEntries];
    if (JSON.stringify(currentEntries) === JSON.stringify(replacement)) return;
    hooks[hookName] = replacement;
    changes.push(`Enabled optional ${hookName} observability hook`);
  }

  private removeOptionalHookEntries(
    hooks: HookRegistration,
    hookName: string,
    changes: string[],
  ): void {
    const currentEntries = Array.isArray(hooks[hookName]) ? [...hooks[hookName]] : [];
    const filtered = currentEntries.filter((entry) =>
      !this.isOptionalHookEntry(hookName, entry),
    );
    const removed = currentEntries.length - filtered.length;
    if (removed === 0) return;
    if (filtered.length > 0) hooks[hookName] = filtered;
    else delete hooks[hookName];
    changes.push(`Removed ${removed} optional ${hookName} observability hook${removed === 1 ? "" : "s"}`);
  }

  private removeLegacyHookEntries(
    hooks: HookRegistration,
    changes: string[],
  ): void {
    for (const hookName of Object.keys(LEGACY_HOOK_COMMANDS)) {
      const currentEntries = Array.isArray(hooks[hookName]) ? [...hooks[hookName]] : [];
      const filtered = currentEntries.filter((entry) =>
        !this.isLegacyHookEntry(hookName, entry),
      );
      const removed = currentEntries.length - filtered.length;
      if (removed === 0) continue;
      if (filtered.length > 0) hooks[hookName] = filtered;
      else delete hooks[hookName];
      changes.push(`Removed ${removed} legacy ${hookName} context-mode hook${removed === 1 ? "" : "s"}`);
    }
  }

  private hasCodexPluginHookManifest(pluginRoot: string): boolean {
    return existsSync(join(pluginRoot, ".codex-plugin", "hooks.json"));
  }

  private readCodexPluginHookEvents(pluginRoot: string): string[] {
    try {
      const manifest = JSON.parse(
        readFileSync(join(pluginRoot, ".codex-plugin", "hooks.json"), "utf-8"),
      ) as { hooks?: Record<string, unknown> };
      return Object.entries(manifest.hooks ?? {})
        .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
        .map(([event]) => event)
        .sort();
    } catch {
      return [];
    }
  }

  private readCodexPluginReleaseIdentity(pluginRoot: string): CodexPluginReleaseIdentity | null {
    try {
      const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
        return null;
      }
      return {
        name: manifest.name,
        version: manifest.version,
      };
    } catch {
      return null;
    }
  }

  private hasMatchingCodexPluginRelease(
    configuredRoot: string,
    runtimeRoot: string,
  ): boolean {
    const configuredRelease = this.readCodexPluginReleaseIdentity(configuredRoot);
    const runtimeRelease = this.readCodexPluginReleaseIdentity(runtimeRoot);
    return configuredRelease !== null
      && runtimeRelease !== null
      && configuredRelease.name === "context-mode"
      && runtimeRelease.name === "context-mode"
      && configuredRelease.name === runtimeRelease.name
      && configuredRelease.version === runtimeRelease.version;
  }

  private getCodexPluginHookStatus(
    pluginRoot: string,
    settingsRaw: string,
    settingsReadable: boolean,
  ): CodexPluginDiagnostic {
    const pluginId = settingsReadable ? getEnabledCodexPluginId(settingsRaw) : null;
    const enabled = pluginId !== null;
    const configuredRoot = resolve(pluginRoot);
    const configuredManifestAvailable = this.hasCodexPluginHookManifest(configuredRoot);
    const runtimeRoot = enabled ? this.probeCodexContextModePluginRoot() : null;
    const runtimeManifestAvailable = runtimeRoot
      ? this.hasCodexPluginHookManifest(runtimeRoot)
      : false;
    const runtimeRelease = runtimeRoot
      ? this.readCodexPluginReleaseIdentity(runtimeRoot)
      : null;
    const requiredHooks = Object.keys(this.generateHookConfig(""));
    const registeredHooks = runtimeRoot
      ? this.readCodexPluginHookEvents(runtimeRoot)
      : [];
    return projectCodexPluginDiagnostic({
      enabled,
      pluginId,
      version: runtimeRelease?.version ?? null,
      configuredRoot,
      configuredManifestAvailable,
      runtimeRoot,
      runtimeManifestAvailable,
      sameRoot: runtimeRoot ? this.samePath(configuredRoot, runtimeRoot) : false,
      releaseMatches: runtimeRoot !== null
        && this.hasMatchingCodexPluginRelease(configuredRoot, runtimeRoot),
      requiredHooks,
      registeredHooks,
    });
  }

  private getInstalledPluginHookStatus(pluginRoot: string): CodexPluginDiagnostic {
    let settingsRaw = "";
    let settingsReadable = false;
    try {
      settingsRaw = readFileSync(this.getSettingsPath(), "utf-8");
      settingsReadable = true;
    } catch {
      // An unavailable settings file cannot prove a plugin-owned profile.
    }
    return this.getCodexPluginHookStatus(pluginRoot, settingsRaw, settingsReadable);
  }

  private probeCodexContextModePluginRoot(): string | null {
    try {
      const output = process.platform === "win32"
        ? this.codexPluginListRunner("cmd.exe", ["/d", "/s", "/c", "codex plugin list"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        })
        : this.codexPluginListRunner("codex", ["plugin", "list"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
      return parseCodexContextModePluginRoot(String(output));
    } catch {
      return null;
    }
  }

  private samePath(left: string, right: string): boolean {
    return this.normalizeCommand(resolve(left)) === this.normalizeCommand(resolve(right));
  }

  private pruneStaleUserHookTrustState(
    settingsRaw: string,
    hooks: HookRegistration,
  ): { text: string; removed: string[] } {
    const hooksPath = this.normalizeCommand(this.getHooksPath());
    const eventNames: Record<string, string> = {
      post_compact: "PostCompact",
      post_tool_use: "PostToolUse",
      pre_compact: "PreCompact",
      pre_tool_use: "PreToolUse",
      session_start: "SessionStart",
      stop: "Stop",
      user_prompt_submit: "UserPromptSubmit",
    };

    return removeTomlSections(settingsRaw, (sectionName) => {
      const prefix = "hooks.state.";
      if (!sectionName.startsWith(prefix)) return false;

      const key = parseTomlQuotedString(sectionName.slice(prefix.length));
      if (key === null) return false;

      const normalized = this.normalizeCommand(key);
      const parts = normalized.split(":");
      const hookIndex = Number(parts.pop());
      const entryIndex = Number(parts.pop());
      const eventName = eventNames[parts.pop() ?? ""];
      const stateHooksPath = parts.join(":");
      if (
        stateHooksPath !== hooksPath
        || !eventName
        || !Number.isInteger(entryIndex)
        || !Number.isInteger(hookIndex)
      ) {
        return false;
      }

      const entry = hooks[eventName]?.[entryIndex];
      return !entry || !Array.isArray(entry.hooks) || !entry.hooks[hookIndex];
    });
  }

  private isExpectedHookEntry(
    hookName: string,
    entry: HookEntry,
    expectedEntry: HookEntry,
  ): boolean {
    if (!entry || typeof entry !== "object") return false;
    if ((entry.matcher ?? "") !== expectedEntry.matcher) return false;
    const expectedHook = expectedEntry.hooks[0];
    if (!expectedHook || !this.entryContainsCommand(entry, expectedHook.command)) return false;
    const matchingHook = (Array.isArray(entry.hooks) ? entry.hooks : []).find((hook) =>
      this.normalizeCommand(hook.command).includes(this.normalizeCommand(expectedHook.command)),
    );
    return matchingHook?.additionalContextLimit === expectedHook.additionalContextLimit;
  }

  private isManagedContextModeEntry(hookName: string, entry: HookEntry): boolean {
    return this.isDefaultHookEntry(hookName, entry)
      || this.isOptionalHookEntry(hookName, entry)
      || this.isLegacyHookEntry(hookName, entry);
  }

  private isDefaultHookEntry(hookName: string, entry: HookEntry): boolean {
    const command = DEFAULT_HOOK_COMMANDS[hookName as keyof typeof DEFAULT_HOOK_COMMANDS];
    const pathSuffixes = MANAGED_HOOK_PATH_SUFFIXES[hookName] ?? [];
    return this.entryContainsCommand(entry, command)
      || (command !== undefined && this.entryContainsContextModePathSuffix(entry, pathSuffixes));
  }

  private isOptionalHookEntry(hookName: string, entry: HookEntry): boolean {
    const commands = OPTIONAL_OBSERVABILITY_HOOK_COMMANDS[
      hookName as keyof typeof OPTIONAL_OBSERVABILITY_HOOK_COMMANDS
    ] ?? [];
    return commands.some((command) => this.entryContainsCommand(entry, command));
  }

  private isLegacyHookEntry(hookName: string, entry: HookEntry): boolean {
    const commands = LEGACY_HOOK_COMMANDS[
      hookName as keyof typeof LEGACY_HOOK_COMMANDS
    ] ?? [];
    const pathSuffixes = MANAGED_HOOK_PATH_SUFFIXES[hookName] ?? [];
    return commands.some((command) => this.entryContainsCommand(entry, command))
      || this.entryContainsContextModePathSuffix(entry, pathSuffixes);
  }

  private collectHookNames(
    hooks: HookRegistration,
    expected: HookRegistration,
    profile: "default" | "optional",
  ): string[] {
    return Object.entries(expected).flatMap(([hookName, expectedEntries]) => {
      const entries = hooks[hookName];
      if (!Array.isArray(entries)) return [];
      const matched = expectedEntries.some((expectedEntry) => entries.some((entry) =>
        this.isExpectedHookEntry(hookName, entry, expectedEntry),
      ));
      return matched ? [`${hookName} (${profile})`] : [];
    });
  }

  private collectLegacyHookNames(hooks: HookRegistration): string[] {
    return ALL_CONTEXT_MODE_HOOK_EVENTS.flatMap((hookName) => {
      const entries = hooks[hookName];
      if (!Array.isArray(entries)) return [];
      const count = entries.filter((entry) => this.isLegacyHookEntry(hookName, entry)).length;
      return count > 0 ? [`${hookName} (${count})`] : [];
    });
  }

  private countConfiguredExpectedEntries(
    hooks: HookRegistration,
    expected: HookRegistration,
  ): number {
    return Object.entries(expected).reduce((count, [hookName, expectedEntries]) => {
      const actualEntries = hooks[hookName];
      if (!Array.isArray(actualEntries)) return count;
      return count + expectedEntries.filter((expectedEntry) => actualEntries.some((entry) =>
        this.isExpectedHookEntry(hookName, entry, expectedEntry),
      )).length;
    }, 0);
  }

  private entryContainsCommand(entry: HookEntry, expectedCommand: string | undefined): boolean {
    if (!entry || typeof entry !== "object" || !expectedCommand) return false;
    const normalizedCommands = (Array.isArray(entry.hooks) ? entry.hooks : [])
      .map((hook) => this.normalizeCommand(hook.command))
      .filter((command) => command.length > 0);
    const normalizedExpected = this.normalizeCommand(expectedCommand);
    return normalizedCommands.some((command) => command.includes(normalizedExpected));
  }

  private entryContainsContextModePathSuffix(entry: HookEntry, suffixes: string[]): boolean {
    if (!entry || typeof entry !== "object") return false;
    const normalizedCommands = (Array.isArray(entry.hooks) ? entry.hooks : [])
      .map((hook) => this.normalizeCommand(hook.command))
      .filter((command) => command.length > 0);
    return normalizedCommands.some((command) =>
      /(^|[^a-z0-9])context-mode([^a-z0-9]|$)/i.test(command)
      && suffixes.some((suffix) => command.includes(suffix)),
    );
  }

  private normalizeCommand(command: string | undefined): string {
    return (command ?? "").replace(/\\/g, "/");
  }

  /**
   * Extract session ID from Codex CLI hook input.
   * Priority: session_id field > fallback to ppid.
   */
  private extractSessionId(input: CodexHookInput): string {
    if (input.session_id) return input.session_id;
    return `pid-${process.ppid}`;
  }
}
