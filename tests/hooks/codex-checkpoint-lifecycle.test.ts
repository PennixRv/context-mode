import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadDatabase } from "../../src/db-base.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const preCompactPath = join(repositoryRoot, "hooks", "codex", "checkpoint-precompact.mjs");
const postCompactPath = join(repositoryRoot, "hooks", "codex", "checkpoint-postcompact.mjs");
const legacySessionStartPath = join(repositoryRoot, "hooks", "codex", "sessionstart.mjs");
const cleanupDirectories: string[] = [];

function runHook(path: string, input: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync(process.execPath, [path], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

function fixture(): { codexHome: string; env: Record<string, string>; projectDir: string } {
  const home = mkdtempSync(join(tmpdir(), "context-mode-codex-hook-"));
  const projectDir = join(home, "project");
  const codexHome = join(home, ".codex");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  execFileSync("git", ["init", "-q", projectDir]);
  cleanupDirectories.push(home);
  return {
    codexHome,
    projectDir,
    env: { CODEX_HOME: codexHome, HOME: home, USERPROFILE: home },
  };
}

afterEach(() => {
  while (cleanupDirectories.length > 0) {
    rmSync(cleanupDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("Codex compact audit hooks", () => {
  it("registers only PreCompact and PostCompact for the checkpoint audit", () => {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, ".codex-plugin", "hooks.json"), "utf8")) as {
      hooks: Record<string, unknown>;
    };
    expect(manifest.hooks.PreCompact).toBeDefined();
    expect(manifest.hooks.PostCompact).toBeDefined();
    expect(manifest.hooks.SessionStart).toBeUndefined();
    expect(existsSync(join(repositoryRoot, "hooks", "codex", "checkpoint-sessionstart.mjs"))).toBe(false);
  });

  it("persists only pending and confirmed audit state", () => {
    const current = fixture();
    const input = {
      cwd: current.projectDir,
      session_id: "session-1",
      turn_id: "turn-1",
      trigger: "manual",
    };
    expect(runHook(preCompactPath, input, current.env).stdout.trim()).toBe("{}");
    expect(runHook(postCompactPath, input, current.env).stdout.trim()).toBe("{}");

    const checkpointDir = join(current.codexHome, "context-mode", "checkpoints");
    const databaseFile = readdirSync(checkpointDir).find((file) => file.endsWith(".db"));
    expect(databaseFile).toBeDefined();
    const Database = loadDatabase();
    const database = new Database(join(checkpointDir, databaseFile!), { readonly: true });
    try {
      expect(database.prepare("SELECT state FROM compact_checkpoints").get()).toEqual({ state: "confirmed" });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoint_delivery_metrics'").get()).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("keeps the legacy SessionStart handler inert for compact sources", () => {
    const current = fixture();
    const result = runHook(legacySessionStartPath, {
      cwd: current.projectDir,
      session_id: "session-1",
      turn_id: "turn-1",
      source: "compact",
    }, current.env);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe("");
  });
});
