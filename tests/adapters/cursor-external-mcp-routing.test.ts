import { describe, it, expect, beforeEach } from "vitest";
import { CursorAdapter } from "../../src/adapters/cursor/index.js";
import { PRE_TOOL_USE_MATCHER_PATTERN } from "../../src/adapters/cursor/hooks.js";

describe("CursorAdapter — external MCP isolation", () => {
  let adapter: CursorAdapter;

  beforeEach(() => {
    adapter = new CursorAdapter();
  });

  it("does not register an external MCP catch-all", () => {
    expect(PRE_TOOL_USE_MATCHER_PATTERN).not.toContain("MCP:(?!ctx_)");
    expect(PRE_TOOL_USE_MATCHER_PATTERN).toContain("MCP:ctx_execute");
  });

  it("generated preToolUse matcher excludes external MCP", () => {
    const config = adapter.generateHookConfig("/some/plugin/root") as Record<
      string,
      Array<{ matcher?: string }>
    >;
    const matcher = config.preToolUse?.[0]?.matcher ?? "";
    expect(matcher).not.toContain("MCP:(?!ctx_)");
    expect(matcher).toContain("MCP:ctx_execute");
  });

  it("external Cursor MCP calls pass through without context-mode guidance", async () => {
    const { routePreToolUse, resetGuidanceThrottle } = await import(
      "../../hooks/core/routing.mjs",
    );
    resetGuidanceThrottle();
    expect(routePreToolUse("MCP:slack_post_message", {})).toBeNull();
  });

  it("context-mode Cursor MCP calls remain distinct from external MCP", async () => {
    const { routePreToolUse, resetGuidanceThrottle } = await import(
      "../../hooks/core/routing.mjs",
    );
    resetGuidanceThrottle();
    const result = routePreToolUse(
      "MCP:ctx_execute",
      { language: "javascript", code: "1+1" },
    );
    if (result !== null) {
      expect(result.additionalContext ?? "").not.toContain("External MCP tools");
    }
  });
});
