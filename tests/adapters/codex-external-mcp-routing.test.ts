/**
 * External MCP routing — Codex slice (#529 follow-up).
 *
 * PR #532 added the `mcp__(?!plugin_context-mode_)` PreToolUse matcher for
 * Claude Code so external MCP servers (slack, telegram, gdrive, notion …)
 * trigger the context-guidance nudge before their large payloads spill into
 * context. This slice extends the same protection to Codex CLI.
 *
 * Codex MCP wire shape: `mcp__<server>__<tool>`. The hook body filters
 * Context Mode's own server after the broad MCP matcher reaches it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CodexAdapter } from "../../src/adapters/codex/index.js";
import { EXTERNAL_MCP_MATCHER_PATTERN } from "../../src/adapters/codex/hooks.js";

describe("CodexAdapter — external MCP routing (#529)", () => {
  let adapter: CodexAdapter;
  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  it("exports EXTERNAL_MCP_MATCHER_PATTERN constant", () => {
    expect(typeof EXTERNAL_MCP_MATCHER_PATTERN).toBe("string");
    expect(EXTERNAL_MCP_MATCHER_PATTERN.length).toBeGreaterThan(0);
  });

  it("matches namespaced MCP tools with a Codex-supported regex", () => {
    const matcher = new RegExp(EXTERNAL_MCP_MATCHER_PATTERN);
    expect(EXTERNAL_MCP_MATCHER_PATTERN).toBe("mcp__.*");
    expect(matcher.test("mcp__slack__list_channels")).toBe(true);
    expect(matcher.test("mcp__context_mode__ctx_search")).toBe(true);
    const fullMatcher = new RegExp(adapter.generateHookConfig("/plugin-root").PreToolUse[0].matcher);
    expect(fullMatcher.test("read_file")).toBe(true);
    expect(fullMatcher.test("grep_files")).toBe(true);
    expect(fullMatcher.test("container.exec")).toBe(true);
    expect(matcher.test("local_shell")).toBe(false);
    expect(matcher.test("Bash")).toBe(false);
  });

  it("generateHookConfig PreToolUse matcher includes the external MCP pattern", () => {
    const config = adapter.generateHookConfig("/some/plugin/root") as Record<
      string,
      Array<{ matcher: string }>
    >;
    const preToolUseMatcher = config.PreToolUse?.[0]?.matcher ?? "";
    expect(preToolUseMatcher).toContain(EXTERNAL_MCP_MATCHER_PATTERN);
  });

  it("configs/codex/hooks.json PreToolUse matcher contains EXTERNAL_MCP_MATCHER_PATTERN", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const path = resolve(__dirname, "..", "..", "configs", "codex", "hooks.json");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const matcher = parsed.hooks.PreToolUse[0]?.matcher ?? "";
    expect(matcher).toContain(EXTERNAL_MCP_MATCHER_PATTERN);
  });
});
