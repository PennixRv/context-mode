import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { CodexAdapter } from "../../src/adapters/codex/index.js";

const DEFAULT_HOOK_EVENTS = [
  "PostCompact",
  "PreCompact",
  "PreToolUse",
  "SessionStart",
];
const RECOVERY_BRIEF_MATCHER =
  "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$";
const CODEX_CTX_EXECUTE_MATCHER =
  "^(mcp__context_mode__ctx_execute|mcp__plugin_context-mode_context-mode__ctx_execute)$";

describe("Codex default external MCP isolation", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  it("registers only the low-noise default hook events", () => {
    const config = adapter.generateHookConfig("/some/plugin/root");

    expect(Object.keys(config).sort()).toEqual(DEFAULT_HOOK_EVENTS);
    expect(config).not.toHaveProperty("PostToolUse");
    expect(config).not.toHaveProperty("UserPromptSubmit");
    expect(config).not.toHaveProperty("Stop");
  });

  it("matches only owned Codex ctx_execute MCP forms while retaining bare ctx tools", () => {
    const config = adapter.generateHookConfig("/some/plugin/root");
    const matcher = config.PreToolUse?.[0]?.matcher ?? "";
    const ownedMcpMatcher = config.PreToolUse?.[2]?.matcher ?? "";

    expect(matcher).toContain("ctx_execute");
    expect(matcher).toContain("ctx_search");
    expect(config.PreToolUse?.map((entry) => entry.matcher)).toEqual([
      matcher,
      RECOVERY_BRIEF_MATCHER,
      CODEX_CTX_EXECUTE_MATCHER,
    ]);
    const matcherPattern = new RegExp(ownedMcpMatcher);
    expect(matcherPattern.test("mcp__context_mode__ctx_execute")).toBe(true);
    expect(matcherPattern.test("mcp__plugin_context-mode_context-mode__ctx_execute")).toBe(true);
    expect(matcherPattern.test("mcp__other__ctx_execute")).toBe(false);
  });

  it("ships the same low-noise static profile in both Codex manifests", () => {
    const manifestPaths = [
      resolve(__dirname, "..", "..", ".codex-plugin", "hooks.json"),
      resolve(__dirname, "..", "..", "configs", "codex", "hooks.json"),
    ];

    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        hooks: Record<string, Array<{ matcher?: string }>>;
      };

      expect(Object.keys(manifest.hooks).sort()).toEqual(DEFAULT_HOOK_EVENTS);
      const preToolMatchers = manifest.hooks.PreToolUse?.map((entry) => entry.matcher) ?? [];
      expect(preToolMatchers).toEqual([
        expect.stringContaining("ctx_execute"),
        RECOVERY_BRIEF_MATCHER,
        CODEX_CTX_EXECUTE_MATCHER,
      ]);
      expect(preToolMatchers[1]).not.toMatch(/mcp__\*|mcp__\|/);
      expect(preToolMatchers[1]).not.toContain("ctx_recovery_brief_init");
      expect(preToolMatchers[2]).toContain("mcp__context_mode__ctx_execute");
      expect(preToolMatchers[2]).not.toContain("mcp__other");
      expect(preToolMatchers[2]).not.toMatch(/mcp__\*|mcp__\|/);
      expect(manifest.hooks).not.toHaveProperty("PostToolUse");
      expect(manifest.hooks).not.toHaveProperty("UserPromptSubmit");
      expect(manifest.hooks).not.toHaveProperty("Stop");
      expect(manifest.hooks).not.toHaveProperty("Agent");
    }
  });
});
