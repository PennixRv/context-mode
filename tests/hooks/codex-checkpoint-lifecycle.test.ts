import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadDatabase } from "../../src/db-base.js";
import { getCheckpointReliabilityReport } from "../../src/checkpoint/runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKPOINT_USER_PROMPT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-userpromptsubmit.mjs");
const CHECKPOINT_POST_TOOL_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-posttooluse.mjs");
const CHECKPOINT_PRECOMPACT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-precompact.mjs");
const CHECKPOINT_POSTCOMPACT_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-postcompact.mjs");
const CHECKPOINT_SESSIONSTART_PATH = join(__dirname, "..", "..", "hooks", "codex", "checkpoint-sessionstart.mjs");
const LEGACY_SESSIONSTART_PATH = join(__dirname, "..", "..", "hooks", "codex", "sessionstart.mjs");
const REPOSITORY_ROOT = join(__dirname, "..", "..");
const CHECKPOINT_HOOK_RUNTIME_FILES = [
  "hooks/codex/checkpoint-sessionstart.mjs",
  "hooks/codex/platform.mjs",
  "hooks/checkpoint-diagnostics.mjs",
  "hooks/checkpoint.bundle.mjs",
  "hooks/ensure-deps.mjs",
  "hooks/session-db.bundle.mjs",
  "hooks/session-helpers.mjs",
  "hooks/suppress-stderr.mjs",
];

function runHook(path: string, input: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync(process.execPath, [path], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

function copyCheckpointHookRuntime(rootDir: string) {
  const runtimeRoot = join(rootDir, "checkpoint-hook-runtime");
  for (const relativePath of CHECKPOINT_HOOK_RUNTIME_FILES) {
    const destination = join(runtimeRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REPOSITORY_ROOT, relativePath), destination);
  }
  return {
    sessionStartPath: join(runtimeRoot, "hooks", "codex", "checkpoint-sessionstart.mjs"),
    checkpointBundlePath: join(runtimeRoot, "hooks", "checkpoint.bundle.mjs"),
    ensureDepsPath: join(runtimeRoot, "hooks", "ensure-deps.mjs"),
  };
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
      source: "compact",
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

describe("hooks/codex - compact SessionStart diagnostics", () => {
  let fakeHome: string;
  let projectDir: string;
  let codexHome: string;
  let env: Record<string, string>;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "ctx-codex-checkpoint-diagnostic-"));
    projectDir = join(fakeHome, "project");
    codexHome = join(fakeHome, ".codex");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    env = {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CODEX_HOME: codexHome,
    };
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("records a fixed diagnostic when dependency bootstrap fails before runtime loading", () => {
    const input = {
      session_id: "bootstrap-diagnostic-session",
      turn_id: "bootstrap-diagnostic-turn",
      source: "compact",
      cwd: projectDir,
      prompt: "EARLY-DEPENDENCY-FAILURE-SENTINEL",
    };
    const runtime = copyCheckpointHookRuntime(fakeHome);
    const unavailablePath = `${runtime.ensureDepsPath}.p3-test-unavailable`;
    let result;
    renameSync(runtime.ensureDepsPath, unavailablePath);
    try {
      result = runHook(runtime.sessionStartPath, input, env);
    } finally {
      renameSync(unavailablePath, runtime.ensureDepsPath);
    }

    expect(result!.status, result!.stderr || result!.stdout).toBe(0);
    expect(JSON.parse(result!.stdout).hookSpecificOutput).toEqual({
      hookEventName: "SessionStart",
      additionalContext: "",
    });

    const report = getCheckpointReliabilityReport(projectDir, codexHome);
    expect(report.diagnostics.byCode.DEPENDENCY_UNAVAILABLE).toBe(1);
    expect(JSON.stringify(report)).not.toContain("EARLY-DEPENDENCY-FAILURE-SENTINEL");
  });

  test("records compact empty and runtime failures with fixed content-free diagnostics", () => {
    const input = {
      session_id: "diagnostic-session",
      turn_id: "diagnostic-turn",
      source: "compact",
      cwd: projectDir,
      prompt: "SESSIONSTART-FAILURE-SENTINEL",
    };
    const runtime = copyCheckpointHookRuntime(fakeHome);
    const unavailablePath = `${runtime.checkpointBundlePath}.p3-test-unavailable`;
    let failureResult;
    renameSync(runtime.checkpointBundlePath, unavailablePath);
    try {
      failureResult = runHook(runtime.sessionStartPath, input, env);
    } finally {
      renameSync(unavailablePath, runtime.checkpointBundlePath);
    }

    expect(failureResult!.status, failureResult!.stderr || failureResult!.stdout).toBe(0);
    expect(JSON.parse(failureResult!.stdout).hookSpecificOutput).toEqual({
      hookEventName: "SessionStart",
      additionalContext: "",
    });

    const unavailableReport = getCheckpointReliabilityReport(projectDir, codexHome);
    expect(unavailableReport.available).toBe(false);
    expect(unavailableReport.warnings).toContain("No checkpoint database exists for this project worktree.");
    expect(unavailableReport.diagnostics.byCode.DEPENDENCY_UNAVAILABLE).toBe(1);
    expect(unavailableReport.diagnostics.latest).toMatchObject({
      phase: "compact_session_start",
      outcome: "failed",
      code: "DEPENDENCY_UNAVAILABLE",
    });

    const expectedEmptyResult = runHook(CHECKPOINT_SESSIONSTART_PATH, input, env);
    expect(expectedEmptyResult.status, expectedEmptyResult.stderr || expectedEmptyResult.stdout).toBe(0);
    expect(JSON.parse(expectedEmptyResult.stdout).hookSpecificOutput.additionalContext).toBe("");

    const checkpointDir = join(codexHome, "context-mode", "checkpoints");
    const diagnosticFile = readdirSync(checkpointDir).find((file) => file.endsWith(".sessionstart-diagnostics.jsonl"));
    expect(diagnosticFile).toBeDefined();
    const diagnosticPath = join(checkpointDir, diagnosticFile!);
    const rows = readFileSync(diagnosticPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: "compact_session_start",
        outcome: "failed",
        code: "DEPENDENCY_UNAVAILABLE",
      }),
      expect.objectContaining({
        phase: "compact_session_start",
        outcome: "expected_empty",
        code: "EMPTY_NO_CONFIRMED_CHECKPOINT",
      }),
    ]));
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "code",
        "created_at",
        "outcome",
        "phase",
        "project_sha256",
        "worktree_sha256",
      ]);
    }
    expect(statSync(diagnosticPath).isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(diagnosticPath).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(diagnosticPath, "utf8")).not.toContain("SESSIONSTART-FAILURE-SENTINEL");

    const expectedEmptyReport = getCheckpointReliabilityReport(projectDir, codexHome);
    expect(expectedEmptyReport.diagnostics.byCode.EMPTY_NO_CONFIRMED_CHECKPOINT).toBe(1);
    expect(expectedEmptyReport.diagnostics.byOutcome.failed).toBe(1);
    expect(expectedEmptyReport.diagnostics.byOutcome.expected_empty).toBe(1);
  });
});
