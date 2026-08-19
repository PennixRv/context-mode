import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkpointInternals,
  claimConfirmedCheckpointContext,
  confirmPendingCheckpoint,
  createPendingCheckpoint,
  getCheckpointReliabilityReport,
  getRecoveryBriefProviderStatus,
  initializeProjectRecoveryBriefProvider,
  resolveCheckpointIdentity,
  updateRecoveryBriefProvider,
} from "../../src/checkpoint/runtime.js";
import { loadDatabase } from "../../src/db-base.js";
import type { CheckpointHookInput, RecoveryBrief, RecoveryBriefFact } from "../../src/checkpoint/types.js";

const BASE_TIME = new Date("2026-07-30T00:00:00.000Z");
const CLEANUP_DIRECTORIES: string[] = [];
const PROJECT_PROVIDER_SENTINEL = "PROJECT-PROVIDER-SENTINEL";

interface Fixture {
  configDir: string;
  projectDir: string;
}

interface InvalidTrellisPointerCase {
  name: string;
  errorCode:
    | "TRELLIS_RUNTIME_INVALID"
    | "TRELLIS_TASK_INVALID"
    | "TRELLIS_BRIEF_INVALID";
  invalidate: (projectDir: string, sessionId: string, taskDir: string) => void;
}

type ActiveTrellisTaskStatus = "planning" | "in_progress";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): Fixture {
  const rootDir = mkdtempSync(join(tmpdir(), "context-mode-recovery-provider-"));
  const projectDir = join(rootDir, "project");
  const configDir = join(rootDir, "codex-home");
  mkdirSync(projectDir, { recursive: true });
  CLEANUP_DIRECTORIES.push(rootDir);
  return { projectDir, configDir };
}

function input(projectDir: string, sessionId = "session-1", turnId = "turn-1"): CheckpointHookInput {
  return { cwd: projectDir, session_id: sessionId, turn_id: turnId, trigger: "manual" };
}

function timestamp(offset = 0): string {
  return new Date(BASE_TIME.getTime() + offset).toISOString();
}

function fact(
  value: string,
  priority: RecoveryBriefFact["priority"],
  sourceKind: RecoveryBriefFact["source_kind"],
  sourceSha256: string,
): RecoveryBriefFact {
  return {
    value,
    priority,
    source_kind: sourceKind,
    source_sha256: sourceSha256,
    valid_at: timestamp(),
  };
}

function brief(
  sourceKind: RecoveryBriefFact["source_kind"],
  sourceSha256: string,
  updatedAt = timestamp(),
): RecoveryBrief {
  return {
    schema_version: 1,
    updated_at: updatedAt,
    objective: fact("Complete the controlled recovery workflow", "critical", sourceKind, sourceSha256),
    hard_constraints: [],
    decisions: [],
    completed_work: [],
    open_work: [],
    latest_blocker: null,
    next_action: null,
    project_state: null,
  };
}

function providerSourceHash(projectDir: string): string {
  const config = JSON.parse(readFileSync(join(projectDir, ".context-mode", "recovery-provider.json"), "utf8")) as {
    source_paths: Array<{ sha256: string }>;
  };
  return config.source_paths[0]!.sha256;
}

function createActiveTrellisTask(
  projectDir: string,
  sessionId: string,
  status: ActiveTrellisTaskStatus = "in_progress",
  taskName = "task-1",
): string {
  const taskDir = join(projectDir, ".trellis", "tasks", taskName);
  const runtimeDir = join(projectDir, ".trellis", ".runtime", "sessions");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({ id: taskName, status }), "utf8");
  writeFileSync(
    trellisRuntimePath(projectDir, sessionId),
    JSON.stringify({ current_task: `tasks/${taskName}` }),
    "utf8",
  );
  return taskDir;
}

function writeTrellisTaskStatus(taskDir: string, status: unknown, includeStatus = true): void {
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify(includeStatus ? { id: "task-1", status } : { id: "task-1" }),
    "utf8",
  );
}

function currentTrellisSourceSha256(projectDir: string, sessionId: string): string {
  const status = getRecoveryBriefProviderStatus(projectDir, sessionId);
  expect(status).toMatchObject({
    provider: "trellis",
    task: "active",
    errorCode: "NONE",
  });
  expect(status.trellisSourceSha256).toMatch(/^[a-f0-9]{64}$/);
  return status.trellisSourceSha256!;
}

function trellisRuntimePath(projectDir: string, sessionId: string): string {
  return join(projectDir, ".trellis", ".runtime", "sessions", `codex_${sessionId}.json`);
}

function createProjectAlias(projectDir: string): string {
  const projectAlias = `${projectDir}-alias`;
  symlinkSync(projectDir, projectAlias, process.platform === "win32" ? "junction" : "dir");
  CLEANUP_DIRECTORIES.push(projectAlias);
  return projectAlias;
}

function configureProjectRecoveryProvider(current: Fixture, sessionId: string): void {
  writeFileSync(join(current.projectDir, "evidence.md"), "fallback evidence", "utf8");
  expect(initializeProjectRecoveryBriefProvider(current.projectDir, {
    storage: "tracked",
    sourcePaths: ["evidence.md"],
  }).ok).toBe(true);
  expect(updateRecoveryBriefProvider(current.projectDir, sessionId, {
    expectedSha256: "absent",
    brief: {
      ...brief("explicit_project_state", providerSourceHash(current.projectDir)),
      objective: fact(
        PROJECT_PROVIDER_SENTINEL,
        "critical",
        "explicit_project_state",
        providerSourceHash(current.projectDir),
      ),
    },
  }).ok).toBe(true);
}

function expectInvalidTrellisCheckpoint(
  current: Fixture,
  sessionId: string,
  turnId: string,
  errorCode: InvalidTrellisPointerCase["errorCode"],
): void {
  expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId)).toMatchObject({
    provider: "trellis",
    health: "invalid",
    recoveryStatus: "invalid",
    origin: "trellis",
    errorCode,
  });

  createPendingCheckpoint(input(current.projectDir, sessionId, turnId), {
    configDir: current.configDir,
    now: BASE_TIME,
  });
  const identity = resolveCheckpointIdentity(current.projectDir, current.configDir);
  const Database = loadDatabase();
  const database = new Database(identity.dbPath);
  try {
    expect(database.prepare(
      "SELECT recovery_status, recovery_origin, recovery_json, recovery_sha256 FROM compact_checkpoints WHERE turn_id = ?",
    ).get(turnId)).toEqual({
      recovery_status: "invalid",
      recovery_origin: "trellis",
      recovery_json: null,
      recovery_sha256: null,
    });
  } finally {
    database.close();
  }

  const checkpointInput = input(current.projectDir, sessionId, turnId);
  expect(confirmPendingCheckpoint(checkpointInput, {
    configDir: current.configDir,
    now: new Date(BASE_TIME.getTime() + 1),
  })).toBe(true);
  const context = claimConfirmedCheckpointContext(checkpointInput, {
    configDir: current.configDir,
    now: new Date(BASE_TIME.getTime() + 2),
  });
  expect(context).not.toContain("\"recovery_brief\"");
  expect(context).not.toContain(PROJECT_PROVIDER_SENTINEL);
}

const INVALID_TRELLIS_POINTER_CASES: InvalidTrellisPointerCase[] = [
  {
    name: "the runtime JSON is malformed",
    errorCode: "TRELLIS_RUNTIME_INVALID",
    invalidate: (projectDir, sessionId) => {
      writeFileSync(trellisRuntimePath(projectDir, sessionId), "{", "utf8");
    },
  },
  {
    name: "the runtime pointer leaves the Trellis root",
    errorCode: "TRELLIS_TASK_INVALID",
    invalidate: (projectDir, sessionId) => {
      writeFileSync(
        trellisRuntimePath(projectDir, sessionId),
        JSON.stringify({ current_task: "../../outside" }),
        "utf8",
      );
    },
  },
  {
    name: "the runtime points to a stale task directory",
    errorCode: "TRELLIS_TASK_INVALID",
    invalidate: (projectDir, sessionId) => {
      writeFileSync(
        trellisRuntimePath(projectDir, sessionId),
        JSON.stringify({ current_task: "tasks/task-missing" }),
        "utf8",
      );
    },
  },
  {
    name: "the active task reference has no trusted task manifest",
    errorCode: "TRELLIS_TASK_INVALID",
    invalidate: (_projectDir, _sessionId, taskDir) => {
      rmSync(join(taskDir, "task.json"));
    },
  },
  {
    name: "the active task manifest is malformed",
    errorCode: "TRELLIS_TASK_INVALID",
    invalidate: (_projectDir, _sessionId, taskDir) => {
      writeFileSync(join(taskDir, "task.json"), "{", "utf8");
    },
  },
  {
    name: "the Trellis RecoveryBrief is malformed",
    errorCode: "TRELLIS_BRIEF_INVALID",
    invalidate: (_projectDir, _sessionId, taskDir) => {
      writeFileSync(join(taskDir, "recovery-brief.json"), "{", "utf8");
    },
  },
];

if (process.platform !== "win32") {
  INVALID_TRELLIS_POINTER_CASES.push({
    name: "the active task manifest is a symbolic link",
    errorCode: "TRELLIS_TASK_INVALID",
    invalidate: (projectDir, _sessionId, taskDir) => {
      const linkedManifest = join(projectDir, "linked-task.json");
      writeFileSync(linkedManifest, JSON.stringify({ id: "task-1", status: "in_progress" }), "utf8");
      rmSync(join(taskDir, "task.json"));
      symlinkSync(linkedManifest, join(taskDir, "task.json"));
    },
  });
}

afterEach(() => {
  while (CLEANUP_DIRECTORIES.length > 0) {
    rmSync(CLEANUP_DIRECTORIES.pop()!, { recursive: true, force: true });
  }
});

describe("RecoveryBrief providers", () => {
  for (const activeStatus of ["planning", "in_progress"] as const) {
    it(`preserves source-bound CAS updates for an active ${activeStatus} task`, () => {
      const current = fixture();
      const sessionId = `session-active-${activeStatus}`;
      const taskDir = createActiveTrellisTask(current.projectDir, sessionId, activeStatus);
      const firstSourceSha256 = currentTrellisSourceSha256(current.projectDir, sessionId);

      expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId)).toMatchObject({
        provider: "trellis",
        health: "available",
        recoveryStatus: "absent",
        task: "active",
        errorCode: "NONE",
      });
      const first = updateRecoveryBriefProvider(current.projectDir, sessionId, {
        expectedSha256: "absent",
        brief: brief("trellis_task", firstSourceSha256),
      });
      expect(first).toMatchObject({ ok: true, provider: "trellis", errorCode: "NONE" });

      const second = updateRecoveryBriefProvider(current.projectDir, sessionId, {
        expectedSha256: first.briefSha256!,
        brief: brief("trellis_task", firstSourceSha256, timestamp(1)),
      });
      expect(second).toMatchObject({ ok: true, provider: "trellis", errorCode: "NONE" });
      expect(second.briefBytes).toBe(statSync(join(taskDir, "recovery-brief.json")).size);
    });
  }

  it("preserves canonical pointer aliases for an active task directory", () => {
    const current = fixture();
    const sessionId = "session-active-pointer-aliases";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const runtimePath = trellisRuntimePath(current.projectDir, sessionId);

    for (const pointer of [
      "task-1",
      ".trellis/tasks/task-1",
      "./.trellis/tasks/task-1",
      taskDir,
    ]) {
      writeFileSync(runtimePath, JSON.stringify({ current_task: pointer }), "utf8");
      expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId), pointer).toMatchObject({
        provider: "trellis",
        health: "available",
        recoveryStatus: "absent",
        task: "active",
        errorCode: "NONE",
      });
    }
  });

  const inactiveStatuses: Array<{
    name: string;
    value: unknown;
    includeStatus?: boolean;
  }> = [
    { name: "completed", value: "completed" },
    { name: "archived", value: "archived" },
    { name: "cancelled", value: "cancelled" },
    { name: "blocked", value: "blocked" },
    { name: "missing", value: undefined, includeStatus: false },
    { name: "empty", value: "" },
    { name: "unknown", value: "reviewing" },
    { name: "non-string", value: 1 },
  ];

  for (const inactiveStatus of inactiveStatuses) {
    it(`rejects a canonical task whose status is ${inactiveStatus.name}`, () => {
      const current = fixture();
      const sessionId = `session-inactive-${inactiveStatus.name}`;
      const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
      writeTrellisTaskStatus(taskDir, inactiveStatus.value, inactiveStatus.includeStatus ?? true);

      const status = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
      expect(status).toMatchObject({
        provider: "trellis",
        health: "invalid",
        recoveryStatus: "invalid",
        origin: "trellis",
        task: "absent",
        briefPath: null,
        briefSha256: null,
        trellisSourceSha256: null,
        errorCode: "TRELLIS_TASK_INACTIVE",
      });
      const result = updateRecoveryBriefProvider(current.projectDir, sessionId, {
        expectedSha256: "absent",
        brief: brief("trellis_task", status.trellisSourceSha256 ?? "a".repeat(64)),
      });
      expect(result).toMatchObject({
        ok: false,
        provider: "trellis",
        origin: "trellis",
        errorCode: "TRELLIS_TASK_INACTIVE",
      });
      expect(existsSync(join(taskDir, "recovery-brief.json"))).toBe(false);
    });
  }

  it("rejects non-canonical Trellis task paths through status and update", () => {
    const pathCases: Array<{
      name: string;
      setup: (current: Fixture, sessionId: string) => string;
    }> = [
      {
        name: "archive descendant",
        setup: (current, sessionId) => {
          const taskDir = join(current.projectDir, ".trellis", "tasks", "archive", "task-1");
          mkdirSync(taskDir, { recursive: true });
          writeTrellisTaskStatus(taskDir, "in_progress");
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/archive/task-1",
          }));
          return taskDir;
        },
      },
      {
        name: "nested task directory",
        setup: (current, sessionId) => {
          const taskDir = join(current.projectDir, ".trellis", "tasks", "task-1", "nested");
          mkdirSync(taskDir, { recursive: true });
          writeTrellisTaskStatus(taskDir, "in_progress");
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-1/nested",
          }));
          return taskDir;
        },
      },
      {
        name: "non-task Trellis directory",
        setup: (current, sessionId) => {
          const taskDir = join(current.projectDir, ".trellis", "evidence", "task-1");
          mkdirSync(taskDir, { recursive: true });
          writeTrellisTaskStatus(taskDir, "in_progress");
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: ".trellis/evidence/task-1",
          }));
          return taskDir;
        },
      },
      {
        name: "direct task manifest",
        setup: (current, sessionId) => {
          const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-1/task.json",
          }));
          return taskDir;
        },
      },
      {
        name: "missing task directory",
        setup: (current, sessionId) => {
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-missing",
          }));
          return join(current.projectDir, ".trellis", "tasks", "task-missing");
        },
      },
      {
        name: "non-directory task target",
        setup: (current, sessionId) => {
          const taskPath = join(current.projectDir, ".trellis", "tasks", "task-file");
          mkdirSync(join(current.projectDir, ".trellis", "tasks"), { recursive: true });
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(taskPath, "not a task directory", "utf8");
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-file",
          }));
          return taskPath;
        },
      },
    ];

    if (process.platform !== "win32") {
      pathCases.push({
        name: "symbolic-link task directory",
        setup: (current, sessionId) => {
          const realTaskDir = join(current.projectDir, ".trellis", "tasks", "task-real");
          const linkedTaskDir = join(current.projectDir, ".trellis", "tasks", "task-link");
          mkdirSync(realTaskDir, { recursive: true });
          writeTrellisTaskStatus(realTaskDir, "in_progress");
          symlinkSync(realTaskDir, linkedTaskDir, "dir");
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-link",
          }));
          return realTaskDir;
        },
      });
      pathCases.push({
        name: "symbolic-link task directory escaping the Trellis root",
        setup: (current, sessionId) => {
          const outsideTaskDir = `${current.projectDir}-outside-task`;
          CLEANUP_DIRECTORIES.push(outsideTaskDir);
          const linkedTaskDir = join(current.projectDir, ".trellis", "tasks", "task-external-link");
          mkdirSync(outsideTaskDir, { recursive: true });
          writeTrellisTaskStatus(outsideTaskDir, "in_progress");
          mkdirSync(join(current.projectDir, ".trellis", "tasks"), { recursive: true });
          symlinkSync(outsideTaskDir, linkedTaskDir, "dir");
          mkdirSync(join(current.projectDir, ".trellis", ".runtime", "sessions"), { recursive: true });
          writeFileSync(trellisRuntimePath(current.projectDir, sessionId), JSON.stringify({
            current_task: "tasks/task-external-link",
          }));
          return outsideTaskDir;
        },
      });
    }

    for (const [index, pathCase] of pathCases.entries()) {
      const current = fixture();
      const sessionId = `session-path-${index}`;
      const taskPath = pathCase.setup(current, sessionId);
      const status = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
      expect(status, pathCase.name).toMatchObject({
        provider: "trellis",
        health: "invalid",
        recoveryStatus: "invalid",
        origin: "trellis",
        task: "absent",
        briefPath: null,
        trellisSourceSha256: null,
        errorCode: "TRELLIS_TASK_INVALID",
      });
      const update = updateRecoveryBriefProvider(current.projectDir, sessionId, {
        expectedSha256: "absent",
        brief: brief("trellis_task", status.trellisSourceSha256 ?? "a".repeat(64)),
      });
      expect(update, pathCase.name).toMatchObject({
        ok: false,
        provider: "trellis",
        errorCode: "TRELLIS_TASK_INVALID",
      });
      if (existsSync(taskPath) && statSync(taskPath).isDirectory()) {
        expect(existsSync(join(taskPath, "recovery-brief.json")), pathCase.name).toBe(false);
      }
    }
  });

  it("preserves an existing Brief when its task becomes inactive", () => {
    const current = fixture();
    const sessionId = "session-inactive-existing-brief";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const first = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", currentTrellisSourceSha256(current.projectDir, sessionId)),
    });
    expect(first.ok).toBe(true);
    const briefPath = join(taskDir, "recovery-brief.json");
    const before = readFileSync(briefPath);
    const beforeSha256 = sha256(before);

    writeTrellisTaskStatus(taskDir, "completed");
    const status = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
    expect(status).toMatchObject({
      provider: "trellis",
      task: "absent",
      briefPath: null,
      errorCode: "TRELLIS_TASK_INACTIVE",
    });
    expect(updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: first.briefSha256!,
      brief: brief("trellis_task", status.trellisSourceSha256 ?? "a".repeat(64), timestamp(1)),
    })).toMatchObject({ ok: false, errorCode: "TRELLIS_TASK_INACTIVE" });
    const after = readFileSync(briefPath);
    expect(after).toEqual(before);
    expect(sha256(after)).toBe(beforeSha256);
  });

  it("does not bypass an inactive Trellis task with a configured project provider", () => {
    const current = fixture();
    const sessionId = "session-inactive-no-project-fallback";
    configureProjectRecoveryProvider(current, sessionId);
    const projectBriefPath = join(current.projectDir, ".context-mode", "recovery-brief.json");
    const projectBriefBefore = readFileSync(projectBriefPath);
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    writeTrellisTaskStatus(taskDir, "completed");

    const status = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
    expect(status).toMatchObject({
      provider: "trellis",
      health: "invalid",
      task: "absent",
      errorCode: "TRELLIS_TASK_INACTIVE",
    });
    expect(updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", status.trellisSourceSha256 ?? "a".repeat(64)),
    })).toMatchObject({
      ok: false,
      provider: "trellis",
      errorCode: "TRELLIS_TASK_INACTIVE",
    });
    expect(readFileSync(projectBriefPath)).toEqual(projectBriefBefore);
    expect(existsSync(join(taskDir, "recovery-brief.json"))).toBe(false);
  });

  it("returns deterministic content-free diagnostics for invalid update Briefs", () => {
    const current = fixture();
    const valid = brief("trellis_task", "a".repeat(64));
    const secret = "RECOVERY-BRIEF-SECRET-SENTINEL";
    const cases: Array<{
      candidate: unknown;
      issue: { code: string; path: string };
    }> = [
      { candidate: null, issue: { code: "EXPECTED_OBJECT", path: "brief" } },
      { candidate: { schema_version: 1 }, issue: { code: "MISSING_FIELD", path: "brief.updated_at" } },
      {
        candidate: { ...valid, [secret]: "must never be returned" },
        issue: { code: "UNEXPECTED_FIELD", path: "brief" },
      },
      {
        candidate: { ...valid, objective: { ...valid.objective, priority: "optional" } },
        issue: { code: "INVALID_PRIORITY", path: "brief.objective.priority" },
      },
      {
        candidate: { ...valid, objective: { ...valid.objective, source_kind: secret } },
        issue: { code: "INVALID_SOURCE_KIND", path: "brief.objective.source_kind" },
      },
      {
        candidate: { ...valid, objective: { ...valid.objective, source_sha256: "A".repeat(64) } },
        issue: { code: "INVALID_SHA256", path: "brief.objective.source_sha256" },
      },
      {
        candidate: { ...valid, updated_at: "2026-08-10" },
        issue: { code: "INVALID_TIMESTAMP", path: "brief.updated_at" },
      },
      {
        candidate: { ...valid, objective: { ...valid.objective, value: "line\nbreak" } },
        issue: { code: "CONTROL_CHARACTER", path: "brief.objective.value" },
      },
      {
        candidate: { ...valid, objective: { ...valid.objective, value: "界".repeat(171) } },
        issue: { code: "VALUE_TOO_LARGE", path: "brief.objective.value" },
      },
      {
        candidate: {
          ...valid,
          hard_constraints: Array.from({ length: 17 }, () => valid.objective),
        },
        issue: { code: "TOO_MANY_ITEMS", path: "brief.hard_constraints" },
      },
    ];

    for (const { candidate, issue } of cases) {
      const result = updateRecoveryBriefProvider(current.projectDir, "session-invalid", {
        expectedSha256: "absent",
        brief: candidate,
      });
      expect(result).toMatchObject({
        ok: false,
        errorCode: "INVALID_RECOVERY_BRIEF",
        validationIssue: issue,
      });
      expect(result.validationIssue?.expected.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain("must never be returned");
    }
  });

  it("reports the persisted Brief limit without echoing oversized facts", () => {
    const current = fixture();
    const sessionId = "session-oversized-brief";
    createActiveTrellisTask(current.projectDir, sessionId);
    const sourceSha256 = currentTrellisSourceSha256(current.projectDir, sessionId);
    const valid = brief("trellis_task", sourceSha256);
    const oversizedValue = `OVERSIZED-SENTINEL-${"x".repeat(380)}`;
    const listFact = fact(oversizedValue, "critical", "trellis_task", sourceSha256);
    const candidate: RecoveryBrief = {
      ...valid,
      hard_constraints: Array.from({ length: 16 }, () => listFact),
      decisions: Array.from({ length: 16 }, () => ({ ...listFact, priority: "important" })),
      completed_work: Array.from({ length: 16 }, () => ({ ...listFact, priority: "optional" })),
      open_work: Array.from({ length: 16 }, () => ({ ...listFact, priority: "important" })),
    };

    const result = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: candidate,
    });
    expect(result).toMatchObject({
      ok: false,
      provider: "trellis",
      errorCode: "INVALID_RECOVERY_BRIEF",
      validationIssue: {
        code: "BRIEF_TOO_LARGE",
        path: "brief",
        expected: "persisted JSON at most 12000 UTF-8 bytes",
      },
    });
    expect(JSON.stringify(result)).not.toContain("OVERSIZED-SENTINEL");
  });

  it("accepts a valid Trellis runtime through a canonical project alias", () => {
    const current = fixture();
    const sessionId = "session-trellis-project-alias";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const projectAlias = createProjectAlias(current.projectDir);

    expect(getRecoveryBriefProviderStatus(projectAlias, sessionId)).toMatchObject({
      provider: "trellis",
      health: "available",
      recoveryStatus: "absent",
      task: "active",
      errorCode: "NONE",
    });
    const update = updateRecoveryBriefProvider(projectAlias, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", currentTrellisSourceSha256(projectAlias, sessionId)),
    });
    expect(update).toMatchObject({ ok: true, provider: "trellis", errorCode: "NONE" });
    const status = getRecoveryBriefProviderStatus(projectAlias, sessionId);
    expect(status).toMatchObject({
      provider: "trellis",
      health: "available",
      recoveryStatus: "available",
      task: "active",
      errorCode: "NONE",
    });
    const persistedPath = join(taskDir, "recovery-brief.json");
    expect(update.briefBytes).toBe(statSync(persistedPath).size);
    expect(status.briefBytes).toBe(update.briefBytes);
  });

  it("reports persisted file bytes while keeping canonical digest identity format-insensitive", () => {
    const current = fixture();
    const sessionId = "session-trellis-byte-semantics";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const sourceSha256 = currentTrellisSourceSha256(current.projectDir, sessionId);
    const firstBrief = brief("trellis_task", sourceSha256);
    const first = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: firstBrief,
    });
    const persistedPath = join(taskDir, "recovery-brief.json");
    expect(first).toMatchObject({ ok: true, errorCode: "NONE" });
    expect(first.briefBytes).toBe(statSync(persistedPath).size);
    expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId)).toMatchObject({
      briefSha256: first.briefSha256,
      briefBytes: first.briefBytes,
    });

    writeFileSync(persistedPath, JSON.stringify(firstBrief), "utf8");
    const compactStatus = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
    expect(compactStatus.briefSha256).toBe(first.briefSha256);
    expect(compactStatus.briefBytes).toBe(statSync(persistedPath).size);
    expect(compactStatus.briefBytes).toBeLessThan(first.briefBytes!);

    const second = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: first.briefSha256!,
      brief: brief("trellis_task", sourceSha256, timestamp(1)),
    });
    expect(second).toMatchObject({ ok: true, errorCode: "NONE" });
  });

  it("keeps the existing no-provider checkpoint behavior and persists origin none", () => {
    const current = fixture();
    const status = getRecoveryBriefProviderStatus(current.projectDir, "session-none");
    expect(status).toMatchObject({
      provider: "none",
      health: "absent",
      recoveryStatus: "absent",
      origin: "none",
      errorCode: "NO_PROVIDER",
    });

    createPendingCheckpoint(input(current.projectDir, "session-none"), {
      configDir: current.configDir,
      now: BASE_TIME,
    });
    const identity = resolveCheckpointIdentity(current.projectDir, current.configDir);
    const Database = loadDatabase();
    const database = new Database(identity.dbPath);
    try {
      expect(database.prepare(
        "SELECT recovery_status, recovery_origin FROM compact_checkpoints",
      ).get()).toEqual({ recovery_status: "absent", recovery_origin: "none" });
    } finally {
      database.close();
    }
  });

  it("initializes local providers through .git/info/exclude and keeps tracked providers visible", () => {
    const local = fixture();
    writeFileSync(join(local.projectDir, "evidence.md"), "local evidence", "utf8");
    execFileSync("git", ["init", "--quiet"], { cwd: local.projectDir });

    expect(initializeProjectRecoveryBriefProvider(local.projectDir, {
      storage: "local",
      sourcePaths: ["evidence.md"],
    })).toMatchObject({ ok: true, storage: "local", sourceCount: 1, errorCode: "NONE" });
    expect(readFileSync(join(local.projectDir, ".git", "info", "exclude"), "utf8")).toContain(".context-mode/");
    expect(existsSync(join(local.projectDir, ".context-mode", "recovery-brief.json"))).toBe(false);
    expect(getRecoveryBriefProviderStatus(local.projectDir, "session-local")).toMatchObject({
      provider: "project",
      health: "available",
      recoveryStatus: "absent",
      origin: "project",
    });

    const tracked = fixture();
    writeFileSync(join(tracked.projectDir, "evidence.md"), "tracked evidence", "utf8");
    expect(initializeProjectRecoveryBriefProvider(tracked.projectDir, {
      storage: "tracked",
      sourcePaths: ["evidence.md"],
    })).toMatchObject({ ok: true, storage: "tracked", sourceCount: 1, errorCode: "NONE" });
    expect(existsSync(join(tracked.projectDir, ".gitignore"))).toBe(false);
  });

  it("uses source-bound CAS updates and leaves confirmed project snapshots immutable when evidence drifts", () => {
    const current = fixture();
    writeFileSync(join(current.projectDir, "evidence.md"), "first state", "utf8");
    expect(initializeProjectRecoveryBriefProvider(current.projectDir, {
      storage: "tracked",
      sourcePaths: ["evidence.md"],
    }).ok).toBe(true);

    const firstSourceHash = providerSourceHash(current.projectDir);
    const firstUpdate = updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: "absent",
      brief: brief("explicit_project_state", firstSourceHash),
    });
    expect(firstUpdate).toMatchObject({ ok: true, provider: "project", errorCode: "NONE" });
    expect(firstUpdate.briefSha256).toMatch(/^[a-f0-9]{64}$/);
    const projectBriefPath = join(current.projectDir, ".context-mode", "recovery-brief.json");
    expect(firstUpdate.briefBytes).toBe(statSync(projectBriefPath).size);
    expect(getRecoveryBriefProviderStatus(current.projectDir, "session-project").briefBytes)
      .toBe(firstUpdate.briefBytes);

    createPendingCheckpoint(input(current.projectDir, "session-project", "turn-project"), {
      configDir: current.configDir,
      now: BASE_TIME,
    });

    const nextBrief = brief("explicit_project_state", firstSourceHash, timestamp(1));
    const secondUpdate = updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: firstUpdate.briefSha256!,
      brief: nextBrief,
    });
    expect(secondUpdate.ok).toBe(true);
    expect(updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: firstUpdate.briefSha256!,
      brief: nextBrief,
    }).errorCode).toBe("CAS_CONFLICT");

    writeFileSync(join(current.projectDir, "evidence.md"), "second state", "utf8");
    expect(getRecoveryBriefProviderStatus(current.projectDir, "session-project")).toMatchObject({
      provider: "project",
      health: "invalid",
      recoveryStatus: "invalid",
      sourceDrift: true,
      errorCode: "PROJECT_SOURCE_DRIFT",
    });
    expect(updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: secondUpdate.briefSha256!,
      brief: nextBrief,
    }).errorCode).toBe("PROJECT_SOURCE_DRIFT");

    const refreshedSourceHash = sha256("second state");
    const refreshed = updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: secondUpdate.briefSha256!,
      brief: brief("explicit_project_state", refreshedSourceHash, timestamp(2)),
      sourcePaths: ["evidence.md"],
    });
    expect(refreshed).toMatchObject({ ok: true, sourceCount: 1, errorCode: "NONE" });
    expect(getRecoveryBriefProviderStatus(current.projectDir, "session-project")).toMatchObject({
      provider: "project",
      health: "available",
      recoveryStatus: "available",
      sourceDrift: false,
    });

    const identity = resolveCheckpointIdentity(current.projectDir, current.configDir);
    const Database = loadDatabase();
    const database = new Database(identity.dbPath);
    try {
      expect(database.prepare(
        "SELECT recovery_status, recovery_origin FROM compact_checkpoints WHERE turn_id = ?",
      ).get("turn-project")).toEqual({ recovery_status: "available", recovery_origin: "project" });
    } finally {
      database.close();
    }
  });

  it("rejects project Briefs that do not match explicit project evidence", () => {
    const current = fixture();
    writeFileSync(join(current.projectDir, "evidence.md"), "evidence", "utf8");
    initializeProjectRecoveryBriefProvider(current.projectDir, {
      storage: "tracked",
      sourcePaths: ["evidence.md"],
    });

    expect(updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: "absent",
      brief: brief("trellis_task", "a".repeat(64)),
    }).errorCode).toBe("PROJECT_SOURCE_MISMATCH");
    expect(updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: "absent",
      brief: brief("explicit_project_state", "b".repeat(64)),
    }).errorCode).toBe("PROJECT_SOURCE_MISMATCH");
    expect(existsSync(join(current.projectDir, ".context-mode", "recovery-brief.json"))).toBe(false);
  });

  it("requires every Trellis Brief fact to cite the current content-free source digest", () => {
    const current = fixture();
    const sessionId = "session-trellis-source-validation";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const status = getRecoveryBriefProviderStatus(current.projectDir, sessionId);

    expect(status).toMatchObject({
      provider: "trellis",
      health: "available",
      recoveryStatus: "absent",
      task: "active",
      errorCode: "NONE",
    });
    expect(status.trellisSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(status)).not.toContain("task-1\"}");

    const wrongDigestResult = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", "a".repeat(64)),
    });
    expect(wrongDigestResult).toMatchObject({ ok: false, errorCode: "TRELLIS_SOURCE_MISMATCH" });
    expect(existsSync(join(taskDir, "recovery-brief.json"))).toBe(false);

    const wrongKindResult = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("explicit_project_state", status.trellisSourceSha256!),
    });
    expect(wrongKindResult).toMatchObject({ ok: false, errorCode: "TRELLIS_SOURCE_MISMATCH" });
    expect(existsSync(join(taskDir, "recovery-brief.json"))).toBe(false);

    const mixedDigestResult = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: {
        ...brief("trellis_task", status.trellisSourceSha256!),
        hard_constraints: [fact(
          "Preserve exact source provenance for every fact",
          "critical",
          "trellis_task",
          "c".repeat(64),
        )],
      },
    });
    expect(mixedDigestResult).toMatchObject({ ok: false, errorCode: "TRELLIS_SOURCE_MISMATCH" });
    expect(existsSync(join(taskDir, "recovery-brief.json"))).toBe(false);

    const firstWrite = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", status.trellisSourceSha256!),
    });
    expect(firstWrite).toMatchObject({ ok: true, errorCode: "NONE" });
    const firstContent = readFileSync(join(taskDir, "recovery-brief.json"), "utf8");

    const rejectedOverwrite = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: firstWrite.briefSha256!,
      brief: brief("trellis_task", "b".repeat(64), timestamp(1)),
    });
    expect(rejectedOverwrite).toMatchObject({ ok: false, errorCode: "TRELLIS_SOURCE_MISMATCH" });
    expect(readFileSync(join(taskDir, "recovery-brief.json"), "utf8")).toBe(firstContent);
  });

  it("withholds a drifted Trellis Brief, then refreshes it with the old Brief CAS digest", () => {
    const current = fixture();
    const sessionId = "session-trellis-source-drift";
    const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
    const firstSourceSha256 = currentTrellisSourceSha256(current.projectDir, sessionId);
    const firstWrite = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: "absent",
      brief: brief("trellis_task", firstSourceSha256),
    });
    expect(firstWrite).toMatchObject({ ok: true, errorCode: "NONE" });

    writeFileSync(join(taskDir, "prd.md"), "trusted task semantics changed", "utf8");
    const driftedStatus = getRecoveryBriefProviderStatus(current.projectDir, sessionId);
    expect(driftedStatus).toMatchObject({
      provider: "trellis",
      health: "invalid",
      recoveryStatus: "invalid",
      origin: "trellis",
      task: "active",
      briefSha256: firstWrite.briefSha256,
      sourceDrift: true,
      errorCode: "TRELLIS_SOURCE_DRIFT",
    });
    expect(driftedStatus.trellisSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(driftedStatus.trellisSourceSha256).not.toBe(firstSourceSha256);
    expect(JSON.stringify(driftedStatus)).not.toContain("trusted task semantics changed");

    const refreshed = updateRecoveryBriefProvider(current.projectDir, sessionId, {
      expectedSha256: firstWrite.briefSha256!,
      brief: brief("trellis_task", driftedStatus.trellisSourceSha256!, timestamp(1)),
    });
    expect(refreshed).toMatchObject({ ok: true, errorCode: "NONE" });
    expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId)).toMatchObject({
      health: "available",
      recoveryStatus: "available",
      sourceDrift: false,
      errorCode: "NONE",
    });
  });

  for (const [index, invalidCase] of INVALID_TRELLIS_POINTER_CASES.entries()) {
    it(`keeps a generic project provider isolated when ${invalidCase.name}`, () => {
      const current = fixture();
      const sessionId = `session-trellis-${index}`;
      const turnId = `turn-trellis-${index}`;
      configureProjectRecoveryProvider(current, sessionId);

      const taskDir = createActiveTrellisTask(current.projectDir, sessionId);
      writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(
        brief("trellis_task", currentTrellisSourceSha256(current.projectDir, sessionId)),
      ), "utf8");
      expect(getRecoveryBriefProviderStatus(current.projectDir, sessionId)).toMatchObject({
        provider: "trellis",
        health: "available",
        recoveryStatus: "available",
        origin: "trellis",
        task: "active",
      });

      invalidCase.invalidate(current.projectDir, sessionId, taskDir);
      expectInvalidTrellisCheckpoint(current, sessionId, turnId, invalidCase.errorCode);
    });
  }

  it("reports origins and snapshot availability without exposing checkpoint content", () => {
    const current = fixture();
    createPendingCheckpoint(input(current.projectDir, "session-none", "turn-none"), {
      configDir: current.configDir,
      now: BASE_TIME,
    });
    writeFileSync(join(current.projectDir, "evidence.md"), "report evidence", "utf8");
    initializeProjectRecoveryBriefProvider(current.projectDir, {
      storage: "tracked",
      sourcePaths: ["evidence.md"],
    });
    const sourceHash = providerSourceHash(current.projectDir);
    updateRecoveryBriefProvider(current.projectDir, "session-project", {
      expectedSha256: "absent",
      brief: brief("explicit_project_state", sourceHash),
    });
    createPendingCheckpoint(input(current.projectDir, "session-project", "turn-project"), {
      configDir: current.configDir,
      now: new Date(BASE_TIME.getTime() + 1),
    });

    const report = getCheckpointReliabilityReport(current.projectDir, current.configDir, {
      now: new Date(BASE_TIME.getTime() + 2),
      windowDays: 1,
    });
    expect(report.recoveryBrief.snapshots).toMatchObject({ available: 1, absent: 1, invalid: 0 });
    expect(report.recoveryBrief.origins).toMatchObject({ project: 1, none: 1, trellis: 0 });
    expect(JSON.stringify(report)).not.toContain("Complete the controlled recovery workflow");
  });

  it("migrates existing checkpoint databases with a nullable recovery origin", () => {
    const current = fixture();
    const identity = resolveCheckpointIdentity(current.projectDir, current.configDir);
    const Database = loadDatabase();
    const database = new Database(identity.dbPath);
    try {
      database.exec(`
        CREATE TABLE compact_checkpoints (
          checkpoint_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          canonical_project_root TEXT NOT NULL,
          worktree_identity TEXT NOT NULL,
          state TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL,
          confirmed_at TEXT,
          claimed_at TEXT,
          expires_at TEXT NOT NULL
        )
      `);
    } finally {
      database.close();
    }

    createPendingCheckpoint(input(current.projectDir, "session-migration", "turn-migration"), {
      configDir: current.configDir,
      now: BASE_TIME,
    });
    const migrated = new Database(identity.dbPath);
    try {
      const columns = migrated.prepare("PRAGMA table_info(compact_checkpoints)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("recovery_origin");
      expect(migrated.prepare(
        "SELECT recovery_origin FROM compact_checkpoints WHERE turn_id = ?",
      ).get("turn-migration")).toEqual({ recovery_origin: "none" });
    } finally {
      migrated.close();
    }
  });
});

describe("RecoveryBrief internal bounds", () => {
  it("retains the established Brief budget for controlled providers", () => {
    expect(checkpointInternals.MAX_RECOVERY_BRIEF_BYTES).toBe(12_000);
  });
});
