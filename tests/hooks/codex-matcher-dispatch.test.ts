import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const cleanup: string[] = [];

function matcherSelects(matcher: string, name: string): boolean {
  return /^[A-Za-z0-9_|]+$/.test(matcher)
    ? matcher.split("|").includes(name)
    : new RegExp(matcher).test(name);
}

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Codex context-mode matcher dispatch", () => {
  const baseNames = [
    "ctx_execute",
    "ctx_execute_file",
    "ctx_batch_execute",
    "ctx_fetch_and_index",
    "ctx_search",
    "ctx_index",
  ];
  const aliases = baseNames.flatMap((name) => [
    name,
    `mcp__context_mode__${name}`,
    `mcp__plugin_context-mode_context-mode__${name}`,
  ]);

  test.each([".codex-plugin/hooks.json", "configs/codex/hooks.json"])(
    "%s has one disjoint PreToolUse group for every supported execution alias",
    (relativePath) => {
      const manifest = JSON.parse(readFileSync(join(root, relativePath), "utf8")) as {
        hooks: { PreToolUse: Array<{ matcher: string }> };
      };
      const selections = aliases.map((name) => manifest.hooks.PreToolUse
        .map((entry, index) => matcherSelects(entry.matcher, name) ? index : -1)
        .filter((index) => index >= 0));
      expect(selections.every((selected) => selected.length === 1)).toBe(true);
      expect(new Set(selections.flat()).size).toBe(1);
    },
  );

  test.each(aliases)("a real %s event starts exactly one pretooluse handler", (toolName) => {
    const manifest = JSON.parse(readFileSync(join(root, ".codex-plugin", "hooks.json"), "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const selected = manifest.hooks.PreToolUse.filter((entry) =>
      matcherSelects(entry.matcher, toolName));
    const privateRoot = mkdtempSync(join(tmpdir(), "ctx-codex-dispatch-"));
    cleanup.push(privateRoot);

    const outputs = selected.map(() => execFileSync(
      process.execPath,
      [join(root, "hooks", "codex", "pretooluse.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          CODEX_HOME: join(privateRoot, "codex-home"),
          TMPDIR: privateRoot,
          CONTEXT_MODE_SUPPRESS_SECURITY_WARNING: "1",
        },
        input: JSON.stringify({
          tool_name: toolName,
          tool_input: { language: "javascript", code: "console.log('ok')" },
          session_id: `matcher-single-dispatch-${toolName}`,
          cwd: root,
          hook_event_name: "PreToolUse",
          tool_use_id: `matcher-dispatch-${toolName}`,
        }),
      },
    ));

    expect(outputs).toHaveLength(1);
    expect(JSON.parse(outputs[0]).hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });
});
