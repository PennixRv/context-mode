import "../setup-home";
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodexAdapter, parseCodexContextModePluginRoot, probeCodexCliVersion } from "../../src/adapters/codex/index.js";
import { resolveSessionDbPath } from "../../src/session/db.js";

function writeCodexPluginManifest(pluginRoot: string): void {
  const pluginDir = join(pluginRoot, ".codex-plugin");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "hooks.json"), JSON.stringify({
    hooks: new CodexAdapter().generateHookConfig(pluginRoot),
  }, null, 2), "utf-8");
}

function writeCodexPluginReleaseIdentity(pluginRoot: string, version: string): void {
  const pluginDir = join(pluginRoot, ".codex-plugin");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
    name: "context-mode",
    version,
  }, null, 2), "utf-8");
}

function pluginEnabledSettings(
  extra = "",
  pluginId = "context-mode@context-mode",
): string {
  return `[features]
hooks = true

[plugins."${pluginId}"]
enabled = true

${extra}`;
}

function pluginListOutput(
  pluginRoot: string,
  marketplace = "context-mode",
): string {
  return `Marketplace \`${marketplace}\`
/Users/test/.codex/.tmp/marketplaces/${marketplace}/.agents/plugins/marketplace.json

PLUGIN                    STATUS              VERSION  PATH
context-mode@${marketplace}  installed, enabled  1.0.162  ${pluginRoot}
`;
}

function adapterWithCodexPluginRoot(
  pluginRoot: string,
  marketplace = "context-mode",
): CodexAdapter {
  return new CodexAdapter({
    codexPluginListRunner: () => pluginListOutput(pluginRoot, marketplace),
  });
}

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter({
      codexPluginListRunner: () => {
        throw new Error("codex plugin list unavailable in unit tests");
      },
    });
  });

  // ── Capabilities ──────────────────────────────────────

  describe("capabilities", () => {
    it("preToolUse is true", () => {
      expect(adapter.capabilities.preToolUse).toBe(true);
    });

    it("postToolUse is true", () => {
      expect(adapter.capabilities.postToolUse).toBe(true);
    });

    it("sessionStart is true", () => {
      expect(adapter.capabilities.sessionStart).toBe(true);
    });

    it("preCompact is true", () => {
      expect(adapter.capabilities.preCompact).toBe(true);
    });

    it("canModifyArgs is false (Codex does not support updatedInput)", () => {
      expect(adapter.capabilities.canModifyArgs).toBe(false);
    });

    it("canModifyOutput is false (Codex does not support updatedMCPToolOutput)", () => {
      expect(adapter.capabilities.canModifyOutput).toBe(false);
    });

    it("canInjectSessionContext is true", () => {
      expect(adapter.capabilities.canInjectSessionContext).toBe(true);
    });

    it("paradigm is json-stdio", () => {
      expect(adapter.paradigm).toBe("json-stdio");
    });
  });

  // ── parsePreToolUseInput ──────────────────────────────

  describe("parsePreToolUseInput", () => {
    it("extracts tool_name from input", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "s1",
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.toolName).toBe("Bash");
    });

    it("extracts session_id", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "codex-123",
        cwd: "/proj",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.sessionId).toBe("codex-123");
    });

    it("extracts projectDir from cwd", () => {
      const event = adapter.parsePreToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        session_id: "s1",
        cwd: "/my/project",
        hook_event_name: "PreToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.projectDir).toBe("/my/project");
    });

    it("falls back to CODEX_PROJECT_DIR when cwd missing", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      process.env.CODEX_PROJECT_DIR = "/env/project";
      try {
        const event = adapter.parsePreToolUseInput({
          tool_name: "Bash",
          tool_input: { command: "ls" },
          session_id: "s1",
          hook_event_name: "PreToolUse",
        });
        expect(event.projectDir).toBe("/env/project");
      } finally {
        if (savedCwd === undefined) delete process.env.CODEX_PROJECT_DIR;
        else process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });

    it("falls back to process.cwd() when cwd and env both missing", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      delete process.env.CODEX_PROJECT_DIR;
      try {
        const event = adapter.parsePreToolUseInput({
          tool_name: "Bash",
          tool_input: { command: "ls" },
          session_id: "s1",
          hook_event_name: "PreToolUse",
        });
        expect(event.projectDir).toBe(process.cwd());
      } finally {
        if (savedCwd !== undefined) process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });

    it("post/precompact/sessionstart parsers also fall back to process.cwd()", () => {
      const savedCwd = process.env.CODEX_PROJECT_DIR;
      delete process.env.CODEX_PROJECT_DIR;
      try {
        const post = adapter.parsePostToolUseInput({ tool_name: "Bash" });
        expect(post.projectDir).toBe(process.cwd());

        const compact = adapter.parsePreCompactInput({ session_id: "s1" });
        expect(compact.projectDir).toBe(process.cwd());

        const start = adapter.parseSessionStartInput({ session_id: "s1" });
        expect(start.projectDir).toBe(process.cwd());
      } finally {
        if (savedCwd !== undefined) process.env.CODEX_PROJECT_DIR = savedCwd;
      }
    });
  });

  // ── formatPreToolUseResponse ──────────────────────────

  describe("formatPreToolUseResponse", () => {
    it("deny returns hookSpecificOutput with hookEventName and permissionDecision deny", () => {
      const resp = adapter.formatPreToolUseResponse({
        decision: "deny",
        reason: "blocked",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("PreToolUse");
      expect(hso.permissionDecision).toBe("deny");
      expect(hso.permissionDecisionReason).toBe("blocked");
    });

    it("allow returns empty object (passthrough)", () => {
      const resp = adapter.formatPreToolUseResponse({ decision: "allow" });
      expect(resp).toEqual({});
    });
  });

  // ── parsePostToolUseInput ─────────────────────────────

  describe("parsePostToolUseInput", () => {
    it("extracts tool_response", () => {
      const event = adapter.parsePostToolUseInput({
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_response: "hi\n",
        session_id: "s1",
        cwd: "/tmp",
        hook_event_name: "PostToolUse",
        model: "o3",
        permission_mode: "default",
        tool_use_id: "tu1",
        transcript_path: null,
        turn_id: "t1",
      });
      expect(event.toolOutput).toBe("hi\n");
    });
  });

  // ── formatPostToolUseResponse ─────────────────────────

  describe("formatPostToolUseResponse", () => {
    it("context injection returns hookEventName and additionalContext in hookSpecificOutput", () => {
      const resp = adapter.formatPostToolUseResponse({
        additionalContext: "extra info",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("PostToolUse");
      expect(hso.additionalContext).toBe("extra info");
    });
  });

  // ── parseSessionStartInput ────────────────────────────

  describe("parseSessionStartInput", () => {
    it("extracts source field", () => {
      const event = adapter.parseSessionStartInput({
        session_id: "s1",
        cwd: "/proj",
        hook_event_name: "SessionStart",
        model: "o3",
        permission_mode: "default",
        source: "startup",
        transcript_path: null,
      });
      expect(event.source).toBe("startup");
    });

    it("extracts session_id", () => {
      const event = adapter.parseSessionStartInput({
        session_id: "codex-456",
        cwd: "/proj",
        hook_event_name: "SessionStart",
        model: "o3",
        permission_mode: "default",
        source: "resume",
        transcript_path: null,
      });
      expect(event.sessionId).toBe("codex-456");
    });
  });

  // ── formatSessionStartResponse ──────────────────────

  describe("formatSessionStartResponse", () => {
    it("context returns hookEventName and additionalContext in hookSpecificOutput", () => {
      const resp = adapter.formatSessionStartResponse({
        context: "routing block",
      });
      const hso = (resp as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
      expect(hso.hookEventName).toBe("SessionStart");
      expect(hso.additionalContext).toBe("routing block");
    });

    it("empty context returns empty object", () => {
      const resp = adapter.formatSessionStartResponse({});
      expect(resp).toEqual({});
    });
  });

  // ── Config paths ──────────────────────────────────────

  describe("config paths", () => {
    it("settings path ends with config.toml", () => {
      expect(adapter.getSettingsPath()).toContain("config.toml");
    });

    it("session dir is under ~/.codex/context-mode/sessions/", () => {
      expect(adapter.getSessionDir()).toContain(".codex");
      expect(adapter.getSessionDir()).toContain("sessions");
    });

    it("honors CODEX_HOME for settings, hooks, and session paths", () => {
      const savedCodexHome = process.env.CODEX_HOME;
      const codexHome = join(homedir(), "custom-codex-home");
      process.env.CODEX_HOME = codexHome;

      try {
        const customAdapter = new CodexAdapter({
          codexPluginListRunner: () => {
            throw new Error("codex plugin list unavailable in unit tests");
          },
        });
        expect(customAdapter.getSettingsPath()).toBe(join(codexHome, "config.toml"));
        expect(customAdapter.getHooksPath()).toBe(join(codexHome, "hooks.json"));
        expect(customAdapter.getSessionDir()).toBe(join(codexHome, "context-mode", "sessions"));
      } finally {
        if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = savedCodexHome;
        rmSync(codexHome, { recursive: true, force: true });
      }
    });
  });

  // ── Version diagnostics ───────────────────────────────

  describe("version diagnostics", () => {
    it("reports standalone MCP mode instead of a missing platform plugin", () => {
      expect(adapter.getInstalledVersion()).toBe("standalone");
    });

    it("trims Codex CLI version probe output", () => {
      expect(probeCodexCliVersion(() => "codex-cli 0.132.0\n")).toBe("codex-cli 0.132.0");
    });

    it("returns null when the Codex CLI version probe fails", () => {
      expect(probeCodexCliVersion(() => {
        throw new Error("ENOENT");
      })).toBeNull();
    });

    it("parses the context-mode runtime root from `codex plugin list` output", () => {
      const pluginRoot = join(homedir(), ".codex", ".tmp", "marketplaces", "context-mode");
      expect(parseCodexContextModePluginRoot(pluginListOutput(pluginRoot))).toBe(pluginRoot);
    });

    it("parses the offline marketplace context-mode runtime root", () => {
      const pluginRoot = join(homedir(), ".codex", "plugins", "cache", "context-mode-offline", "context-mode", "1.0.179");
      expect(parseCodexContextModePluginRoot(pluginListOutput(pluginRoot, "context-mode-offline"))).toBe(pluginRoot);
    });

    it("returns null when context-mode is not installed in `codex plugin list` output", () => {
      expect(parseCodexContextModePluginRoot("browser@openai-bundled installed, enabled 0.1 /tmp/browser")).toBeNull();
    });

    it("surfaces Codex CLI binary availability in diagnostics", () => {
      const checks = adapter.validateHooks("");
      expect(checks.some((result) => result.check === "Codex CLI binary")).toBe(true);
    });
  });

  // ── generateHookConfig ────────────────────────────────

  describe("generateHookConfig", () => {
    it("generates only the static low-noise default hook profile", () => {
      const config = adapter.generateHookConfig("/path/to/plugin");
      expect(config).toHaveProperty("PreToolUse");
      expect(config).toHaveProperty("PreCompact");
      expect(config).toHaveProperty("PostCompact");
      expect(config).toHaveProperty("SessionStart");
      expect(Object.keys(config).sort()).toEqual([
        "PostCompact",
        "PreCompact",
        "PreToolUse",
        "SessionStart",
      ]);
      expect(config.PreToolUse[0]?.matcher).toContain("apply_patch");
      expect(config.PreToolUse[0]?.matcher).toContain("Edit");
      expect(config.PreToolUse[0]?.matcher).toContain("Write");
      expect(config.PreToolUse[0]?.matcher).not.toContain("ctx_execute");
      expect(config.PreToolUse[2]?.matcher).toContain("ctx_execute");
      expect(config.PreToolUse[2]?.matcher).toContain("ctx_batch_execute");
      expect(config.PreToolUse[0]?.matcher).not.toMatch(/(^|\|)Read(\||$)/);
      expect(config.PreToolUse[2]?.matcher).toContain("mcp__context_mode__ctx_execute");
      expect(config.PreCompact[0]?.matcher).toBe("^(manual|auto)$");
      expect(config.PreCompact[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointprecompact");
      expect(config.PostCompact[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointpostcompact");
      expect(config.SessionStart).toHaveLength(1);
      expect(config.SessionStart[0]?.matcher).toBe("^compact$");
      expect(config.SessionStart[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointsessionstart");
      expect(config.SessionStart[0]?.hooks[0]?.additionalContextLimit).toBe(1500);
      expect(config).not.toHaveProperty("PostToolUse");
      expect(config).not.toHaveProperty("UserPromptSubmit");
      expect(config).not.toHaveProperty("Stop");
    });
  });

  describe("configureAllHooks", () => {
    const hooksPath = join(homedir(), ".codex", "hooks.json");
    const codexDir = join(homedir(), ".codex");

    beforeEach(() => {
      rmSync(codexDir, { recursive: true, force: true });
      mkdirSync(codexDir, { recursive: true });
    });

    it("reports a missing user hook config as optional observability disabled", () => {
      expect(adapter.getObservabilityProfileStatus()).toMatchObject({
        defaultProfile: "unavailable",
        profile: "disabled",
        activeHooks: [],
        optionalHooks: [],
        legacyHooks: [],
      });
    });

    it("reports the plugin-owned default profile when user hooks are absent", () => {
      const pluginRoot = join(codexDir, "offline-plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot, "context-mode-offline");
      writeCodexPluginManifest(pluginRoot);
      writeCodexPluginReleaseIdentity(pluginRoot, "1.0.179");
      writeFileSync(
        join(codexDir, "config.toml"),
        pluginEnabledSettings("", "context-mode@context-mode-offline"),
        "utf-8",
      );

      expect(adapter.getObservabilityProfileStatus(pluginRoot)).toMatchObject({
        defaultProfile: "active",
        profile: "disabled",
        defaultHookSource: pluginRoot,
        activeHooks: [
          "PreToolUse (default)",
          "PreCompact (default)",
          "PostCompact (default)",
          "SessionStart (default)",
        ],
      });
      expect(adapter.checkPluginRegistration()).toMatchObject({
        status: "pass",
      });
      expect(adapter.checkPluginRegistration().message).toContain(
        "context-mode@context-mode-offline plugin enabled at",
      );
      expect(adapter.checkPluginRegistration().message).toContain("required hooks registered");
      expect(adapter.getCodexPluginDiagnostic(pluginRoot)).toMatchObject({
        channel: "codex-marketplace",
        pluginId: "context-mode@context-mode-offline",
        version: "1.0.162",
        enabled: true,
        runtimeRoot: pluginRoot,
        missingHooks: [],
        hooksAvailable: true,
      });
      expect(adapter.getInstalledVersion()).toBe("1.0.179");
    });

    it("separates the loaded Doctor runtime from a missing Plugin-list installation", () => {
      const doctorRoot = join(codexDir, "doctor-cache-root");
      adapter = new CodexAdapter({ codexPluginListRunner: () => "No plugins installed\n" });
      writeCodexPluginManifest(doctorRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      expect(adapter.getCodexPluginDiagnostic(doctorRoot)).toMatchObject({
        enabled: true,
        configuredManifestAvailable: true,
        runtimeRoot: doctorRoot,
        hooksAvailable: true,
        missingHooks: [],
      });
      expect(adapter.getCodexPluginDiagnostic(doctorRoot).checks).toMatchObject({
        installation: { state: "missing" },
        runtimeRoot: { state: "present", value: doctorRoot },
        manifest: { state: "present" },
        hooks: { state: "present" },
        sessionHooksLoaded: { state: "unavailable" },
      });
      expect(adapter.checkPluginRegistration(doctorRoot)).toMatchObject({
        status: "warn",
      });
      expect(adapter.validateHooks(doctorRoot)).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ check: "Codex plugin hooks", status: "fail" }),
      ]));
    });

    it("reports missing hook events from the plugin manager runtime manifest", () => {
      const runtimeRoot = join(codexDir, "incomplete-runtime-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      mkdirSync(join(runtimeRoot, ".codex-plugin"), { recursive: true });
      writeFileSync(join(runtimeRoot, ".codex-plugin", "hooks.json"), JSON.stringify({
        hooks: { PreToolUse: new CodexAdapter().generateHookConfig(runtimeRoot).PreToolUse },
      }), "utf-8");
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const diagnostic = adapter.getCodexPluginDiagnostic(runtimeRoot);
      expect(diagnostic.hooksAvailable).toBe(false);
      expect(diagnostic.missingHooks).toEqual(["PreCompact", "PostCompact", "SessionStart"]);
      expect(adapter.checkPluginRegistration(runtimeRoot)).toMatchObject({ status: "fail" });
      expect(adapter.checkPluginRegistration(runtimeRoot).message).toContain("PostCompact");
      expect(adapter.validateHooks(runtimeRoot)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          check: "Codex plugin hooks",
          status: "fail",
          message: expect.stringContaining("required hook events are missing"),
        }),
      ]));
    });

    it("writes the native Codex hooks file with the scoped PreToolUse matcher", () => {
      const changes = adapter.configureAllHooks("/ignored/plugin/root");
      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;
      };

      expect(changes.some((change) => change.includes("Updated PreToolUse hook"))).toBe(true);
      expect(changes.some((change) => change.includes("Wrote native Codex hooks"))).toBe(true);
      expect(changes.some((change) => change.includes("Enabled Codex hooks feature flag"))).toBe(true);
      expect(written.hooks.PreToolUse[0]?.matcher).not.toContain("ctx_execute");
      expect(written.hooks.PreToolUse[0]?.matcher).not.toMatch(/(^|\|)Read(\||$)/);
      expect(written.hooks.PreToolUse[1]?.matcher).toBe(
        "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$",
      );
      expect(written.hooks.PreToolUse[1]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreToolUse[2]?.matcher).toContain("mcp__context_mode__ctx_execute");
      expect(written.hooks.PreToolUse[2]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreCompact[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointprecompact");
      expect(written.hooks.PostCompact[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointpostcompact");
      expect(written.hooks.SessionStart[0]?.hooks[0]?.additionalContextLimit).toBe(1500);
      expect(written.hooks.PostToolUse).toBeUndefined();
      expect(written.hooks.UserPromptSubmit).toBeUndefined();
      expect(written.hooks.Stop).toBeUndefined();
      expect(readFileSync(join(codexDir, "config.toml"), "utf-8")).toContain("hooks = true");
    });

    it("preserves foreign hook entries while removing legacy context-mode hooks", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "", hooks: [{ type: "command", command: "node /opt/other-plugin/hooks/pretooluse.mjs" }] },
          ],
          SessionStart: [
            { hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] },
            { matcher: "startup|resume", hooks: [{ type: "command", command: "node C:/tools/extra-hook.js" }] },
          ],
        },
      }, null, 2));

      adapter.configureAllHooks("/ignored/plugin/root");

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
      };
      expect(written.hooks.PreToolUse).toHaveLength(4);
      expect(written.hooks.PreToolUse.some((entry) =>
        entry.hooks[0]?.command === "node /opt/other-plugin/hooks/pretooluse.mjs",
      )).toBe(true);
      expect(written.hooks.PreToolUse.some((entry) =>
        entry.matcher?.includes("local_shell|shell|shell_command"),
      )).toBe(true);
      expect(written.hooks.PreToolUse.some((entry) =>
        entry.matcher === "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$",
      )).toBe(true);
      expect(written.hooks.PreToolUse.some((entry) =>
        entry.matcher?.includes("mcp__context_mode__ctx_execute") && entry.matcher.includes("ctx_batch_execute"),
      )).toBe(true);
      expect(written.hooks.SessionStart).toHaveLength(2);
      expect(written.hooks.SessionStart[0]?.hooks[0]?.command).toBe("node C:/tools/extra-hook.js");
      expect(written.hooks.SessionStart[1]?.hooks[0]?.command).toBe("context-mode hook codex checkpointsessionstart");
    });

    it("creates ~/.codex/hooks.json when the parent directory is missing", () => {
      rmSync(codexDir, { recursive: true, force: true });

      adapter.configureAllHooks("/ignored/plugin/root");

      expect(existsSync(hooksPath)).toBe(true);
      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      expect(Object.keys(written.hooks).sort()).toEqual([
        "PostCompact",
        "PreCompact",
        "PreToolUse",
        "SessionStart",
      ]);
    });

    it("backs up malformed hooks.json before replacing it", () => {
      const malformed = "{ invalid json";
      writeFileSync(hooksPath, malformed, "utf-8");

      const changes = adapter.configureAllHooks("/ignored/plugin/root");
      const backupName = readdirSync(codexDir).find((name) =>
        name.startsWith("hooks.json.broken-") && name.endsWith(".bak"),
      );

      expect(backupName).toBeDefined();
      expect(readFileSync(join(codexDir, backupName!), "utf-8")).toBe(malformed);
      expect(changes.some((change) => change.includes("Backed up malformed Codex hooks"))).toBe(true);
      expect(JSON.parse(readFileSync(hooksPath, "utf-8")).hooks.PreCompact).toBeDefined();
    });

    it("does not crash on schema-invalid entries with non-array hooks", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "", hooks: "not-an-array" },
            null,
          ],
        },
      }, null, 2), "utf-8");

      expect(() => adapter.configureAllHooks("/ignored/plugin/root")).not.toThrow();
      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: unknown }>>;
      };
      expect(Array.isArray(written.hooks.PreToolUse)).toBe(true);
    });

    it("does not crash when top-level hooks is not an object", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8");

      expect(() => adapter.configureAllHooks("/ignored/plugin/root")).not.toThrow();
      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, unknown>;
      };
      expect(typeof written.hooks).toBe("object");
      expect(Array.isArray(written.hooks.PreToolUse)).toBe(true);
    });

    it("backs up both hooks.json and config.toml when both exist", () => {
      writeFileSync(hooksPath, JSON.stringify({ hooks: {} }), "utf-8");
      const settingsPath = join(codexDir, "config.toml");
      writeFileSync(settingsPath, "[features]\nhooks = false\n", "utf-8");

      expect(adapter.backupSettings()).toBe(`${hooksPath}.bak`);
      expect(readFileSync(`${hooksPath}.bak`, "utf-8")).toContain('"hooks"');
      expect(readFileSync(`${settingsPath}.bak`, "utf-8")).toContain("hooks = false");
    });

    // ─────────────────────────────────────────────────────
    // Duplicate dedup regression suite (#603)
    //
    // Reported by jowch + skbsasikumar-rgb: after a context-mode upgrade,
    // ~/.codex/hooks.json carries TWO context-mode entries for the same
    // hook event (e.g., a legacy `node /path/.../hooks/codex/pretooluse.mjs`
    // alongside the new `context-mode hook codex pretooluse`). Codex then
    // fires both, doubling work and historically saturating the MCP
    // transport / inflating codex-tui.log. `configureAllHooks` must collapse
    // these to exactly one canonical entry per event.
    // ─────────────────────────────────────────────────────

    it("dedups twin canonical context-mode entries to a single entry (#603)", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "old-matcher-A", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
            { matcher: "old-matcher-B", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
          ],
          SessionStart: [
            { hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] },
            { hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] },
          ],
        },
      }, null, 2));

      const changes = adapter.configureAllHooks("/ignored/plugin/root");

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      expect(written.hooks.PreToolUse).toHaveLength(3);
      expect(written.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreToolUse[1]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreToolUse[2]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0]?.hooks[0]?.command).toBe("context-mode hook codex checkpointsessionstart");
      expect(changes.some((c) => c.includes("Updated SessionStart hook"))).toBe(true);
    });

    it("dedups legacy-direct-node entry coexisting with canonical entry (#603)", () => {
      // Mirrors the exact user-reported pattern: old direct-node hook left
      // behind by an earlier installer + new canonical entry from a later
      // upgrade run.
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "", hooks: [{ type: "command", command: "node /Users/foo/.nvm/versions/node/v20/lib/node_modules/context-mode/hooks/codex/pretooluse.mjs" }] },
            { matcher: "", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
          ],
          PostToolUse: [
            { hooks: [{ type: "command", command: "/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/context-mode/hooks/posttooluse.mjs" }] },
            { hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
          ],
        },
      }, null, 2));

      adapter.configureAllHooks("/ignored/plugin/root");

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      expect(written.hooks.PreToolUse).toHaveLength(3);
      expect(written.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreToolUse[1]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PreToolUse[2]?.hooks[0]?.command).toBe("context-mode hook codex pretooluse");
      expect(written.hooks.PostToolUse).toBeUndefined();
    });

    it("dedups plugin-cache legacy entry left by /ctx-upgrade with canonical entry (#603)", () => {
      // Plugin-cache install layout: ~/.claude/plugins/cache/context-mode/<v>/hooks/codex/<event>.mjs
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "node /Users/foo/.claude/plugins/cache/context-mode/context-mode/1.0.124/hooks/codex/userpromptsubmit.mjs" }] },
            { hooks: [{ type: "command", command: "context-mode hook codex userpromptsubmit" }] },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "/usr/bin/node /Users/foo/.claude/plugins/marketplaces/context-mode/hooks/codex/stop.mjs" }] },
          ],
        },
      }, null, 2));

      adapter.configureAllHooks("/ignored/plugin/root");

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };

      expect(written.hooks.UserPromptSubmit).toBeUndefined();
      expect(written.hooks.Stop).toBeUndefined();
    });

    it("removes context-mode user hooks when the Codex plugin owns hooks", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/homebrew/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js" }] },
            { matcher: "local_shell|shell|ctx_execute|mcp__", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
          ],
          SessionStart: [
            { matcher: "startup|resume", hooks: [{ type: "command", command: "node /opt/homebrew/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js" }] },
            { hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] },
          ],
        },
      }, null, 2), "utf-8");

      const changes = adapter.configureAllHooks(pluginRoot);

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.PreToolUse[0]?.hooks[0]?.command).toContain("oh-my-codex");
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0]?.hooks[0]?.command).toContain("oh-my-codex");
      expect(JSON.stringify(written)).not.toContain("context-mode hook codex");
      expect(changes.some((change) => change.includes("Removed context-mode default and legacy user hooks"))).toBe(true);
    });

    it("keeps native fallback hooks when the running doctor root differs from the Codex plugin manager root", () => {
      const doctorRoot = join(codexDir, "versioned-cache-root");
      const runtimeRoot = join(codexDir, "marketplace-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      writeCodexPluginManifest(doctorRoot);
      writeCodexPluginManifest(runtimeRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/homebrew/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js" }] },
          ],
        },
      }, null, 2), "utf-8");

      const changes = adapter.configureAllHooks(doctorRoot);

      const written = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      expect(written.hooks.PreToolUse).toHaveLength(4);
      expect(written.hooks.PreToolUse.some((entry) =>
        entry.hooks[0]?.command === "context-mode hook codex pretooluse",
      )).toBe(true);
      expect(written.hooks.PostToolUse).toBeUndefined();
      expect(changes.some((change) => change.includes("Removed context-mode default and legacy user hooks"))).toBe(false);
      expect(changes).toContain("Wrote native Codex hooks to " + hooksPath);
    });

    it("removes standalone MCP registration and stale user-hook trust state in plugin mode", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      const stateHooksPath = hooksPath.replace(/\//g, "\\");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/homebrew/lib/node_modules/oh-my-codex/dist/scripts/codex-native-hook.js" }] },
          ],
        },
      }, null, 2), "utf-8");
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(`
[mcp_servers.context-mode]
command = "npx"
args = ["-y", "context-mode"]

[mcp_servers.context-mode.tools.ctx_execute]
approval_mode = "approve"

[hooks.state."${stateHooksPath}:pre_tool_use:0:0"]
trusted_hash = "sha256:live"

[hooks.state."${stateHooksPath}:pre_tool_use:1:0"]
trusted_hash = "sha256:stale"
`), "utf-8");

      const changes = adapter.configureAllHooks(pluginRoot);

      const settings = readFileSync(join(codexDir, "config.toml"), "utf-8");
      expect(settings).not.toContain("[mcp_servers.context-mode]");
      expect(settings).not.toContain("[mcp_servers.context-mode.tools.ctx_execute]");
      expect(settings).toContain(`${stateHooksPath}:pre_tool_use:0:0`);
      expect(settings).not.toContain(`${stateHooksPath}:pre_tool_use:1:0`);
      expect(changes).toContain("Removed standalone Codex context-mode MCP registration");
      expect(changes.some((change) => change.includes("stale Codex hook trust"))).toBe(true);
    });
  });

  describe("optional observability profile", () => {
    const hooksPath = join(homedir(), ".codex", "hooks.json");
    const codexDir = join(homedir(), ".codex");

    beforeEach(() => {
      rmSync(codexDir, { recursive: true, force: true });
      mkdirSync(codexDir, { recursive: true });
    });

    it("enables observability without retaining legacy hooks or touching foreign hooks", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/other-plugin/hook.mjs" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
          ],
        },
      }, null, 2), "utf-8");

      const changes = adapter.enableObservabilityProfile();
      const written = readFileSync(hooksPath, "utf-8");

      expect(written).toContain("node /opt/other-plugin/hook.mjs");
      expect(written).not.toContain("context-mode hook codex posttooluse");
      expect(written).toContain("context-mode hook codex observabilityposttooluse");
      expect(written).toContain("context-mode hook codex observabilitystop");
      expect(written).not.toContain("mcp__");
      expect(readFileSync(join(codexDir, "config.toml"), "utf-8")).toContain("hooks = true");
      expect(changes.some((change) => change.includes("hook-panel entries and local state writes"))).toBe(true);
    });

    it("disables only optional observability hooks", () => {
      adapter.configureAllHooks("/ignored/plugin/root");
      adapter.enableObservabilityProfile();
      const config = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;
      };
      config.hooks.PostToolUse ??= [];
      config.hooks.PostToolUse.push(
        { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/other-plugin/hook.mjs" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
      );
      writeFileSync(hooksPath, JSON.stringify(config, null, 2), "utf-8");

      adapter.disableObservabilityProfile();

      const written = readFileSync(hooksPath, "utf-8");
      expect(written).toContain("context-mode hook codex checkpointsessionstart");
      expect(written).toContain("node /opt/other-plugin/hook.mjs");
      expect(written).toContain("context-mode hook codex posttooluse");
      expect(written).not.toContain("context-mode hook codex observability");
    });

    it("reports disabled, enabled, partial, and legacy profile states", () => {
      adapter.configureAllHooks("/ignored/plugin/root");
      expect(adapter.getObservabilityProfileStatus().profile).toBe("disabled");

      adapter.enableObservabilityProfile();
      expect(adapter.getObservabilityProfileStatus().profile).toBe("enabled");

      const config = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      config.hooks.Stop = [];
      config.hooks.PostToolUse = [config.hooks.PostToolUse?.[0]!];
      writeFileSync(hooksPath, JSON.stringify(config, null, 2), "utf-8");

      expect(adapter.getObservabilityProfileStatus().profile).toBe("partial");

      config.hooks.PostToolUse.push({
        hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }],
      });
      writeFileSync(hooksPath, JSON.stringify(config, null, 2), "utf-8");

      expect(adapter.getObservabilityProfileStatus().legacyHooks).toContain("PostToolUse (1)");
    });

    it("keeps explicit observability hooks when plugin ownership removes defaults", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/other-plugin/hook.mjs" }] },
          ],
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "context-mode hook codex observabilityposttooluse" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "node /opt/other-plugin/hook.mjs" }] },
          ],
        },
      }, null, 2), "utf-8");

      adapter.configureAllHooks(pluginRoot);

      const written = readFileSync(hooksPath, "utf-8");
      expect(written).not.toContain("context-mode hook codex pretooluse");
      expect(written).not.toContain("context-mode hook codex posttooluse");
      expect(written).toContain("context-mode hook codex observabilityposttooluse");
      expect(written).toContain("node /opt/other-plugin/hook.mjs");
    });

    it("reports enabled observability and legacy registrations through doctor", () => {
      adapter.configureAllHooks("/ignored/plugin/root");
      adapter.enableObservabilityProfile();
      const config = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
      };
      config.hooks.PostToolUse.push({
        hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }],
      });
      writeFileSync(hooksPath, JSON.stringify(config, null, 2), "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");
      const observability = results.find((result) =>
        result.check === "Codex optional observability capability",
      );
      const legacy = results.find((result) =>
        result.check === "Codex legacy hook registrations",
      );

      expect(observability?.status).toBe("warn");
      expect(observability?.message).toMatch(/hook-panel entries and local state writes/);
      expect(legacy?.status).toBe("warn");
      expect(legacy?.fix).toBe("context-mode upgrade");
    });
  });

  describe("validateHooks", () => {
    const hooksPath = join(homedir(), ".codex", "hooks.json");
    const codexDir = join(homedir(), ".codex");

    beforeEach(() => {
      rmSync(codexDir, { recursive: true, force: true });
      mkdirSync(codexDir, { recursive: true });
    });

    it("fails when hooks.json is missing", () => {
      const results = adapter.validateHooks("/ignored/plugin/root");
      expect(results.some((result) => result.status === "fail" && result.check === "Hooks config")).toBe(true);
      expect(results.some((result) => result.check === "Codex hooks feature flag")).toBe(true);
      expect(results.find((result) => result.check === "Codex hook profile")?.status).toBe("warn");
    });

    it("passes when all required Codex hooks are configured", () => {
      adapter.configureAllHooks("/ignored/plugin/root");
      const results = adapter.validateHooks("/ignored/plugin/root");
      // The "Codex CLI binary" check is a runtime environment probe added
      // by PR #686 — it shells out to `codex --version` and reports `warn`
      // when the binary is absent (e.g. CI runners without Codex installed).
      // That probe is orthogonal to the hook-config validation this test is
      // pinning, so exclude it from the all-pass assertion. Probe-specific
      // behaviour (pass/warn shape) is covered separately by the unit tests
      // around probeCodexCliVersion() at L295-299.
      const configChecks = results.filter((r) => r.check !== "Codex CLI binary");
      expect(configChecks.every((result) => result.status === "pass")).toBe(true);
      expect(results.map((result) => result.check)).toContain("PreCompact hook");
      expect(results.map((result) => result.check)).toContain("SessionStart hook");
      expect(results.map((result) => result.check)).toContain("Codex hook profile");
      expect(results.map((result) => result.check)).toContain("Codex optional observability capability");
      expect(results.map((result) => result.check)).toContain("Codex legacy hook registrations");
    });

    it("passes via Codex plugin hooks and warns when user config still has context-mode hooks", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
          ],
        },
      }, null, 2), "utf-8");

      const results = adapter.validateHooks(pluginRoot);

      const preTool = results.find((result) => result.check === "PreToolUse hook");
      expect(preTool?.status).toBe("pass");
      expect(preTool?.message).toMatch(/context-mode@context-mode plugin/);
      const duplicate = results.find((result) => result.check === "PreToolUse plugin duplicate");
      expect(duplicate?.status).toBe("warn");
      expect(duplicate?.message).toMatch(/configured in both/);
      expect(results.some((result) => result.check === "SessionStart hook" && result.status === "pass")).toBe(true);
      expect(results.some((result) => result.check === "Hooks config" && result.status === "fail")).toBe(false);
    });

    it("passes with missing user hooks.json when the Codex plugin owns hooks", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const results = adapter.validateHooks(pluginRoot);

      expect(results.some((result) => result.check === "Hooks config" && result.status === "fail")).toBe(false);
      expect(results.some((result) => result.check === "SessionStart hook" && result.status === "pass")).toBe(true);
    });

    it("does not borrow hooks from the installed cache when the Doctor runtime is stale", () => {
      const staleDoctorRoot = join(codexDir, "unversioned-stale-root");
      const runtimeRoot = join(codexDir, "marketplace-runtime-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      writeCodexPluginManifest(runtimeRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const results = adapter.validateHooks(staleDoctorRoot);

      const root = results.find((result) => result.check === "Codex plugin root");
      expect(root?.status).toBe("warn");
      expect(root?.message).toContain(staleDoctorRoot);
      expect(root?.message).toContain(runtimeRoot);
      expect(results.some((result) =>
        result.check === "Codex plugin hooks"
        && result.status === "fail"
        && result.message.includes(staleDoctorRoot),
      )).toBe(true);
      expect(results.some((result) => result.check === "SessionStart hook" && result.status === "pass")).toBe(false);
    });

    it("accepts matching releases across Codex cache and marketplace roots", () => {
      const doctorRoot = join(codexDir, "versioned-cache-root");
      const runtimeRoot = join(codexDir, "marketplace-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      writeCodexPluginManifest(doctorRoot);
      writeCodexPluginManifest(runtimeRoot);
      writeCodexPluginReleaseIdentity(doctorRoot, "1.0.172");
      writeCodexPluginReleaseIdentity(runtimeRoot, "1.0.172");
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const results = adapter.validateHooks(doctorRoot);

      const root = results.find((result) => result.check === "Codex plugin root");
      expect(root?.status).toBe("pass");
      expect(root?.message).toContain(runtimeRoot);
      expect(root?.message).toContain(doctorRoot);
      expect(results.some((result) => result.check === "Codex plugin hooks" && result.status === "fail")).toBe(false);
    });

    it("warns when Codex cache and marketplace roots resolve to different releases", () => {
      const doctorRoot = join(codexDir, "versioned-cache-root");
      const runtimeRoot = join(codexDir, "marketplace-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      writeCodexPluginManifest(doctorRoot);
      writeCodexPluginManifest(runtimeRoot);
      writeCodexPluginReleaseIdentity(doctorRoot, "1.0.171");
      writeCodexPluginReleaseIdentity(runtimeRoot, "1.0.172");
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const results = adapter.validateHooks(doctorRoot);

      const root = results.find((result) => result.check === "Codex plugin root");
      expect(root?.status).toBe("warn");
      expect(root?.message).toContain(doctorRoot);
      expect(root?.message).toContain(runtimeRoot);
    });

    it("reports a missing installed-cache manifest without invalidating loaded runtime hooks", () => {
      const staleDoctorRoot = join(codexDir, "unversioned-stale-root");
      const runtimeRoot = join(codexDir, "missing-runtime-root");
      adapter = adapterWithCodexPluginRoot(runtimeRoot);
      writeCodexPluginManifest(staleDoctorRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(), "utf-8");

      const results = adapter.validateHooks(staleDoctorRoot);

      const cacheManifest = results.find((result) => result.check === "Codex plugin cache manifest");
      expect(cacheManifest?.status).toBe("fail");
      expect(cacheManifest?.message).toContain(join(runtimeRoot));
      expect(results.some((result) => result.check === "Codex plugin hooks" && result.status === "fail")).toBe(false);
    });

    it("warns when plugin mode still has standalone npx MCP registration", () => {
      const pluginRoot = join(codexDir, "plugin-root");
      adapter = adapterWithCodexPluginRoot(pluginRoot);
      writeCodexPluginManifest(pluginRoot);
      writeFileSync(join(codexDir, "config.toml"), pluginEnabledSettings(`
[mcp_servers.context-mode]
command = "npx"
args = ["-y", "context-mode"]
`), "utf-8");

      const results = adapter.validateHooks(pluginRoot);

      const duplicate = results.find((result) => result.check === "Standalone MCP duplicate");
      expect(duplicate?.status).toBe("warn");
      expect(duplicate?.fix).toMatch(/context-mode upgrade/);
    });

    it("warns instead of failing when only PreCompact is missing", () => {
      const hooks = adapter.generateHookConfig("/ignored/plugin/root");
      delete (hooks as Partial<typeof hooks>).PreCompact;
      writeFileSync(hooksPath, JSON.stringify({ hooks }, null, 2), "utf-8");
      writeFileSync(join(codexDir, "config.toml"), "[features]\nhooks = true\n", "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");
      const precompact = results.find((result) => result.check === "PreCompact hook");
      expect(precompact?.status).toBe("warn");
      expect(results.filter((result) => result.status === "fail")).toHaveLength(0);
    });

    it("fails when hooks.json is malformed JSON", () => {
      writeFileSync(hooksPath, "{ invalid json", "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");

      expect(results.some((result) => result.status === "fail" && result.message.includes("not valid JSON"))).toBe(true);
    });

    it("warns when duplicate context-mode entries exist for the same hook event (#603)", () => {
      // Mirrors the user-reported scenario: hooks.json carries two
      // context-mode entries for the same event after a partial upgrade.
      // Doctor should surface this so the user knows to run upgrade.
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
            { matcher: "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$", hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] },
          ],
          PostToolUse: [
            { hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
            { hooks: [{ type: "command", command: "context-mode hook codex posttooluse" }] },
          ],
          SessionStart: [
            { matcher: "^compact$", hooks: [{ type: "command", command: "context-mode hook codex sessionstart" }] },
          ],
          PreCompact: [
            { matcher: "^(manual|auto)$", hooks: [{ type: "command", command: "context-mode hook codex precompact" }] },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "context-mode hook codex userpromptsubmit" }] },
          ],
          Stop: [
            { hooks: [{ type: "command", command: "context-mode hook codex stop" }] },
          ],
        },
      }, null, 2), "utf-8");
      writeFileSync(join(codexDir, "config.toml"), "[features]\nhooks = true\n", "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");

      const preToolDup = results.find((r) => r.check === "PreToolUse duplicates");
      expect(preToolDup?.status).toBe("warn");
      expect(preToolDup?.message).toMatch(/Duplicate context-mode hook codex pretooluse entries.*PreToolUse/);
      expect(preToolDup?.fix).toMatch(/context-mode upgrade/);

      const legacy = results.find((r) => r.check === "Codex legacy hook registrations");
      expect(legacy?.status).toBe("warn");
      expect(legacy?.message).toMatch(/PostToolUse \(2\).*context-mode upgrade/);
      expect(legacy?.fix).toBe("context-mode upgrade");

      // Legacy lifecycle entries are surfaced as stale even when there is only
      // one managed entry, because their matcher/command is no longer canonical.
      expect(results.some((r) =>
        r.check === "SessionStart duplicates"
        && /Stale context-mode SessionStart entry/.test(r.message),
      )).toBe(true);
      expect(results.some((r) =>
        r.check === "PreCompact duplicates"
        && /Stale context-mode PreCompact entry/.test(r.message),
      )).toBe(true);
      expect(results.some((r) => r.check === "Stop duplicates")).toBe(false);
    });

    it("fails with a read error message when hooks.json cannot be read", () => {
      mkdirSync(hooksPath, { recursive: true });

      const results = adapter.validateHooks("/ignored/plugin/root");

      expect(results.some((result) => result.status === "fail" && result.message.includes("Could not read"))).toBe(true);
    });

    it("fails when hooks.json entries use an invalid schema", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "", hooks: "not-an-array" },
            null,
          ],
        },
      }, null, 2), "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");

      expect(results.some((result) => result.status === "fail")).toBe(true);
      expect(results.some((result) => result.check === "PreToolUse hook")).toBe(true);
    });

    it("fails when top-level hooks uses an invalid schema", () => {
      writeFileSync(hooksPath, JSON.stringify({
        hooks: [],
      }, null, 2), "utf-8");

      const results = adapter.validateHooks("/ignored/plugin/root");

      expect(results.some((result) => result.status === "fail")).toBe(true);
      expect(results.some((result) => result.check === "PreToolUse hook")).toBe(true);
    });
  });
});

// ── Hook script integration tests ──────────────────────
describe("Codex pretooluse hook script", () => {
  it("outputs valid JSON with hookEventName even for passthrough (no routing match)", () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/pretooluse.mjs");
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      session_id: "test-1",
      cwd: "/tmp",
      hook_event_name: "PreToolUse",
      model: "o3",
      permission_mode: "default",
      tool_use_id: "tu1",
      transcript_path: null,
      turn_id: "t1",
    });

    const stdout = execFileSync(process.execPath, [hookScript], {
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });
});

describe("Codex userpromptsubmit hook script", () => {
  it("outputs valid JSON with UserPromptSubmit hookEventName", () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/userpromptsubmit.mjs");
    const input = JSON.stringify({
      session_id: "test-userprompt",
      cwd: "/tmp",
      hook_event_name: "UserPromptSubmit",
      model: "o3",
      permission_mode: "default",
      prompt: "remember this decision",
      transcript_path: null,
      turn_id: "t1",
    });

    const stdout = execFileSync(process.execPath, [hookScript], {
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });
});

describe("Codex stop hook script", () => {
  it("outputs valid JSON and records turn_end without requesting continuation", async () => {
    const hookScript = resolve(__dirname, "../../hooks/codex/stop.mjs");
    const codexHome = mkdtempSync(join(tmpdir(), "context-mode-codex-stop-home-"));
    const projectDir = join(codexHome, "project");
    const sessionId = "test-stop";
    const savedCodexHome = process.env.CODEX_HOME;
    mkdirSync(projectDir, { recursive: true });

    const input = JSON.stringify({
      session_id: sessionId,
      cwd: projectDir,
      hook_event_name: "Stop",
      model: "o3",
      permission_mode: "default",
      last_assistant_message: "done",
      stop_hook_active: false,
      transcript_path: null,
      turn_id: "t1",
    });

    process.env.CODEX_HOME = codexHome;
    try {
      const stdout = execFileSync(process.execPath, [hookScript], {
        input,
        encoding: "utf-8",
        timeout: 10000,
      });

      expect(JSON.parse(stdout.trim())).toEqual({});

      const dbPath = resolveSessionDbPath({
        projectDir,
        sessionsDir: new CodexAdapter().getSessionDir(),
      });
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare(
          "SELECT type, data FROM session_events WHERE type IN ('turn_end', 'session_end')",
        ).all() as Array<{ type: string; data: string }>;

        expect(rows.some((row) => row.type === "turn_end")).toBe(true);
        expect(rows.some((row) => row.type === "session_end")).toBe(false);

        const payload = JSON.parse(rows.find((row) => row.type === "turn_end")?.data ?? "{}");
        expect(payload.stop_hook_active).toBe(false);
        expect(payload.last_assistant_message).toBe("done");
      } finally {
        db.close();
      }
    } finally {
      if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodexHome;
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

// Pins the #492 follow-up invariants:
//   1. configs/codex/hooks.json PreToolUse matcher equals
//      PRE_TOOL_USE_MATCHER_PATTERN in src/adapters/codex/index.ts
//   2. configs/codex/hooks.json routes confirmed checkpoint lifecycle hooks
//      through the dedicated checkpoint dispatch commands
//   3. README.md documents the same matcher (JSON-escaped form)
describe("Codex matcher parity + config integrity", () => {
  const repoRoot = resolve(__dirname, "..", "..");
  const adapterSrcPath = join(repoRoot, "src", "adapters", "codex", "index.ts");
  const hooksConfigPath = join(repoRoot, "configs", "codex", "hooks.json");
  const readmePath = join(repoRoot, "README.md");

  function readMatcherConstant(): string {
    const src = readFileSync(adapterSrcPath, "utf8");
    const m = src.match(/PRE_TOOL_USE_MATCHER_PATTERN\s*=\s*"([^"]+)"/);
    if (!m) throw new Error("PRE_TOOL_USE_MATCHER_PATTERN constant not found in adapter source");
    // TS source uses \\ for a literal backslash. Convert to runtime string
    // value so it can be compared against a parsed JSON string.
    return m[1].replace(/\\\\/g, "\\");
  }

  it("hooks.json PreToolUse matcher equals the adapter constant", () => {
    const constant = readMatcherConstant();
    const parsed = JSON.parse(readFileSync(hooksConfigPath, "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const cfgMatcher = parsed.hooks.PreToolUse[0]?.matcher;
    expect(cfgMatcher).toBe(constant);
  });

  it("hooks.json wires the confirmed checkpoint lifecycle", () => {
    const parsed = JSON.parse(readFileSync(hooksConfigPath, "utf8")) as {
      hooks: {
        PostCompact?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
        PreCompact?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
        SessionStart?: Array<{
          matcher: string;
          hooks: Array<{ type: string; command: string; additionalContextLimit?: number }>;
        }>;
      };
    };
    expect(parsed.hooks.PreCompact).toBeDefined();
    expect(parsed.hooks.PreCompact?.[0]?.matcher).toBe("^(manual|auto)$");
    expect(parsed.hooks.PreCompact?.[0]?.hooks?.[0]?.command).toBe("context-mode hook codex checkpointprecompact");
    expect(parsed.hooks.PostCompact?.[0]?.matcher).toBe("^(manual|auto)$");
    expect(parsed.hooks.PostCompact?.[0]?.hooks?.[0]?.command).toBe("context-mode hook codex checkpointpostcompact");
    expect(parsed.hooks.SessionStart?.[0]?.matcher).toBe("^compact$");
    expect(parsed.hooks.SessionStart?.[0]?.hooks?.[0]?.command).toBe("context-mode hook codex checkpointsessionstart");
    expect(parsed.hooks.SessionStart?.[0]?.hooks?.[0]?.additionalContextLimit).toBe(1500);
  });

  it("README documents the same Codex PreToolUse matcher as the adapter", () => {
    const constant = readMatcherConstant();
    const readme = readFileSync(readmePath, "utf8");
    const blockRe = /"PreToolUse":\s*\[((?:.|\n)*?)\]\s*,/g;
    const documented: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(readme)) !== null) {
      for (const matcher of m[1].matchAll(/"matcher":\s*"([^"]+)"/g)) {
        documented.push(matcher[1].replace(/\\\\/g, "\\"));
      }
    }
    expect(documented).toContain(constant);
  });
});

// #547: Codex CLI uses Rust's `regex` crate which does NOT support look-around
// (?!...). v1.0.124 shipped matchers containing (?!.*context-mode) and
// (?!plugin_context-mode_) — Codex rejects them at boot with
// "look-around not supported", breaking ALL Codex users.
//
// Codex `is_exact_matcher` (refs/platforms/codex/codex-rs/hooks/src/events/common.rs:152)
// short-circuits the regex engine when matcher chars are all
// [A-Za-z0-9_|]. Pinning matchers to that charset avoids the crate's
// limitations entirely. Drift-guard for future regressions.
describe("Codex matcher #547 — is_exact_matcher charset compliance", () => {
  const EXACT_MATCHER_CHARSET = /^[A-Za-z0-9_|]+$/;

  it("Codex default manifests omit external MCP matchers", () => {
    const paths = [
      resolve(__dirname, "..", "..", ".codex-plugin", "hooks.json"),
      resolve(__dirname, "..", "..", "configs", "codex", "hooks.json"),
    ];
    for (const path of paths) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        hooks: { PreToolUse: Array<{ matcher: string }> };
      };
      expect(parsed.hooks.PreToolUse[0]?.matcher).not.toContain("mcp__");
    }
  });

  it("PRE_TOOL_USE_MATCHER_PATTERN (adapter source constant) passes is_exact_matcher charset", () => {
    const path = resolve(__dirname, "..", "..", "src", "adapters", "codex", "index.ts");
    const src = readFileSync(path, "utf8");
    const m = src.match(/PRE_TOOL_USE_MATCHER_PATTERN\s*=\s*"([^"]+)"/);
    if (!m) throw new Error("PRE_TOOL_USE_MATCHER_PATTERN constant not found");
    // TS source uses \\ for a literal backslash. Convert to runtime form.
    const runtimeMatcher = m[1].replace(/\\\\/g, "\\");
    expect(runtimeMatcher).toMatch(EXACT_MATCHER_CHARSET);
  });

  it("configs/codex/hooks.json PreToolUse matcher passes is_exact_matcher charset", () => {
    const path = resolve(__dirname, "..", "..", "configs", "codex", "hooks.json");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const matcher = parsed.hooks.PreToolUse[0]?.matcher ?? "";
    expect(matcher).toMatch(EXACT_MATCHER_CHARSET);
  });

});
