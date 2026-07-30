import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadDatabase } from "../../src/db-base.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_USER_PROMPT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-userpromptsubmit.mjs");
const CHECKPOINT_POST_TOOL_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-posttooluse.mjs");
const CHECKPOINT_PRECOMPACT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-precompact.mjs");
const CHECKPOINT_POSTCOMPACT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-postcompact.mjs");
const CHECKPOINT_SESSIONSTART_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-sessionstart.mjs");
const LEGACY_SESSIONSTART_PATH = join(__dirname, "..", "..", "hooks", "codex", "sessionstart.mjs");

function runHook(path: string, input: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync(process.execPath, [path], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

function initializeGitProject(projectDir: string): void {
  execFileSync("git", ["init", "-q", projectDir]);
  execFileSync("git", ["-C", projectDir, "config", "user.email", "checkpoint@example.test"]);
  execFileSync("git", ["-C", projectDir, "config", "user.name", "Checkpoint Test"]);
  writeFileSync(join(projectDir, "tracked.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", projectDir, "add", "tracked.txt"]);
  execFileSync("git", ["-C", projectDir, "commit", "-qm", "initial"]);
  writeFileSync(join(projectDir, "tracked.txt"), "changed\n", "utf8");
}

function writeTrellisRuntime(projectDir: string, sessionId: string): void {
  const taskDir = join(projectDir, ".trellis", "tasks", "task-1");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({
    id: "task-1",
    status: "in_progress",
    phase: "implement",
  }), "utf8");
  writeFileSync(join(taskDir, "prd.md"), "do not persist this task body", "utf8");

  const runtimeDir = join(projectDir, ".trellis", ".runtime", "sessions");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, `codex_${sessionId}.json`),
    JSON.stringify({ current_task: ".trellis/tasks/task-1" }),
    "utf8",
  );
}

describe("hooks/codex - confirmed checkpoint lifecycle", () => {
  let fakeHome: string;
  let projectDir: string;
  let codexHome: string;
  let env: Record<string, string>;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "ctx-codex-checkpoint-home-"));
    projectDir = join(fakeHome, "project");
    codexHome = join(fakeHome, ".codex");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    initializeGitProject(projectDir);
    env = {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CODEX_HOME: codexHome,
    };
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("injects only a confirmed checkpoint once and does not persist raw content", () => {
    const sessionId = "checkpoint-session";
    const baseInput = {
      session_id: sessionId,
      turn_id: "turn-1",
      cwd: projectDir,
    };
    writeTrellisRuntime(projectDir, sessionId);

    expect(runHook(
      CHECKPOINT_USER_PROMPT_PATH,
      { ...baseInput, prompt: "do not persist this prompt" },
      env,
    ).status).toBe(0);
    expect(runHook(
      CHECKPOINT_POST_TOOL_PATH,
      {
        ...baseInput,
        tool_name: "Edit",
        tool_input: { path: "tracked.txt", content: "do not persist this tool payload" },
        tool_output: { isError: false },
      },
      env,
    ).status).toBe(0);
    expect(runHook(
      CHECKPOINT_PRECOMPACT_PATH,
      { ...baseInput, trigger: "manual" },
      env,
    ).stdout.trim()).toBe("{}");

    const pendingResult = runHook(CHECKPOINT_SESSIONSTART_PATH, baseInput, env);
    expect(JSON.parse(pendingResult.stdout).hookSpecificOutput.additionalContext).toBe("");

    expect(runHook(
      CHECKPOINT_POSTCOMPACT_PATH,
      { ...baseInput, trigger: "manual" },
      env,
    ).stdout.trim()).toBe("{}");

    const restored = runHook(CHECKPOINT_SESSIONSTART_PATH, baseInput, env);
    expect(restored.status, restored.stderr || restored.stdout).toBe(0);
    const context = JSON.parse(restored.stdout).hookSpecificOutput.additionalContext as string;
    expect(context).toContain("task-1");
    expect(context).toContain("tracked.txt");
    expect(context).not.toContain("do not persist this prompt");
    expect(context).not.toContain("do not persist this tool payload");
    expect(context).not.toContain("do not persist this task body");
    expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(1_200);

    const secondRestore = runHook(CHECKPOINT_SESSIONSTART_PATH, baseInput, env);
    expect(JSON.parse(secondRestore.stdout).hookSpecificOutput.additionalContext).toBe("");

    const checkpointDir = join(codexHome, "context-mode", "checkpoints");
    const dbFile = readdirSync(checkpointDir).find((file) => file.endsWith(".db"));
    expect(dbFile).toBeDefined();
    const Database = loadDatabase();
    const db = new Database(join(checkpointDir, dbFile!), { readonly: true });
    try {
      const payload = db.prepare("SELECT payload_json FROM compact_checkpoints").get() as { payload_json: string };
      expect(payload.payload_json).not.toContain("do not persist this prompt");
      expect(payload.payload_json).not.toContain("do not persist this tool payload");
      expect(payload.payload_json).not.toContain("do not persist this task body");
    } finally {
      db.close();
    }
  });

  test("legacy sessionstart remains inert for compact sources", () => {
    const result = runHook(LEGACY_SESSIONSTART_PATH, {
      session_id: "legacy-compact-session",
      turn_id: "turn-1",
      source: "compact",
      cwd: projectDir,
    }, env);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe("");
  });
});
