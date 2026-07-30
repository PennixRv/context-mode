import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkpointInternals,
  claimConfirmedCheckpointContext,
  confirmPendingCheckpoint,
  createPendingCheckpoint,
  readTrellisEvidence,
  recordPromptCheckpointSignal,
  recordToolCheckpointSignal,
  resolveCheckpointIdentity,
} from "../../src/checkpoint/runtime.js";
import type { CheckpointHookInput, CheckpointRow } from "../../src/checkpoint/types.js";

const BASE_TIME = new Date("2026-07-30T00:00:00.000Z");
const CLEANUP_DIRS: string[] = [];

interface RuntimeFixture {
  configDir: string;
  projectDir: string;
  rootDir: string;
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

function openDatabase(configDir: string, projectDir: string): Database.Database {
  const identity = resolveCheckpointIdentity(projectDir, configDir);
  return new Database(identity.dbPath);
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
});
