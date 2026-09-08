import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  confirmPendingCheckpoint,
  createPendingCheckpoint,
  getCheckpointReliabilityReport,
  resolveCheckpointIdentity,
} from "../../src/checkpoint/runtime.js";
import { loadDatabase } from "../../src/db-base.js";
import type { CheckpointHookInput } from "../../src/checkpoint/types.js";

const BASE_TIME = new Date("2026-09-08T00:00:00.000Z");
const CLEANUP_DIRECTORIES: string[] = [];

function fixture(): { configDir: string; projectDir: string } {
  const rootDir = mkdtempSync(join(tmpdir(), "context-mode-checkpoint-"));
  const projectDir = join(rootDir, "project");
  const configDir = join(rootDir, "codex-home");
  mkdirSync(projectDir, { recursive: true });
  CLEANUP_DIRECTORIES.push(rootDir);
  return { configDir, projectDir };
}

function input(projectDir: string): CheckpointHookInput {
  return {
    cwd: projectDir,
    session_id: "session-1",
    turn_id: "turn-1",
    trigger: "manual",
  };
}

afterEach(() => {
  while (CLEANUP_DIRECTORIES.length > 0) {
    rmSync(CLEANUP_DIRECTORIES.pop()!, { recursive: true, force: true });
  }
});

describe("Codex checkpoint audit", () => {
  it("records a bounded PreCompact/PostCompact audit without a delivery path", () => {
    const current = fixture();
    const checkpoint = createPendingCheckpoint(input(current.projectDir), {
      configDir: current.configDir,
      now: BASE_TIME,
    });

    expect(checkpoint?.state).toBe("pending");
    expect(confirmPendingCheckpoint(input(current.projectDir), {
      configDir: current.configDir,
      now: new Date(BASE_TIME.getTime() + 1),
    })).toBe(true);

    const report = getCheckpointReliabilityReport(current.projectDir, current.configDir, {
      now: new Date(BASE_TIME.getTime() + 2),
    });
    expect(report.total).toMatchObject({
      checkpointCount: 1,
      confirmationRate: 1,
      stateCounts: { confirmed: 1, claimed: 0 },
    });
    expect(report).not.toHaveProperty("delivery");
    expect(report).not.toHaveProperty("diagnostics");

    const Database = loadDatabase();
    const database = new Database(resolveCheckpointIdentity(
      current.projectDir,
      current.configDir,
    ).dbPath, { readonly: true });
    try {
      const columns = database.prepare("PRAGMA table_info(compact_checkpoints)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("claimed_at");
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoint_delivery_metrics'").get()).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("reports historical claimed rows without restoring their retired behavior", () => {
    const current = fixture();
    const identity = resolveCheckpointIdentity(current.projectDir, current.configDir);
    const Database = loadDatabase();
    const database = new Database(identity.dbPath);
    try {
      database.exec(`
        CREATE TABLE compact_checkpoints (
          canonical_project_root TEXT,
          worktree_identity TEXT,
          trigger TEXT,
          state TEXT,
          created_at TEXT,
          confirmed_at TEXT,
          expires_at TEXT
        )
      `);
      database.prepare(`
        INSERT INTO compact_checkpoints (
          canonical_project_root, worktree_identity, trigger, state,
          created_at, confirmed_at, expires_at
        ) VALUES (?, ?, 'manual', 'claimed', ?, ?, ?)
      `).run(
        identity.canonicalProjectRoot,
        identity.worktreeIdentity,
        BASE_TIME.toISOString(),
        BASE_TIME.toISOString(),
        new Date(BASE_TIME.getTime() + 60_000).toISOString(),
      );
    } finally {
      database.close();
    }

    const report = getCheckpointReliabilityReport(current.projectDir, current.configDir, {
      now: new Date(BASE_TIME.getTime() + 1),
    });
    expect(report.total.stateCounts.claimed).toBe(1);
    expect(report.total.confirmationRate).toBe(1);
    expect(report).not.toHaveProperty("delivery");
  });
});
