import { describe, it, expect, beforeEach } from "vitest";
import { QwenCodeAdapter } from "../../src/adapters/qwen-code/index.js";

describe("QwenCodeAdapter — external MCP isolation", () => {
  let adapter: QwenCodeAdapter;

  beforeEach(() => {
    adapter = new QwenCodeAdapter();
  });

  it("generated PreToolUse matcher excludes external MCP", () => {
    const config = adapter.generateHookConfig("/some/plugin/root") as Record<
      string,
      Array<{ matcher: string }>
    >;
    const matcher = config.PreToolUse?.[0]?.matcher ?? "";
    expect(matcher).not.toContain("mcp__(?!.*context-mode)");
    expect(matcher).toContain("mcp__plugin_context-mode_context-mode__ctx_execute");
    const postMatcher = config.PostToolUse?.[0]?.matcher ?? "";
    expect(new RegExp(postMatcher).test("mcp__plugin_context-mode-evil__ctx_execute")).toBe(false);
    expect(new RegExp(postMatcher).test("mcp__plugin_context-mode_context-mode__ctx_execute")).toBe(true);
  });
});
