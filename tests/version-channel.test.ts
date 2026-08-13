import { describe, expect, test } from "vitest";

import {
  assessVersionRelation,
  channelUsesNpmRegistry,
  compareSemanticVersions,
  inferInstallationChannel,
} from "../src/version-channel.js";
import {
  projectCodexPluginDiagnostic,
} from "../src/adapters/codex/diagnostics.js";

describe("semantic version and installation channels", () => {
  test.each([
    ["1.0.186", "1.0.169", 1],
    ["1.0.186", "1.0.186", 0],
    ["1.0.186", "1.0.187", -1],
    ["1.0.187-rc.1", "1.0.187", -1],
    ["1.0.187-rc.2", "1.0.187-rc.1", 1],
    ["v1.0.187+build.2", "1.0.187+build.1", 0],
  ] as const)("compares %s with %s", (left, right, expected) => {
    expect(compareSemanticVersions(left, right)).toBe(expected);
  });

  test("invalid values are informational, never upgrade or downgrade", () => {
    expect(compareSemanticVersions("standalone", "1.0.187")).toBeNull();
    expect(assessVersionRelation("standalone", "1.0.187")).toBe("uncomparable");
    expect(compareSemanticVersions("1.0.0-01", "1.0.0-1")).toBeNull();
  });

  test("orders valid identifiers beyond Number.MAX_SAFE_INTEGER", () => {
    expect(compareSemanticVersions("9007199254740993.0.0", "9007199254740992.0.0")).toBe(1);
    expect(compareSemanticVersions("1.0.0-9007199254740993", "1.0.0-9007199254740992")).toBe(1);
  });

  test("classifies local-newer, equal, and remote-newer", () => {
    expect(assessVersionRelation("1.0.186", "1.0.169")).toBe("local-newer");
    expect(assessVersionRelation("1.0.186", "1.0.186")).toBe("equal");
    expect(assessVersionRelation("1.0.186", "1.0.187")).toBe("remote-newer");
  });

  test("only npm installations use the npm registry as their update source", () => {
    expect(channelUsesNpmRegistry("npm")).toBe(true);
    expect(channelUsesNpmRegistry("codex-marketplace")).toBe(false);
    expect(channelUsesNpmRegistry("standalone-git")).toBe(false);
  });

  test.each([
    [{ adapterName: "Codex CLI", installedVersion: "1.0.186", packageRoot: "/cache/context-mode", sourceCheckout: false }, "codex-marketplace"],
    [{ adapterName: "Codex CLI", installedVersion: "1.0.186", packageRoot: "/usr/lib/node_modules/context-mode", sourceCheckout: false }, "npm"],
    [{ adapterName: "Codex CLI", installedVersion: "1.0.186", packageRoot: "/src/context-mode", sourceCheckout: true }, "standalone-git"],
    [{ adapterName: "Claude Code", installedVersion: "standalone", packageRoot: "/usr/lib/node_modules/context-mode", sourceCheckout: false }, "npm"],
    [{ adapterName: "Claude Code", installedVersion: "standalone", packageRoot: "/src/context-mode", sourceCheckout: true }, "standalone-git"],
    [{ adapterName: "Unknown", installedVersion: "standalone", packageRoot: "/opt/context-mode", sourceCheckout: false }, "unknown"],
  ] as const)("infers the semantic installation channel", (facts, channel) => {
    expect(inferInstallationChannel(facts)).toBe(channel);
  });
});

describe("Codex plugin diagnostic projection", () => {
  test("marketplace status layers enabled state, runtime root, and hooks", () => {
    expect(projectCodexPluginDiagnostic({
      enabled: true,
      configuredRoot: "/source",
      configuredManifestAvailable: true,
      runtimeRoot: "/cache/1.0.186",
      runtimeManifestAvailable: true,
      sameRoot: false,
      releaseMatches: true,
    })).toMatchObject({
      channel: "codex-marketplace",
      pluginId: null,
      version: null,
      enabled: true,
      configuredRoot: "/source",
      configuredManifestAvailable: true,
      runtimeRoot: "/cache/1.0.186",
      runtimeManifestAvailable: true,
      rootMismatch: true,
      releaseMatches: true,
      hooksAvailable: true,
      ownsHooksForUpgrade: false,
      requiredHooks: [],
      registeredHooks: [],
      missingHooks: [],
    });
    expect(projectCodexPluginDiagnostic({
      enabled: true,
      configuredRoot: "/source",
      configuredManifestAvailable: true,
      runtimeRoot: "/cache/1.0.186",
      runtimeManifestAvailable: true,
      sameRoot: false,
      releaseMatches: true,
    }).checks.runtimeRoot).toEqual({ state: "present", value: "/cache/1.0.186" });
  });

  test("standalone cannot claim plugin-owned hooks without enabled registration", () => {
    expect(projectCodexPluginDiagnostic({
      enabled: false,
      configuredRoot: "/standalone",
      configuredManifestAvailable: true,
      runtimeRoot: null,
      runtimeManifestAvailable: false,
      sameRoot: false,
      releaseMatches: false,
    })).toMatchObject({
      channel: "standalone",
      enabled: false,
      runtimeRoot: null,
      hooksAvailable: false,
      ownsHooksForUpgrade: false,
    });
  });

  test("enabled config cannot borrow hooks from the Doctor root when runtime root is absent", () => {
    expect(projectCodexPluginDiagnostic({
      enabled: true,
      configuredRoot: "/doctor-cache/1.0.186",
      configuredManifestAvailable: true,
      runtimeRoot: null,
      runtimeManifestAvailable: false,
      sameRoot: false,
      releaseMatches: false,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: [],
    })).toMatchObject({
      channel: "codex-marketplace",
      enabled: true,
      runtimeRoot: null,
      hooksAvailable: false,
      missingHooks: [],
      ownsHooksForUpgrade: false,
    });
    expect(projectCodexPluginDiagnostic({
      enabled: true,
      configuredRoot: "/doctor-cache/1.0.186",
      configuredManifestAvailable: true,
      runtimeRoot: null,
      runtimeManifestAvailable: false,
      sameRoot: false,
      releaseMatches: false,
      requiredHooks: ["PreToolUse", "SessionStart"],
      registeredHooks: [],
    }).checks.manifest.state).toBe("unavailable");
  });
});
