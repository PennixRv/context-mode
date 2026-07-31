import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkpointInternals,
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

interface Fixture {
  configDir: string;
  projectDir: string;
}

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

function createActiveTrellisTask(projectDir: string, sessionId: string): string {
  const taskDir = join(projectDir, ".trellis", "tasks", "task-1");
  const runtimeDir = join(projectDir, ".trellis", ".runtime", "sessions");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({ id: "task-1" }), "utf8");
  writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({ current_task: "tasks/task-1" }), "utf8");
  return taskDir;
}

afterEach(() => {
  while (CLEANUP_DIRECTORIES.length > 0) {
    rmSync(CLEANUP_DIRECTORIES.pop()!, { recursive: true, force: true });
  }
});

describe("RecoveryBrief providers", () => {
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

  it("gives a valid Trellis pointer precedence and fails closed when that pointer becomes unsafe", () => {
    const current = fixture();
    writeFileSync(join(current.projectDir, "evidence.md"), "fallback evidence", "utf8");
    initializeProjectRecoveryBriefProvider(current.projectDir, {
      storage: "tracked",
      sourcePaths: ["evidence.md"],
    });
    const sourceHash = providerSourceHash(current.projectDir);
    expect(updateRecoveryBriefProvider(current.projectDir, "session-trellis", {
      expectedSha256: "absent",
      brief: brief("explicit_project_state", sourceHash),
    }).ok).toBe(true);

    const taskDir = createActiveTrellisTask(current.projectDir, "session-trellis");
    writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(
      brief("trellis_task", "c".repeat(64)),
    ), "utf8");
    expect(getRecoveryBriefProviderStatus(current.projectDir, "session-trellis")).toMatchObject({
      provider: "trellis",
      health: "available",
      recoveryStatus: "available",
      origin: "trellis",
      task: "active",
    });

    writeFileSync(
      join(current.projectDir, ".trellis", ".runtime", "sessions", "codex_session-trellis.json"),
      JSON.stringify({ current_task: "../../outside" }),
      "utf8",
    );
    expect(getRecoveryBriefProviderStatus(current.projectDir, "session-trellis")).toMatchObject({
      provider: "trellis",
      health: "invalid",
      recoveryStatus: "invalid",
      origin: "trellis",
      errorCode: "TRELLIS_TASK_INVALID",
    });
  });

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
