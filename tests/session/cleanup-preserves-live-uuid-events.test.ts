import { afterEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionDB } from "../../src/session/db.js";

const dbs: SessionDB[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.cleanup();
});

function createDB(): SessionDB {
  const db = new SessionDB({ dbPath: join(tmpdir(), `orphan-events-${randomUUID()}.db`) });
  dbs.push(db);
  return db;
}

function addOrphan(db: SessionDB, sessionId: string, ageDays: number): void {
  db.insertEvent(sessionId, {
    type: "tool_use",
    category: "tool",
    priority: 1,
    data: sessionId,
  }, "PostToolUse");
  db.db.prepare(
    "UPDATE session_events SET created_at = datetime('now', ?) WHERE session_id = ?",
  ).run(`-${ageDays} days`, sessionId);
}

function countEvents(db: SessionDB, sessionId: string): number {
  return Number(db.db.prepare(
    "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?",
  ).get(sessionId)?.count ?? 0);
}

describe("orphan event retention", () => {
  test("removes orphan events older than 30 days and retains recent events", () => {
    const db = createDB();
    addOrphan(db, "old-orphan", 31);
    addOrphan(db, "recent-orphan", 29);

    expect(db.pruneOrphanedEvents(30)).toBe(1);
    expect(countEvents(db, "old-orphan")).toBe(0);
    expect(countEvents(db, "recent-orphan")).toBe(1);
  });

  test("preserves the current session even when its orphaned event is old", () => {
    const db = createDB();
    const currentSessionId = "current-session";
    addOrphan(db, currentSessionId, 90);

    expect(db.pruneOrphanedEvents(30, currentSessionId)).toBe(0);
    expect(countEvents(db, currentSessionId)).toBe(1);
  });

  test("does not remove events that have session metadata", () => {
    const db = createDB();
    db.ensureSession("known-session", "/project");
    addOrphan(db, "known-session", 90);

    expect(db.pruneOrphanedEvents(30)).toBe(0);
    expect(countEvents(db, "known-session")).toBe(1);
  });
});
