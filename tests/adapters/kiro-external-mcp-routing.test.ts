import { describe, it, expect, beforeEach } from "vitest";
import { KiroAdapter } from "../../src/adapters/kiro/index.js";
import { PRE_TOOL_USE_MATCHER_PATTERN } from "../../src/adapters/kiro/hooks.js";

describe("KiroAdapter — external MCP isolation", () => {
  let adapter: KiroAdapter;

  beforeEach(() => {
    adapter = new KiroAdapter();
  });

  it("does not register an external MCP catch-all", () => {
    expect(PRE_TOOL_USE_MATCHER_PATTERN).not.toContain("@(?!context-mode/)");
    expect(PRE_TOOL_USE_MATCHER_PATTERN).toContain("@context-mode/ctx_execute");
  });

  it("generated preToolUse matcher excludes external MCP", () => {
    const config = adapter.generateHookConfig("/some/plugin/root") as Record<
      string,
      Array<{ matcher?: string }>
    >;
    const matcher = config.preToolUse?.[0]?.matcher ?? "";
    expect(matcher).not.toContain("@(?!context-mode/)");
    expect(matcher).toContain("@context-mode/ctx_execute");
  });

  it("external Kiro MCP calls pass through without context-mode guidance", async () => {
    const { routePreToolUse, resetGuidanceThrottle } = await import(
      "../../hooks/core/routing.mjs",
    );
    resetGuidanceThrottle();
    expect(routePreToolUse("@slack/post_message", {})).toBeNull();
  });

  it("context-mode Kiro MCP calls remain distinct from external MCP", async () => {
    const { routePreToolUse, resetGuidanceThrottle } = await import(
      "../../hooks/core/routing.mjs",
    );
    resetGuidanceThrottle();
    const result = routePreToolUse(
      "@context-mode/ctx_execute",
      { language: "javascript", code: "1+1" },
    );
    if (result !== null) {
      expect(result.additionalContext ?? "").not.toContain("External MCP tools");
    }
  });
});
