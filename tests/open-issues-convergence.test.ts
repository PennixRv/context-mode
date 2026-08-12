import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { buildBatchNodeOptionsPrefix } from "../src/server.js";

const root = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function codexMatches(matcher: string, toolName: string): boolean {
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) {
    return matcher.split("|").includes(toolName);
  }
  return new RegExp(matcher).test(toolName);
}

describe("root issue convergence contracts", () => {
  test.each([".codex-plugin/hooks.json", "configs/codex/hooks.json"])(
    "Codex execution aliases use one dedicated PreToolUse group in %s",
    (path) => {
      const config = JSON.parse(read(path)) as {
        hooks: { PreToolUse: Array<{ matcher: string }> };
      };
      const groups = config.hooks.PreToolUse.map((entry) => entry.matcher);
      const names = [
        "ctx_execute",
        "mcp__context_mode__ctx_execute",
        "mcp__plugin_context-mode_context-mode__ctx_execute",
      ];
      const selected = names.map((name) => groups.flatMap((matcher, index) =>
        codexMatches(matcher, name) ? [index] : [],
      ));

      expect(selected.every((indexes) => indexes.length === 1)).toBe(true);
      expect(new Set(selected.flat()).size).toBe(1);
    },
  );

  test("the shipped Skill preserves direct structured protocols and CodeGraph precedence", () => {
    const skill = read("skills/context-mode/SKILL.md");
    expect(skill).not.toContain("Default to context-mode for ALL commands");
    expect(skill).not.toContain("Everything else → `ctx_execute`");
    expect(skill).toContain("CodeGraph");
    expect(skill).toContain("Fast Context");
    expect(skill).toContain("Trellis");
    expect(skill).toContain("direct protocol");
  });

  test.each([
    "CLAUDE.md",
    "configs/codex/AGENTS.md",
    "configs/claude-code/CLAUDE.md",
    "configs/gemini-cli/GEMINI.md",
    "configs/qwen-code/QWEN.md",
    "configs/antigravity/GEMINI.md",
    "configs/zed/AGENTS.md",
    "configs/openclaw/AGENTS.md",
    "configs/kilo/AGENTS.md",
    "configs/opencode/AGENTS.md",
    "configs/omp/SYSTEM.md",
    "configs/kiro/KIRO.md",
    "configs/vscode-copilot/copilot-instructions.md",
    "configs/jetbrains-copilot/copilot-instructions.md",
    "configs/cursor/context-mode.mdc",
    "configs/copilot-cli/skills/context-mode/SKILL.md",
    "configs/antigravity-cli/rules/context-mode.md",
    "configs/antigravity-cli/skills/context-mode/SKILL.md",
  ])("release routing asset %s uses the shared protocol and trust contract", (path) => {
    const asset = read(path);
    const normalized = asset.replace(/\s+/g, " ");
    expect(asset).toContain("Protocol passthrough");
    expect(asset).toContain("CodeGraph");
    expect(normalized).toContain("unverified external candidates non-persistent");
    expect(asset).toContain("whole-repository");
  });

  test("Pi's dynamic-routing asset retains the compact protocol boundary", () => {
    const asset = read("configs/pi/AGENTS.md");
    expect(asset).toContain("CodeGraph");
    expect(asset).toContain("unverified external candidates non-persistent");
    expect(asset).toContain("never use `ctx_index`");
  });

  test("execution tools expose explicit non-persistent and verified persistence", () => {
    const server = read("src/server.ts");
    const store = read("src/store.ts");
    expect(server).toContain("ExecutionPersistenceSchema");
    expect(server).toContain('mode: z.literal("none")');
    expect(server).toContain('mode: z.literal("verified")');
    expect(server).not.toContain("Auto-index large error output into FTS5");
    expect(store).toContain("if (provenance) this.#writeSourceProvenance(sourceId, provenance)");
    expect(store.indexOf("if (provenance) this.#writeSourceProvenance(sourceId, provenance)"))
      .toBeLessThan(store.indexOf("const sourceId = transaction();"));
  });

  test("Codex diagnostics and version ordering have shared owners", () => {
    const cli = read("src/cli.ts");
    const server = read("src/server.ts");
    const analytics = read("src/session/analytics.ts");
    expect(read("src/version-channel.ts")).toContain("compareSemanticVersions");
    expect(read("src/adapters/codex/diagnostics.ts")).toContain("CodexPluginDiagnostic");
    expect(cli).not.toContain("localVersion === latestVersion");
    expect(server).not.toContain("function semverNewer");
    expect(analytics).not.toContain("function semverNewer");
  });

  test("archived response measurement discovers Git root and retains bounded stderr", () => {
    const script = read(
      ".trellis/tasks/archive/2026-08/08-10-harden-execution-project-boundary/research/measure-response-sizes.mjs",
    );
    expect(script).toContain("measure-response-sizes.mjs");
    expect(read("scripts/measure-response-sizes.mjs")).toContain("rev-parse");
    expect(read("scripts/measure-response-sizes.mjs")).toContain("stderrTail");
  });

  test("compatibility execute_file no longer applies the component project wall", () => {
    const server = read("src/server.ts");
    const start = server.indexOf('server.registerTool(\n  "ctx_execute_file"');
    const end = server.indexOf("// ─────────────────────────────────────────────────────────\n// Tool: batch", start);
    const handler = server.slice(start, end);
    expect(handler).not.toContain("checkProjectBoundary(");
    expect(read("src/executor.ts")).toContain("maxInputFileBytes");
  });

  test("POSIX batch environment uses a preamble for the complete script", () => {
    const preload = "/tmp/context mode/preload's hook.cjs";
    const preamble = buildBatchNodeOptionsPrefix("/bin/sh", preload);
    expect(preamble).toMatch(/^export NODE_OPTIONS=/);
    expect(preamble.endsWith("\n")).toBe(true);
    expect(`${preamble}for value in a b; do echo "$value"; done`).toContain(
      "\nfor value in a b",
    );
  });

  test("batch result types preserve exit code and failed state", () => {
    const server = read("src/server.ts");
    expect(server).toContain("exitCode: number");
    expect(server).toContain('"completed" | "failed"');
    expect(server).not.toContain('result.timedOut ? "timed_out" : "completed"');
  });
});
