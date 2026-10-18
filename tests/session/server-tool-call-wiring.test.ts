import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDB } from "../../src/session/db.js";
import { persistToolCallCounter, restoreSessionStats } from "../../src/session/persist-tool-calls.js";
import { emitSandboxExecuteEvent, emitIndexWriteEvent, emitCacheHitEvent } from "../../src/session/event-emit.js";

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, {recursive:true, force:true}); });
describe("explicit session accounting", () => {
  test("counters and events never attach to another, newer session", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-accounting-")); paths.push(root);
    const dbPath = join(root, "session.db");
    const db = new SessionDB({dbPath});
    db.ensureSession("target", root);
    db.ensureSession("other", root);
    persistToolCallCounter(dbPath, "ctx_execute", 400, "target");
    emitSandboxExecuteEvent({sessionDbPath: dbPath, sessionId:"target", toolName:"ctx_execute", bytesReturned:400});
    emitIndexWriteEvent({sessionDbPath: dbPath, sessionId:"target", source:"fixture", bytesAvoided:800});
    emitCacheHitEvent({sessionDbPath: dbPath, sessionId:"target", source:"fixture", bytesAvoided:800});
    expect(restoreSessionStats(dbPath, "target")?.bytesReturned.ctx_execute).toBe(400);
    expect(db.getToolCallStats("other").totalCalls).toBe(0);
    expect(db.getEvents("target")).toHaveLength(3);
    expect(db.getEvents("other")).toHaveLength(0);
    expect(restoreSessionStats(dbPath)).toBeNull();
    persistToolCallCounter(dbPath, "ctx_execute", 900);
    expect(db.getToolCallStats("other").totalCalls).toBe(0);
    db.close();
  });
  test("a missing database is a no-op", () => {
    expect(restoreSessionStats("/not-existing/cm.db", "target")).toBeNull();
    expect(() => persistToolCallCounter("/not-existing/cm.db", "ctx_search", 100, "target")).not.toThrow();
  });
});
