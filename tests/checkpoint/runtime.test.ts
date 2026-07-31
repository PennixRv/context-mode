import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkpointInternals,
  claimConfirmedCheckpointContext,
  confirmPendingCheckpoint,
  createPendingCheckpoint,
  getCheckpointReliabilityReport,
  readTrellisEvidence,
  recordPromptCheckpointSignal,
  recordToolCheckpointSignal,
  resolveCheckpointIdentity,
} from "../../src/checkpoint/runtime.js";
import { loadDatabase } from "../../src/db-base.js";
import type {
  CheckpointHookInput,
  CheckpointPayload,
  CheckpointRow,
  RecoveryBrief,
  RecoveryBriefFact,
} from "../../src/checkpoint/types.js";

const BASE_TIME = new Date("2026-07-30T00:00:00.000Z");
const CLEANUP_DIRS: string[] = [];

interface RuntimeFixture {
  configDir: string;
  projectDir: string;
  rootDir: string;
}

interface TestDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

function at(milliseconds: number): Date {
  return new Date(BASE_TIME.getTime() + milliseconds);
}

function createFixture(): RuntimeFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "context-mode-checkpoint-"));
  const projectDir = join(rootDir, "project");
  const configDir = join(rootDir, "codex-home");
  mkdirSync(projectDir, { recursive: true });
  CLEANUP_DIRS.push(rootDir);
  return { rootDir, projectDir, configDir };
}

function hookInput(
  projectDir: string,
  sessionId = "session-1",
  turnId = "turn-1",
  trigger: "manual" | "auto" = "manual",
): CheckpointHookInput {
  return {
    cwd: projectDir,
    session_id: sessionId,
    turn_id: turnId,
    trigger,
  };
}

function openDatabase(configDir: string, projectDir: string): TestDatabase {
  const identity = resolveCheckpointIdentity(projectDir, configDir);
  const Database = loadDatabase();
  return new Database(identity.dbPath) as unknown as TestDatabase;
}

function checkpointRow(
  configDir: string,
  projectDir: string,
  sessionId: string,
  turnId: string,
): CheckpointRow | undefined {
  const database = openDatabase(configDir, projectDir);
  try {
    return database.prepare(
      "SELECT * FROM compact_checkpoints WHERE session_id = ? AND turn_id = ?",
    ).get(sessionId, turnId) as CheckpointRow | undefined;
  } finally {
    database.close();
  }
}

function checkpointCount(configDir: string, projectDir: string): number {
  const database = openDatabase(configDir, projectDir);
  try {
    return (database.prepare("SELECT COUNT(*) AS count FROM compact_checkpoints").get() as { count: number }).count;
  } finally {
    database.close();
  }
}

function recoveryFact(
  value: string,
  priority: RecoveryBriefFact["priority"],
): RecoveryBriefFact {
  return {
    value,
    priority,
    source_kind: "trellis_task",
    source_sha256: "a".repeat(64),
    valid_at: "2026-07-30T00:00:00.000Z",
  };
}

function recoveryBrief(overrides: Partial<RecoveryBrief> = {}): RecoveryBrief {
  return {
    schema_version: 1,
    updated_at: "2026-07-30T00:00:00.000Z",
    objective: recoveryFact("Finish the checkpoint recovery implementation", "critical"),
    hard_constraints: [recoveryFact("Keep CheckpointPayload v1 unchanged", "critical")],
    decisions: [recoveryFact("Trellis owns semantic source state", "important")],
    completed_work: [recoveryFact("Delivery telemetry is complete", "optional")],
    open_work: [recoveryFact("Add RecoveryBrief snapshot tests", "important")],
    latest_blocker: null,
    next_action: recoveryFact("Run isolated quality validation", "critical"),
    project_state: recoveryFact("Worktree is intentionally dirty", "important"),
    ...overrides,
  };
}

function createActiveTrellisTask(
  fixture: RuntimeFixture,
  sessionId: string,
  taskName = "task-recovery-brief",
): string {
  const trellisRoot = join(fixture.projectDir, ".trellis");
  const taskDir = join(trellisRoot, "tasks", taskName);
  const runtimeDir = join(trellisRoot, ".runtime", "sessions");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({
    current_task: `tasks/${taskName}`,
  }), "utf8");
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({
    id: taskName,
    status: "in_progress",
    phase: "implement",
  }), "utf8");
  return taskDir;
}

function parseCheckpointContext(context: string): Record<string, unknown> {
  const match = context.match(/```json\n([\s\S]+)\n```$/);
  if (!match) throw new Error("checkpoint context did not include JSON");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

afterEach(() => {
  while (CLEANUP_DIRS.length > 0) {
    rmSync(CLEANUP_DIRS.pop()!, { recursive: true, force: true });
  }
});

describe("confirmed Codex compaction checkpoints", () => {
  it("creates one immutable pending checkpoint without retaining prompt or tool content", () => {
    const fixture = createFixture();
    const input = hookInput(fixture.projectDir);
    const rawPrompt = "PROMPT-SECRET-DO-NOT-PERSIST";
    const rawCommand = "TOOL-SECRET-DO-NOT-PERSIST";

    expect(recordPromptCheckpointSignal({ ...input, prompt: rawPrompt } as CheckpointHookInput, {
      configDir: fixture.configDir,
      now: at(0),
    })).toBe(true);
    expect(recordToolCheckpointSignal({
      ...input,
      tool_name: "Bash",
      tool_input: { command: rawCommand },
      tool_output: { is_error: true, output: rawCommand },
    }, {
      configDir: fixture.configDir,
      now: at(1),
    })).toBe(true);

    const created = createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(2) });
    const replayed = createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(3) });

    expect(created?.state).toBe("pending");
    expect(replayed?.checkpoint_id).toBe(created?.checkpoint_id);
    expect(checkpointCount(fixture.configDir, fixture.projectDir)).toBe(1);

    const database = openDatabase(fixture.configDir, fixture.projectDir);
    try {
      const stored = database.prepare(
        "SELECT payload_json FROM compact_checkpoints WHERE checkpoint_id = ?",
      ).get(created?.checkpoint_id) as { payload_json: string };
      const signals = database.prepare(
        "SELECT tool_kind, outcome, path_or_command_digest FROM checkpoint_signals",
      ).all() as Array<{
        tool_kind: string | null;
        outcome: string;
        path_or_command_digest: string | null;
      }>;

      expect(stored.payload_json).not.toContain(rawPrompt);
      expect(stored.payload_json).not.toContain(rawCommand);
      expect(JSON.stringify(signals)).not.toContain(rawPrompt);
      expect(JSON.stringify(signals)).not.toContain(rawCommand);
      expect(signals).toContainEqual({
        tool_kind: "Bash",
        outcome: "error",
        path_or_command_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    } finally {
      database.close();
    }
  });

  it("confirms only the exact PostCompact trigger and claims context once", () => {
    const fixture = createFixture();
    const input = hookInput(fixture.projectDir, "session-confirm", "turn-confirm", "manual");

    createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) });
    expect(confirmPendingCheckpoint({ ...input, trigger: "auto" }, {
      configDir: fixture.configDir,
      now: at(1),
    })).toBe(false);
    expect(checkpointRow(fixture.configDir, fixture.projectDir, "session-confirm", "turn-confirm")?.state).toBe("pending");

    expect(confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(2) })).toBe(true);
    const firstContext = claimConfirmedCheckpointContext(input, {
      configDir: fixture.configDir,
      now: at(3),
    });
    const secondContext = claimConfirmedCheckpointContext(input, {
      configDir: fixture.configDir,
      now: at(4),
    });

    expect(firstContext).toContain("Confirmed checkpoint.");
    expect(secondContext).toBe("");
    expect(checkpointRow(fixture.configDir, fixture.projectDir, "session-confirm", "turn-confirm")?.state).toBe("claimed");

    const database = openDatabase(fixture.configDir, fixture.projectDir);
    try {
      const metric = database.prepare(`
        SELECT projection_mode, emitted_bytes
        FROM checkpoint_delivery_metrics
      `).get() as { projection_mode: string; emitted_bytes: number };
      expect(metric).toEqual({
        projection_mode: "full",
        emitted_bytes: Buffer.byteLength(firstContext, "utf8"),
      });
    } finally {
      database.close();
    }
  });

  it("expires unclaimed records after 24 hours and removes aged audit data after 30 days", () => {
    const fixture = createFixture();
    const input = hookInput(fixture.projectDir, "session-expiry", "turn-expiry");

    createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) });
    expect(claimConfirmedCheckpointContext(input, {
      configDir: fixture.configDir,
      now: at(checkpointInternals.CHECKPOINT_TTL_MS + 1),
    })).toBe("");
    expect(checkpointRow(fixture.configDir, fixture.projectDir, "session-expiry", "turn-expiry")?.state).toBe("expired");

    claimConfirmedCheckpointContext(input, {
      configDir: fixture.configDir,
      now: at(checkpointInternals.AUDIT_RETENTION_MS + 1),
    });

    const database = openDatabase(fixture.configDir, fixture.projectDir);
    try {
      expect((database.prepare("SELECT COUNT(*) AS count FROM compact_checkpoints").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) AS count FROM checkpoint_transitions").get() as { count: number }).count).toBe(0);
      expect((database.prepare("SELECT COUNT(*) AS count FROM checkpoint_signals").get() as { count: number }).count).toBe(0);
    } finally {
      database.close();
    }
  });

  it("isolates checkpoints by session, project, and Git worktree", () => {
    const fixture = createFixture();
    const secondaryProjectDir = join(fixture.rootDir, "secondary-project");
    const worktreeDir = join(fixture.rootDir, "worktree");
    mkdirSync(secondaryProjectDir, { recursive: true });
    writeFileSync(join(fixture.projectDir, "tracked.txt"), "tracked\n", "utf8");
    execFileSync("git", ["init", "--quiet", fixture.projectDir]);
    execFileSync("git", ["-C", fixture.projectDir, "config", "user.email", "checkpoint@example.test"]);
    execFileSync("git", ["-C", fixture.projectDir, "config", "user.name", "Checkpoint Test"]);
    execFileSync("git", ["-C", fixture.projectDir, "add", "tracked.txt"]);
    execFileSync("git", ["-C", fixture.projectDir, "commit", "--quiet", "-m", "initial"]);
    execFileSync("git", ["-C", fixture.projectDir, "worktree", "add", "--quiet", "--detach", worktreeDir]);

    const primaryInput = hookInput(fixture.projectDir, "shared-session", "shared-turn");
    const secondaryInput = hookInput(secondaryProjectDir, "shared-session", "shared-turn");
    const worktreeInput = hookInput(worktreeDir, "shared-session", "shared-turn");
    const separateSessionInput = hookInput(fixture.projectDir, "other-session", "shared-turn");
    for (const input of [primaryInput, secondaryInput, worktreeInput, separateSessionInput]) {
      createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) });
      expect(confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(1) })).toBe(true);
    }

    const primaryIdentity = resolveCheckpointIdentity(fixture.projectDir, fixture.configDir);
    const secondaryIdentity = resolveCheckpointIdentity(secondaryProjectDir, fixture.configDir);
    const worktreeIdentity = resolveCheckpointIdentity(worktreeDir, fixture.configDir);
    expect(new Set([
      primaryIdentity.dbPath,
      secondaryIdentity.dbPath,
      worktreeIdentity.dbPath,
    ]).size).toBe(3);

    expect(claimConfirmedCheckpointContext(primaryInput, { configDir: fixture.configDir, now: at(2) })).not.toBe("");
    expect(checkpointRow(fixture.configDir, fixture.projectDir, "shared-session", "shared-turn")?.state).toBe("claimed");
    expect(checkpointRow(fixture.configDir, fixture.projectDir, "other-session", "shared-turn")?.state).toBe("confirmed");
    expect(checkpointRow(fixture.configDir, secondaryProjectDir, "shared-session", "shared-turn")?.state).toBe("confirmed");
    expect(checkpointRow(fixture.configDir, worktreeDir, "shared-session", "shared-turn")?.state).toBe("confirmed");
  });

  it("claims confirmed checkpoints in FIFO order for a session", () => {
    const fixture = createFixture();
    const firstInput = hookInput(fixture.projectDir, "session-fifo", "turn-first");
    const secondInput = hookInput(fixture.projectDir, "session-fifo", "turn-second");
    for (const [index, input] of [firstInput, secondInput].entries()) {
      createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(index) });
      confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(index + 10) });
    }

    const firstRow = checkpointRow(fixture.configDir, fixture.projectDir, "session-fifo", "turn-first")!;
    const secondRow = checkpointRow(fixture.configDir, fixture.projectDir, "session-fifo", "turn-second")!;
    expect(firstRow.sequence).toBeLessThan(secondRow.sequence);

    const firstContext = claimConfirmedCheckpointContext(firstInput, { configDir: fixture.configDir, now: at(20) });
    const secondContext = claimConfirmedCheckpointContext(secondInput, { configDir: fixture.configDir, now: at(21) });
    expect(firstContext).toContain(firstRow.checkpoint_id);
    expect(secondContext).toContain(secondRow.checkpoint_id);
  });

  it("rejects a Trellis pointer outside .trellis and caps deterministic context rendering", () => {
    const fixture = createFixture();
    const sessionId = "session-trellis";
    const trellisRoot = join(fixture.projectDir, ".trellis");
    const runtimeDir = join(trellisRoot, ".runtime", "sessions");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({
      current_task: "../../outside-trellis",
    }), "utf8");

    expect(readTrellisEvidence(fixture.projectDir, sessionId)).toMatchObject({
      bridgeStatus: "stale",
      task: "absent",
      artifacts: [],
    });

    const longSegments = Array.from({ length: 8 }, () => "x".repeat(48));
    const taskRelativePath = join("tasks", ...longSegments);
    const taskDir = join(trellisRoot, taskRelativePath);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({
      current_task: `.trellis/${taskRelativePath}`,
    }), "utf8");
    writeFileSync(join(taskDir, "task.json"), JSON.stringify({
      id: "task-checkpoint",
      status: "in_progress",
      phase: "implement",
    }), "utf8");
    for (const artifactName of ["prd.md", "design.md", "implement.md", "check.md"]) {
      writeFileSync(join(taskDir, artifactName), "ARTIFACT-SECRET-DO-NOT-PERSIST", "utf8");
    }

    const input = hookInput(fixture.projectDir, sessionId, "turn-trellis");
    for (let index = 0; index < 8; index += 1) {
      recordToolCheckpointSignal({
        ...input,
        tool_name: "Bash",
        tool_input: { command: `TOOL-SECRET-${index}` },
        tool_output: { ok: true },
      }, {
        configDir: fixture.configDir,
        now: at(index),
      });
    }
    createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(20) });
    const row = checkpointRow(fixture.configDir, fixture.projectDir, sessionId, "turn-trellis")!;
    const payload = JSON.parse(row.payload_json);
    const firstRender = checkpointInternals.fitContext(payload, row);
    const secondRender = checkpointInternals.fitContext(payload, row);

    expect(payload.trellis.artifacts).toHaveLength(4);
    expect(firstRender).toBe(secondRender);
    expect(Buffer.byteLength(firstRender, "utf8")).toBeLessThanOrEqual(checkpointInternals.MAX_ADDITIONAL_CONTEXT_BYTES);
    expect(firstRender).not.toContain("ARTIFACT-SECRET-DO-NOT-PERSIST");
    expect(firstRender).not.toContain("TOOL-SECRET-");
  });

  it("snapshots a valid active-task RecoveryBrief without changing CheckpointPayload", () => {
    const fixture = createFixture();
    const sessionId = "session-recovery-snapshot";
    const input = hookInput(fixture.projectDir, sessionId, "turn-recovery-snapshot");
    const taskDir = createActiveTrellisTask(fixture, sessionId);
    const firstBrief = recoveryBrief({
      objective: recoveryFact("RECOVERY-BRIEF-OBJECTIVE-A", "critical"),
      next_action: recoveryFact("RECOVERY-BRIEF-NEXT-A", "critical"),
    });
    writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(firstBrief), "utf8");

    const created = createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) })!;
    const payload = JSON.parse(created.payload_json) as CheckpointPayload;

    expect(created.recovery_status).toBe("available");
    expect(created.recovery_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(created.recovery_json).toContain("RECOVERY-BRIEF-OBJECTIVE-A");
    expect(payload).not.toHaveProperty("recovery_brief");
    expect(JSON.stringify(payload)).not.toContain("RECOVERY-BRIEF-OBJECTIVE-A");
    expect(Object.keys(payload).sort()).toEqual([
      "created_at",
      "git",
      "project",
      "schema_version",
      "sequence",
      "session_id",
      "signals",
      "trellis",
      "trigger",
      "turn_id",
    ]);

    const secondBrief = recoveryBrief({
      objective: recoveryFact("RECOVERY-BRIEF-OBJECTIVE-B", "critical"),
      next_action: recoveryFact("RECOVERY-BRIEF-NEXT-B", "critical"),
    });
    writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(secondBrief), "utf8");
    expect(confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(1) })).toBe(true);

    const context = claimConfirmedCheckpointContext(input, { configDir: fixture.configDir, now: at(2) });
    const projected = parseCheckpointContext(context);
    expect(context).toContain("RECOVERY-BRIEF-OBJECTIVE-A");
    expect(context).not.toContain("RECOVERY-BRIEF-OBJECTIVE-B");
    expect(projected.recovery_brief).toMatchObject({
      status: "available",
      snapshot_sha256: created.recovery_sha256,
      objective: { value: "RECOVERY-BRIEF-OBJECTIVE-A", priority: "critical" },
      next_action: { value: "RECOVERY-BRIEF-NEXT-A", priority: "critical" },
    });
  });

  it("records invalid and untrusted RecoveryBriefs without persisting their bodies", () => {
    const fixture = createFixture();
    const invalidInput = hookInput(fixture.projectDir, "session-recovery-invalid", "turn-recovery-invalid");
    const invalidTaskDir = createActiveTrellisTask(fixture, "session-recovery-invalid", "task-invalid");
    const malformedText = "MALFORMED-RECOVERY-BRIEF-SECRET";
    writeFileSync(join(invalidTaskDir, "recovery-brief.json"), malformedText, "utf8");

    const invalid = createPendingCheckpoint(invalidInput, { configDir: fixture.configDir, now: at(0) })!;
    expect(invalid.recovery_status).toBe("invalid");
    expect(invalid.recovery_json).toBeNull();
    expect(invalid.recovery_sha256).toBeNull();
    expect(invalid.payload_json).not.toContain(malformedText);
    expect(confirmPendingCheckpoint(invalidInput, { configDir: fixture.configDir, now: at(1) })).toBe(true);
    expect(claimConfirmedCheckpointContext(invalidInput, { configDir: fixture.configDir, now: at(2) })).not.toContain(malformedText);

    const schemaInput = hookInput(fixture.projectDir, "session-recovery-schema", "turn-recovery-schema");
    const schemaTaskDir = createActiveTrellisTask(fixture, "session-recovery-schema", "task-schema-invalid");
    writeFileSync(join(schemaTaskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: {
        ...recoveryFact("SCHEMA-INVALID-RECOVERY-BRIEF-SECRET", "critical"),
        source_sha256: "invalid",
      },
    })), "utf8");
    const invalidSchema = createPendingCheckpoint(schemaInput, { configDir: fixture.configDir, now: at(3) })!;
    expect(invalidSchema.recovery_status).toBe("invalid");
    expect(invalidSchema.recovery_json).toBeNull();
    expect(invalidSchema.payload_json).not.toContain("SCHEMA-INVALID-RECOVERY-BRIEF-SECRET");

    const outsideRecoveryPath = join(fixture.rootDir, "outside-recovery-brief.json");
    writeFileSync(outsideRecoveryPath, JSON.stringify(recoveryBrief({
      objective: recoveryFact("OUTSIDE-RECOVERY-BRIEF-SECRET", "critical"),
    })), "utf8");
    const symlinkInput = hookInput(fixture.projectDir, "session-recovery-symlink", "turn-recovery-symlink");
    const symlinkTaskDir = createActiveTrellisTask(fixture, "session-recovery-symlink", "task-symlink");
    symlinkSync(outsideRecoveryPath, join(symlinkTaskDir, "recovery-brief.json"));

    const symlinked = createPendingCheckpoint(symlinkInput, { configDir: fixture.configDir, now: at(4) })!;
    expect(symlinked.recovery_status).toBe("invalid");
    expect(symlinked.recovery_json).toBeNull();
    expect(symlinked.payload_json).not.toContain("OUTSIDE-RECOVERY-BRIEF-SECRET");
  });

  it("rejects a RecoveryBrief task pointer outside .trellis", () => {
    const fixture = createFixture();
    const sessionId = "session-recovery-outside";
    const runtimeDir = join(fixture.projectDir, ".trellis", ".runtime", "sessions");
    const outsideTaskDir = join(fixture.rootDir, "outside-task");
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(outsideTaskDir, { recursive: true });
    writeFileSync(join(outsideTaskDir, "task.json"), "{}", "utf8");
    writeFileSync(join(outsideTaskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: recoveryFact("OUTSIDE-POINTER-SECRET", "critical"),
    })), "utf8");
    writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({
      current_task: outsideTaskDir,
    }), "utf8");

    const row = createPendingCheckpoint(
      hookInput(fixture.projectDir, sessionId, "turn-recovery-outside"),
      { configDir: fixture.configDir, now: at(0) },
    )!;
    expect(row.recovery_status).toBe("invalid");
    expect(row.recovery_json).toBeNull();
    expect(row.payload_json).not.toContain("OUTSIDE-POINTER-SECRET");
  });

  it("isolates RecoveryBrief snapshots by session-specific active task pointers", () => {
    const fixture = createFixture();
    const alphaInput = hookInput(fixture.projectDir, "session-recovery-alpha", "turn-recovery-alpha");
    const betaInput = hookInput(fixture.projectDir, "session-recovery-beta", "turn-recovery-beta");
    const alphaTaskDir = createActiveTrellisTask(fixture, "session-recovery-alpha", "task-alpha");
    const betaTaskDir = createActiveTrellisTask(fixture, "session-recovery-beta", "task-beta");
    writeFileSync(join(alphaTaskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: recoveryFact("ALPHA-SESSION-ONLY", "critical"),
    })), "utf8");
    writeFileSync(join(betaTaskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: recoveryFact("BETA-SESSION-ONLY", "critical"),
    })), "utf8");

    for (const [index, input] of [alphaInput, betaInput].entries()) {
      createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(index) });
      expect(confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(index + 10) })).toBe(true);
    }

    const alphaContext = claimConfirmedCheckpointContext(alphaInput, {
      configDir: fixture.configDir,
      now: at(20),
    });
    const betaContext = claimConfirmedCheckpointContext(betaInput, {
      configDir: fixture.configDir,
      now: at(21),
    });
    expect(alphaContext).toContain("ALPHA-SESSION-ONLY");
    expect(alphaContext).not.toContain("BETA-SESSION-ONLY");
    expect(betaContext).toContain("BETA-SESSION-ONLY");
    expect(betaContext).not.toContain("ALPHA-SESSION-ONLY");
  });

  it("migrates legacy checkpoint databases and leaves legacy RecoveryBrief context absent", () => {
    const fixture = createFixture();
    const identity = resolveCheckpointIdentity(fixture.projectDir, fixture.configDir);
    const Database = loadDatabase();
    const database = new Database(identity.dbPath) as unknown as TestDatabase;
    const legacyPayload: CheckpointPayload = {
      schema_version: 1,
      created_at: "2026-07-30T00:00:00.000Z",
      session_id: "legacy-session",
      turn_id: "legacy-turn",
      sequence: 1,
      trigger: "manual",
      project: {
        canonical_root: identity.canonicalProjectRoot,
        project_sha256: identity.projectHash,
        worktree_sha256: identity.worktreeHash,
      },
      git: {
        availability: "unavailable",
        head: null,
        branch: null,
        statusDigest: null,
        changedPaths: [],
        changedPathCount: 0,
        omittedChangedPathCount: 0,
      },
      signals: [],
      trellis: {
        bridgeStatus: "absent",
        task: "absent",
        taskId: null,
        taskStatus: null,
        taskPhase: null,
        updatedAt: null,
        artifacts: [],
        omittedArtifactCount: 0,
      },
    };
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
      const serializedPayload = JSON.stringify(legacyPayload);
      database.prepare(`
        INSERT INTO compact_checkpoints (
          checkpoint_id, schema_version, session_id, turn_id, sequence, trigger,
          canonical_project_root, worktree_identity, state, payload_json, payload_sha256,
          created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "legacy-checkpoint",
        1,
        "legacy-session",
        "legacy-turn",
        1,
        "manual",
        identity.canonicalProjectRoot,
        identity.worktreeIdentity,
        "confirmed",
        serializedPayload,
        checkpointInternals.sha256(serializedPayload),
        legacyPayload.created_at,
        "2026-07-31T00:00:00.000Z",
      );
    } finally {
      database.close();
    }

    const migrated = new checkpointInternals.CheckpointDB(identity.dbPath);
    migrated.close();
    const migratedDatabase = openDatabase(fixture.configDir, fixture.projectDir);
    try {
      const columns = migratedDatabase.prepare("PRAGMA table_info(compact_checkpoints)").all() as Array<{ name: string }>;
      const row = migratedDatabase.prepare("SELECT * FROM compact_checkpoints WHERE checkpoint_id = ?")
        .get("legacy-checkpoint") as CheckpointRow;
      const context = checkpointInternals.fitContextDelivery(legacyPayload, row).additionalContext;

      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "recovery_json",
        "recovery_sha256",
        "recovery_status",
      ]));
      expect(row.recovery_json).toBeNull();
      expect(row.recovery_sha256).toBeNull();
      expect(row.recovery_status).toBeNull();
      expect(context).not.toContain("recovery_brief");
    } finally {
      migratedDatabase.close();
    }
  });

  it("prunes whole RecoveryBrief facts by priority and falls back when critical facts cannot fit", () => {
    const fixture = createFixture();
    const sessionId = "session-recovery-budget";
    const input = hookInput(fixture.projectDir, sessionId, "turn-recovery-budget");
    const taskDir = createActiveTrellisTask(fixture, sessionId, "task-recovery-budget");
    const optionalValue = `OPTIONAL-${"o".repeat(440)}`;
    const decisionValue = `DECISION-${"d".repeat(440)}`;
    const openWorkValue = `OPEN-WORK-${"w".repeat(440)}`;
    const criticalValue = `CRITICAL-${"c".repeat(160)}`;
    writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: recoveryFact(criticalValue, "critical"),
      completed_work: [recoveryFact(optionalValue, "optional")],
      decisions: [recoveryFact(decisionValue, "important")],
      open_work: [recoveryFact(openWorkValue, "important")],
    })), "utf8");

    const row = createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) })!;
    const payload = JSON.parse(row.payload_json) as CheckpointPayload;
    const pruned = checkpointInternals.fitContextDelivery(payload, row);
    expect(pruned.projectionMode).toBe("pruned");
    expect(pruned.additionalContext).not.toContain(optionalValue);
    expect(pruned.additionalContext).not.toContain(decisionValue);
    expect(pruned.additionalContext).not.toContain(openWorkValue);
    expect(pruned.additionalContext).toContain(criticalValue);
    expect(pruned.emittedBytes).toBeLessThanOrEqual(checkpointInternals.MAX_ADDITIONAL_CONTEXT_BYTES);

    const oversizedCritical = `CRITICAL-UNFIT-${"x".repeat(490)}`;
    writeFileSync(join(taskDir, "recovery-brief.json"), JSON.stringify(recoveryBrief({
      objective: recoveryFact(oversizedCritical, "critical"),
      hard_constraints: [recoveryFact(oversizedCritical, "critical")],
      latest_blocker: recoveryFact(oversizedCritical, "critical"),
      next_action: recoveryFact(oversizedCritical, "critical"),
      decisions: [],
      completed_work: [],
      open_work: [],
      project_state: null,
    })), "utf8");
    const oversizedInput = hookInput(fixture.projectDir, sessionId, "turn-recovery-budget-critical");
    const oversizedRow = createPendingCheckpoint(oversizedInput, { configDir: fixture.configDir, now: at(1) })!;
    const oversizedPayload = JSON.parse(oversizedRow.payload_json) as CheckpointPayload;
    const idOnly = checkpointInternals.fitContextDelivery(oversizedPayload, oversizedRow);

    expect(idOnly.projectionMode).toBe("id_only");
    expect(idOnly.additionalContext).not.toContain(oversizedCritical.slice(0, 64));
    expect(idOnly.additionalContext).toContain('"status":"not_applicable"');
    expect(idOnly.emittedBytes).toBeLessThanOrEqual(checkpointInternals.MAX_ADDITIONAL_CONTEXT_BYTES);
  });

  it("records full, pruned, and identifier-only delivery projections", () => {
    const fixture = createFixture();
    const input = hookInput(fixture.projectDir, "session-projection", "turn-projection");
    const row = createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) })!;
    const payload = JSON.parse(row.payload_json) as CheckpointPayload;

    const full = checkpointInternals.fitContextDelivery(payload, row);
    const pruned = checkpointInternals.fitContextDelivery({
      ...payload,
      signals: Array.from({ length: 8 }, () => ({
        kind: "tool_completed" as const,
        tool_kind: "Bash",
        outcome: "success" as const,
        digest: "d".repeat(240),
      })),
    }, row);
    const idOnly = checkpointInternals.fitContextDelivery({
      ...payload,
      git: {
        ...payload.git,
        head: "h".repeat(checkpointInternals.MAX_ADDITIONAL_CONTEXT_BYTES * 2),
      },
    }, row);

    expect(full.projectionMode).toBe("full");
    expect(pruned.projectionMode).toBe("pruned");
    expect(idOnly.projectionMode).toBe("id_only");
    for (const delivery of [full, pruned, idOnly]) {
      expect(delivery.emittedBytes).toBe(Buffer.byteLength(delivery.additionalContext, "utf8"));
      expect(delivery.emittedBytes).toBeLessThanOrEqual(checkpointInternals.MAX_ADDITIONAL_CONTEXT_BYTES);
    }
  });

  it("summarizes delivery reliability without reading raw checkpoint evidence", () => {
    const fixture = createFixture();
    const claimedInput = hookInput(fixture.projectDir, "session-report", "turn-claimed", "manual");
    const confirmedInput = hookInput(fixture.projectDir, "session-report", "turn-confirmed", "auto");
    const pendingInput = hookInput(fixture.projectDir, "session-report", "turn-pending", "manual");
    const rawPrompt = "REPORT-PROMPT-SECRET";
    const rawCommand = "REPORT-COMMAND-SECRET";

    recordPromptCheckpointSignal({ ...claimedInput, prompt: rawPrompt } as CheckpointHookInput, {
      configDir: fixture.configDir,
      now: at(0),
    });
    recordToolCheckpointSignal({
      ...claimedInput,
      tool_name: "Bash",
      tool_input: { command: rawCommand },
      tool_output: { is_error: true },
    }, {
      configDir: fixture.configDir,
      now: at(1),
    });
    createPendingCheckpoint(claimedInput, { configDir: fixture.configDir, now: at(10) });
    confirmPendingCheckpoint(claimedInput, { configDir: fixture.configDir, now: at(20) });
    claimConfirmedCheckpointContext(claimedInput, { configDir: fixture.configDir, now: at(50) });

    createPendingCheckpoint(confirmedInput, { configDir: fixture.configDir, now: at(100) });
    confirmPendingCheckpoint(confirmedInput, { configDir: fixture.configDir, now: at(200) });
    createPendingCheckpoint(pendingInput, { configDir: fixture.configDir, now: at(300) });

    const report = getCheckpointReliabilityReport(fixture.projectDir, fixture.configDir, {
      now: at(checkpointInternals.CHECKPOINT_TTL_MS + 1_000),
    });

    expect(report.available).toBe(true);
    expect(report.total).toMatchObject({
      checkpointCount: 3,
      stateCounts: { pending: 1, confirmed: 1, claimed: 1 },
      confirmationRate: 2 / 3,
      claimRate: 1 / 2,
    });
    expect(report.byTrigger.manual).toMatchObject({ checkpointCount: 2, claimRate: 1 });
    expect(report.byTrigger.auto).toMatchObject({ checkpointCount: 1, claimRate: 0 });
    expect(report.latencyMs.createdToConfirmed).toEqual({ sampleCount: 2, p50Ms: 10, p95Ms: 100 });
    expect(report.latencyMs.confirmedToClaimed).toEqual({ sampleCount: 1, p50Ms: 30, p95Ms: 30 });
    expect(report.delivery).toMatchObject({ full: 1, pruned: 0, idOnly: 0, unknown: 0 });
    expect(report.overduePendingCount).toBe(1);
    expect(report.warnings).toContain("Pending checkpoints exceeded their TTL and await lifecycle cleanup.");
    expect(JSON.stringify(report)).not.toContain(rawPrompt);
    expect(JSON.stringify(report)).not.toContain(rawCommand);
  });

  it("keeps reports read-only and handles checkpoint databases without delivery telemetry", () => {
    const fixture = createFixture();
    const noDatabaseReport = getCheckpointReliabilityReport(fixture.projectDir, fixture.configDir, {
      now: at(0),
    });
    expect(noDatabaseReport.available).toBe(false);
    expect(noDatabaseReport.warnings).toContain("No checkpoint database exists for this project worktree.");
    expect(existsSync(join(fixture.configDir, "context-mode", "checkpoints"))).toBe(false);

    const input = hookInput(fixture.projectDir, "session-legacy", "turn-legacy");
    createPendingCheckpoint(input, { configDir: fixture.configDir, now: at(0) });
    confirmPendingCheckpoint(input, { configDir: fixture.configDir, now: at(1) });
    claimConfirmedCheckpointContext(input, { configDir: fixture.configDir, now: at(2) });

    const database = openDatabase(fixture.configDir, fixture.projectDir);
    try {
      database.exec("DROP TABLE checkpoint_delivery_metrics");
    } finally {
      database.close();
    }

    const legacyReport = getCheckpointReliabilityReport(fixture.projectDir, fixture.configDir, {
      now: at(3),
    });
    expect(legacyReport.available).toBe(true);
    expect(legacyReport.delivery).toMatchObject({ unknown: 1, emittedBytesAverage: null });
    expect(legacyReport.warnings).toContain(
      "Delivery telemetry is unavailable until a post-upgrade checkpoint is claimed.",
    );
  });
});
