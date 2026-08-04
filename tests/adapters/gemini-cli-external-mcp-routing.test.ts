import { describe, it, expect, beforeEach } from "vitest";
import { GeminiCLIAdapter } from "../../src/adapters/gemini-cli/index.js";

describe("GeminiCLIAdapter — external MCP isolation", () => {
  let adapter: GeminiCLIAdapter;

  beforeEach(() => {
    adapter = new GeminiCLIAdapter();
  });

  it("generated BeforeTool matcher excludes external MCP", () => {
    const config = adapter.generateHookConfig("/some/plugin/root") as Record<
      string,
      Array<{ matcher: string }>
    >;
    const matcher = config.BeforeTool?.[0]?.matcher ?? "";
    expect(matcher).not.toContain("mcp__(?!.*context-mode)");
    expect(matcher).toContain("context-mode|context_mode)__ctx_");
    expect(new RegExp(matcher).test("mcp__context-mode-evil__ctx_execute")).toBe(false);
    expect(new RegExp(matcher).test("mcp__context-mode__ctx_execute")).toBe(true);
  });
});
