import { describe, expect, it } from "vitest";

import {
  parseCodexPluginList,
  projectCodexPluginDiagnostic,
  serializeCodexPluginDiagnostic,
} from "../../src/adapters/codex/diagnostics.js";

const SOURCE_ROOT = "/marketplaces/context-mode";
const CACHE_ROOT = "/cache/context-mode/context-mode/1.0.188";
const RUNTIME_ROOT = "/runtime/context-mode";

describe("Issue 009 Codex Plugin diagnostic projection", () => {
  it("does not infer a missing installation from an empty probe", () => {
    expect(parseCodexPluginList("  \n")).toEqual({
      state: "unavailable",
      reason: "plugin_inventory_output_empty",
    });
    expect(parseCodexPluginList(JSON.stringify({ installed: [], available: [] })))
      .toEqual({ state: "missing", reason: "plugin_not_listed" });
    expect(parseCodexPluginList("No plugins installed"))
      .toEqual({ state: "missing", reason: "plugin_not_listed" });
  });

  it("parses the structured Codex Plugin list contract", () => {
    const parsed = parseCodexPluginList(JSON.stringify({
      installed: [{
        pluginId: "context-mode@context-mode",
        version: "1.0.188",
        installed: true,
        enabled: true,
        marketplaceSource: { sourceType: "local", source: SOURCE_ROOT },
        installedPath: CACHE_ROOT,
      }],
      available: [],
    }));

    expect(parsed).toEqual({
      state: "present",
      pluginId: "context-mode@context-mode",
      version: "1.0.188",
      installed: true,
      enabled: true,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: CACHE_ROOT,
    });
  });

  it("keeps omitted matching-inventory fields unavailable instead of missing", () => {
    const parsed = parseCodexPluginList(JSON.stringify({
      installed: [{
        pluginId: "context-mode@context-mode",
        version: "1.0.188",
        enabled: true,
      }],
      available: [],
    }));
    const diagnostic = projectCodexPluginDiagnostic({
      pluginListState: parsed.state,
      pluginId: parsed.pluginId,
      version: parsed.version,
      installed: parsed.installed,
      enabled: parsed.enabled,
      sourceRoot: parsed.sourceRoot,
      cacheRoot: parsed.cacheRoot,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: null,
      sameRoot: null,
      releaseMatches: null,
      requiredHooks: ["PreToolUse"],
      registeredHooks: ["PreToolUse"],
      sessionHooksLoaded: null,
    });

    expect(diagnostic.checks.installation).toEqual({
      state: "unavailable",
      reason: "plugin_installation_unreported",
    });
    expect(diagnostic.checks.sourceRoot).toEqual({
      state: "unavailable",
      reason: "plugin_source_unreported",
    });
    expect(diagnostic.checks.cacheRoot).toEqual({
      state: "unavailable",
      reason: "plugin_cache_root_unreported",
    });
  });

  it("projects a normal installation without inferring current-session loading", () => {
    const diagnostic = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      version: "1.0.188",
      installed: true,
      enabled: true,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: CACHE_ROOT,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: true,
      sameRoot: false,
      releaseMatches: true,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: ["PreToolUse", "SessionStart"],
      sessionHooksLoaded: null,
    });

    expect(diagnostic.checks).toMatchObject({
      installation: { state: "present" },
      enabled: { state: "present" },
      sourceRoot: { state: "present", value: SOURCE_ROOT },
      cacheRoot: { state: "present", value: CACHE_ROOT },
      cacheManifest: { state: "present" },
      runtimeRoot: { state: "present", value: RUNTIME_ROOT },
      manifest: { state: "present" },
      hooks: { state: "present" },
      sessionHooksLoaded: { state: "unavailable" },
    });
    expect(diagnostic.missingHooks).toEqual([]);

    const serialized = JSON.parse(serializeCodexPluginDiagnostic(diagnostic)) as {
      checks: Record<string, { state: string }>;
    };
    expect(Object.keys(serialized.checks)).toEqual([
      "codex.plugin.identity",
      "codex.plugin.version",
      "codex.plugin.installation",
      "codex.plugin.enabled",
      "codex.plugin.source_root",
      "codex.plugin.cache_root",
      "codex.plugin.cache_manifest",
      "codex.plugin.runtime_root",
      "codex.plugin.runtime_cache_alignment",
      "codex.plugin.runtime_manifest",
      "codex.plugin.runtime_hooks",
      "codex.plugin.session_hooks_loaded",
    ]);
    expect(serialized.checks["codex.plugin.session_hooks_loaded"]?.state).toBe("unavailable");
    expect(diagnostic.checks.runtimeCacheAlignment).toEqual({
      state: "present",
      value: "different_matching_release",
    });
  });

  it("does not turn an unavailable Plugin-list probe into missing installation or hooks", () => {
    const diagnostic = projectCodexPluginDiagnostic({
      pluginListState: "unavailable",
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: null,
      sameRoot: null,
      releaseMatches: null,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: ["PreToolUse", "SessionStart"],
      sessionHooksLoaded: null,
    });

    expect(diagnostic.checks.installation.state).toBe("unavailable");
    expect(diagnostic.checks.enabled.state).toBe("unavailable");
    expect(diagnostic.checks.cacheRoot.state).toBe("unavailable");
    expect(diagnostic.checks.runtimeRoot).toEqual({ state: "present", value: RUNTIME_ROOT });
    expect(diagnostic.checks.manifest.state).toBe("present");
    expect(diagnostic.checks.hooks.state).toBe("present");
    expect(diagnostic.checks.sessionHooksLoaded.state).toBe("unavailable");
    expect(diagnostic.checks.sessionHooksLoaded.reason).toBe(
      "host_session_observation_unavailable",
    );
    expect(diagnostic.missingHooks).toEqual([]);
  });

  it("distinguishes disabled, absent cache, missing manifest, and a missing hook", () => {
    const disabled = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: true,
      enabled: false,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: CACHE_ROOT,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: true,
      sameRoot: false,
      releaseMatches: true,
      requiredHooks: ["PreToolUse"],
      registeredHooks: ["PreToolUse"],
      sessionHooksLoaded: null,
    });
    expect(disabled.checks.enabled.state).toBe("missing");
    expect(disabled.checks.sessionHooksLoaded.state).toBe("not_applicable");

    const uninstalled = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: false,
      enabled: false,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: null,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: false,
      sameRoot: null,
      releaseMatches: null,
      requiredHooks: ["PreToolUse"],
      registeredHooks: ["PreToolUse"],
      sessionHooksLoaded: null,
    });
    expect(uninstalled.checks.installation).toEqual({
      state: "missing",
      value: false,
      reason: "plugin_not_installed",
    });
    expect(uninstalled.checks.cacheManifest.state).toBe("not_applicable");
    expect(uninstalled.checks.sessionHooksLoaded.state).toBe("not_applicable");

    const absentCache = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: true,
      enabled: true,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: null,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: false,
      sameRoot: null,
      releaseMatches: null,
      requiredHooks: ["PreToolUse"],
      registeredHooks: ["PreToolUse"],
      sessionHooksLoaded: null,
    });
    expect(absentCache.checks.cacheRoot).toEqual({
      state: "unavailable",
      reason: "plugin_cache_root_unreported",
    });
    expect(absentCache.checks.cacheManifest).toEqual({
      state: "unavailable",
      reason: "plugin_cache_root_unreported",
    });

    const missingManifest = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: true,
      enabled: true,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: CACHE_ROOT,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: false,
      cacheManifestAvailable: true,
      sameRoot: false,
      releaseMatches: false,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: [],
      sessionHooksLoaded: null,
    });
    expect(missingManifest.checks.manifest.state).toBe("missing");
    expect(missingManifest.checks.hooks.state).toBe("not_applicable");

    const missingHook = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: true,
      enabled: true,
      sourceRoot: SOURCE_ROOT,
      cacheRoot: CACHE_ROOT,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: true,
      sameRoot: false,
      releaseMatches: true,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: ["PreToolUse"],
      sessionHooksLoaded: null,
    });
    expect(missingHook.checks.hooks.state).toBe("missing");
    expect(missingHook.missingHooks).toEqual(["SessionStart"]);
  });

  it("reports a different runtime and cache release as an alignment fault", () => {
    const diagnostic = projectCodexPluginDiagnostic({
      pluginListState: "present",
      pluginId: "context-mode@context-mode",
      installed: true,
      enabled: true,
      cacheRoot: CACHE_ROOT,
      runtimeRoot: RUNTIME_ROOT,
      runtimeManifestAvailable: true,
      cacheManifestAvailable: true,
      sameRoot: false,
      releaseMatches: false,
      requiredHooks: ["PreToolUse"],
      registeredHooks: ["PreToolUse"],
    });

    expect(diagnostic.checks.runtimeCacheAlignment).toEqual({
      state: "missing",
      value: "different_release",
      reason: "runtime_release_mismatch",
    });
  });
});
