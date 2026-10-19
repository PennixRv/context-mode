/** Owner-native maintenance of consumed oversized recovery caches only. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDatabase, withRetry } from "../db-base.js";
import { resolveSessionDbPath } from "./db.js";
import { CODEX_RECOVERY_MAX_BYTES } from "./snapshot.js";

interface RecoveryOptions {
  projectDir: string;
  sessionsDir: string;
  apply?: boolean;
  expectedDigest?: string;
}

interface SnapshotRow {
  id: number;
  session_id: string;
  snapshot: string;
  event_count: number;
  created_at: string;
  consumed: number;
  project_dir: string | null;
}

function verifyOwner(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || realpathSync(path) !== resolve(path) ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
    throw new Error(`Unverified recovery owner or link: ${path}`);
  }
}

/** Preview never constructs SessionDB, migrates a schema, or creates a DB. */
export function recoverSessionSnapshots(opts: RecoveryOptions) {
  if (!isAbsolute(opts.projectDir) || realpathSync(opts.projectDir) !== resolve(opts.projectDir)) throw new Error("Recovery requires a canonical absolute project path");
  const project = resolve(opts.projectDir);
  const dbPath = resolveSessionDbPath({projectDir: project, sessionsDir: opts.sessionsDir});
  if (opts.apply && !opts.expectedDigest) throw new Error("Recovery apply requires expected digest");
  const empty = {project, dbPath, budgetBytes: CODEX_RECOVERY_MAX_BYTES, candidates: [] as Array<Record<string, unknown>>, protected: [] as Array<Record<string, unknown>>};
  if (lstatSync(opts.sessionsDir, {throwIfNoEntry: false})) verifyOwner(opts.sessionsDir, true);
  if (!lstatSync(dbPath, {throwIfNoEntry: false})) {
    if (opts.apply) throw new Error("Recovery target database missing; preview again");
    return {...empty, digest: createHash("sha256").update(JSON.stringify(empty)).digest("hex"), deleted: 0, logicalBytesRemoved: 0, databaseBytes: 0};
  }
  verifyOwner(opts.sessionsDir, true);
  verifyOwner(dbPath, false);
  for (const suffix of ["-wal", "-shm"]) if (lstatSync(dbPath + suffix, {throwIfNoEntry: false})) verifyOwner(dbPath + suffix, false);
  const identity = statSync(dbPath);
  const hasWal = existsSync(dbPath + "-wal");
  const hasShm = existsSync(dbPath + "-shm");
  if (hasWal !== hasShm || existsSync(dbPath + "-journal")) throw new Error("Recovery database activity unknown; preview again");
  // A read-only WAL open can create sidecars. A settled DB uses SQLite's
  // immutable read path; reject it if a writer appears during the preview.
  const immutable = !opts.apply && !hasWal;
  const Database = loadDatabase();
  const db = new Database(immutable ? pathToFileURL(dbPath).href + "?mode=ro&immutable=1" : dbPath, {readonly: !opts.apply, timeout: 30000});
  try {
    db.pragma("query_only = " + (opts.apply ? "OFF" : "ON"));
    const verifyIdentity = () => {
      verifyOwner(dbPath, false);
      const current = statSync(dbPath);
      if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("Recovery database identity changed");
      if (immutable && (existsSync(dbPath + "-wal") || existsSync(dbPath + "-shm") || existsSync(dbPath + "-journal") || current.mtimeMs !== identity.mtimeMs || current.size !== identity.size)) throw new Error("Recovery database became active; preview again");
      return current;
    };
    const inspect = () => {
      const current = verifyIdentity();
      const check = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
      if (check.length !== 1 || Object.values(check[0])[0] !== "ok") throw new Error("Recovery database integrity unknown");
      const rows = db.prepare("SELECT r.*, m.project_dir FROM session_resume r LEFT JOIN session_meta m ON m.session_id = r.session_id ORDER BY r.id").all() as SnapshotRow[];
      const candidates: Array<Record<string, unknown>> = [];
      const protectedRows: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        if (typeof row.snapshot !== "string" || typeof row.session_id !== "string" || ![0, 1].includes(row.consumed)) throw new Error("Unknown recovery row schema");
        const bytes = Buffer.byteLength(row.snapshot);
        const item = {id: row.id, sessionId: row.session_id, bytes, sha256: createHash("sha256").update(row.snapshot).digest("hex"), consumed: row.consumed, eventCount: row.event_count, createdAt: row.created_at};
        const reason = row.project_dir === null || resolve(row.project_dir) !== project ? "unknown-project" : row.consumed !== 1 ? "unconsumed" : bytes <= CODEX_RECOVERY_MAX_BYTES ? "within-budget" : null;
        if (reason) protectedRows.push({...item, reason});
        else candidates.push({...item, reason: "consumed-oversized"});
      }
      const view = {...empty, candidates, protected: protectedRows};
      const digest = createHash("sha256").update(JSON.stringify({view, device: current.dev, inode: current.ino})).digest("hex");
      verifyIdentity();
      return {view, digest, rows};
    };
    if (!opts.apply) {
      const {view, digest} = inspect();
      return {...view, digest, deleted: 0, logicalBytesRemoved: 0, databaseBytes: statSync(dbPath).size};
    }
    return withRetry(() => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const {view, digest, rows} = inspect();
        if (digest !== opts.expectedDigest) throw new Error("Recovery preview digest changed; preview again");
        let deleted = 0;
        let logicalBytesRemoved = 0;
        const remove = db.prepare("DELETE FROM session_resume WHERE id = ? AND session_id = ? AND consumed = 1 AND snapshot = ?");
        for (const candidate of view.candidates) {
          const row = rows.find(item => item.id === candidate.id)!;
          const result = remove.run(row.id, row.session_id, row.snapshot);
          if (Number(result.changes) !== 1) throw new Error("Recovery target drifted; batch rolled back");
          deleted++;
          logicalBytesRemoved += Number(candidate.bytes);
        }
        db.exec("COMMIT");
        return {...view, digest, deleted, logicalBytesRemoved, databaseBytes: statSync(dbPath).size};
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  } finally { db.close(); }
}
