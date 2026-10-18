import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test.each([false, true])("postinstall preserves existing host files (global=%s)", global => {
  const home = mkdtempSync(join(tmpdir(), "cm-install-home-"));
  const registry = join(home, ".claude/plugins/installed_plugins.json");
  mkdirSync(join(home, ".claude/plugins"), {recursive: true});
  const before = "malformed host data must remain unchanged";
  writeFileSync(registry, before);
  try {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../../scripts/postinstall.mjs")], {
      env: {PATH: process.env.PATH, HOME: home, USERPROFILE: home, npm_config_global: String(global)}, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(registry, "utf8")).toBe(before);
    expect(readdirSync(home)).toEqual([".claude"]);
  } finally { rmSync(home, {recursive: true, force: true}); }
});
