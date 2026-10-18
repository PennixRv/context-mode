/**
 * purgeSession — deep module that wipes ALL session-related on-disk artifacts
 * for a single project directory.
 *
 * Every project artifact uses one canonical project hash.
 *
 * Worktree separation guarantee:
 *   Every path this module touches is derived deterministically from the input
 *   `projectDir`. There is NO `readdirSync` + glob-filter loop. Different
 *   worktrees → different physical paths → different canonical hashes →
 *   different file names → cannot collapse worktrees on disk.
 *
 * SQLite sidecar handling:
 *   Each `.db` file may be accompanied by `-wal` (write-ahead log) and `-shm`
 *   (shared memory index) sidecars. We unlink the triple unconditionally —
 *   missing sidecars are not an error. This matches the canonical SQLite
 *   sidecar naming used elsewhere (see refs/platforms/zed/crates/sqlez:
 *   `[main, "{main}-wal", "{main}-shm"]`).
 *
 * All paths are joined via `node:path.join` so Windows and POSIX separators work.
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadDatabase } from "../db-base.js";
import {
  getWorktreeSuffix,
  hashProjectDirCanonical,
  SessionDB,
} from "./db.js";

/** Canonical SQLite sidecar suffixes. The empty string is the main DB. */
const SQLITE_SIDECARS = ["", "-wal", "-shm"] as const;

export interface PurgeOpts {
  /**
   * Absolute path to the project root. Drives every other path the module
   * touches via the project-dir hash. MUST be the same string the rest of
   * the system uses (e.g. `getProjectDir()`); otherwise the wrong DB is
   * targeted. Worktree separation is preserved — only files matching
   * THIS projectDir's hash are unlinked.
   */
  projectDir: string;
  /**
   * Adapter-specific session directory (e.g. `~/.claude/context-mode/sessions`).
   * Holds: `<hash><suffix>.db`, `<hash><suffix>-events.md`,
   * `<hash><suffix>.cleanup`.
   */
  sessionsDir: string;
  /** Absolute path to this project's FTS5 database, if it exists. */
  storePath?: string;
  /**
   * Issue #520 — scoped purge.
   *
   *  - `"project"`: wipe ALL session artifacts for `projectDir`.
   *  - `"session"`: wipe ONLY the rows for `sessionId` inside the
   *    project's SessionDB plus FTS5 chunks tagged with that
   *    `session_id`. Project-wide files (events.md, content store
   *    file, stats file) are left intact. Requires `sessionId`.
   *
   */
  scope: "session" | "project";
  /**
   * Session identifier whose rows should be wiped from the project's
   * SessionDB and tagged FTS5 chunks. Only consulted when `scope ===
   * "session"`. The `session_events`, `session_meta`, and
   * `session_resume` rows for this id are removed; rows for other
   * sessions in the same DB are preserved. Match SessionDB.deleteSession
   * semantics (see src/session/db.ts).
   */
  sessionId?: string;
}

export interface PurgeResult {
  /**
   * Human-readable labels rendered to the user by the ctx_purge handler.
   * MUST stay backward-compatible with the existing UI strings:
   *   "knowledge base (FTS5)", "session events DB", "session events markdown".
   * Each label appears at most once, and only when at least one matching
   * file was actually unlinked.
   */
  deleted: string[];
  /**
   * Every full path that was successfully `unlink`ed. Surfaced for tests
   * and for diagnostic logging — NEVER shown to end users (the labels
   * above carry the human story).
   */
  wipedPaths: string[];
}

/** Try to unlink one path; report success without throwing on ENOENT etc. */
function tryUnlink(p: string, wipedPaths: string[]): boolean {
  try {
    unlinkSync(p);
    wipedPaths.push(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlink a SQLite db at `path` plus its `-wal` / `-shm` sidecars.
 * Returns true when the MAIN db file (not a sidecar) was removed.
 */
function tryUnlinkSqliteTriple(path: string, wipedPaths: string[]): boolean {
  let mainRemoved = false;
  for (const suffix of SQLITE_SIDECARS) {
    const removed = tryUnlink(`${path}${suffix}`, wipedPaths);
    if (removed && suffix === "") mainRemoved = true;
  }
  return mainRemoved;
}

/**
 * Wipe every session-related on-disk artifact for `projectDir`.
 *
 * This function never throws on missing files (a fresh install is a no-op).
 * Invalid or ambiguous scopes are rejected before any deletion.
 */
export function purgeSession(opts: PurgeOpts): PurgeResult {
  const { projectDir, sessionsDir, storePath, sessionId, scope } = opts;
  const deleted: string[] = [];
  const wipedPaths: string[] = [];

  if (scope !== "session" && scope !== "project") {
    throw new TypeError("purgeSession: an explicit session or project scope is required.");
  }
  if (scope === "project" && sessionId) {
    throw new TypeError("purgeSession: project scope must not include sessionId.");
  }
  if (scope === "session" && !sessionId) {
    throw new TypeError(
      "purgeSession: scope:'session' requires sessionId. " +
      "Pass scope:'project' for a whole-project wipe."
    );
  }

  // ── Session-scoped path (issue #520). ─────────────────────────────────
  // Wipe ONLY this sessionId's rows from the project's SessionDB. The DB
  // file itself, the events.md sidecar, the FTS5 store, and the stats
  // file are all left intact — those are project-scoped concerns. The
  // label "session rows for <id>" appears once when at least one row was
  // removed, mirroring the project-scoped UI contract.
  if (scope === "session" && sessionId) {
    const worktreeSuffix = getWorktreeSuffix(projectDir);
    let rowsRemoved = false;
    const dbPath = join(sessionsDir, `${hashProjectDirCanonical(projectDir)}${worktreeSuffix}.db`);
    if (existsSync(dbPath)) {
      let db: SessionDB | null = null;
      try {
        db = new SessionDB({ dbPath });
        const before = db.getEvents(sessionId).length;
        db.deleteSession(sessionId);
        if (before > 0) rowsRemoved = true;
      } catch {
        // Best-effort — corrupt DB is logged elsewhere; do not block purge.
      } finally {
        // close() releases the handle WITHOUT deleting the file —
        // this is what makes the scoped wipe non-destructive at the
        // file-system level. Using cleanup() here would erase the
        // entire DB (main + WAL + SHM), defeating per-session scope.
        try { db?.close(); } catch { /* best effort */ }
      }
    }
    if (rowsRemoved) deleted.push(`session rows for ${sessionId}`);

    // Per-session FTS5 chunk wipe. The chunks table has a `session_id
    // UNINDEXED` column (src/store.ts schema). The public index() path
    // currently inserts NULL — but a future per-session-tagged path
    // (e.g. tool-call indexing keyed to a session) will populate it,
    // and the SQL contract here keeps that future correct from day one.
    // Today this is a safe no-op against existing data.
    //
    // Caller is responsible for closing any persistent ContentStore
    // handle BEFORE invoking purgeSession (Windows file lock). The
    // ctx_purge handler does this via _store?.cleanup() before delegating.
    const ftsTargets: string[] = [];
    if (storePath && existsSync(storePath)) ftsTargets.push(storePath);
    let chunksRemoved = false;
    for (const path of ftsTargets) {
      try {
        const Database = loadDatabase();
        const fts = new Database(path, { timeout: 30000 });
        try {
          const before = (fts.prepare(
            "SELECT COUNT(*) AS c FROM chunks WHERE session_id = ?"
          ).get(sessionId) as { c: number }).c;
          fts.prepare("DELETE FROM chunks WHERE session_id = ?").run(sessionId);
          fts.prepare("DELETE FROM chunks_trigram WHERE session_id = ?").run(sessionId);
          if (before > 0) chunksRemoved = true;
        } finally {
          try { fts.close(); } catch { /* best effort */ }
        }
      } catch {
        // Best-effort — schema mismatch / corrupt DB / missing FTS5 must not
        // block the per-session SessionDB wipe that already succeeded.
      }
    }
    if (chunksRemoved) deleted.push(`FTS5 chunks for ${sessionId}`);

    return { deleted, wipedPaths };
  }

  // ── 1. Knowledge base FTS5 store (per-platform). ──────────────────────
  // `storePath` is resolved by the caller from the canonical project hash.
  let storeFound = false;
  if (storePath && tryUnlinkSqliteTriple(storePath, wipedPaths)) storeFound = true;
  if (storeFound) deleted.push("knowledge base (FTS5)");

  // ── 2. Session-events artifacts at the canonical project hash. ────────
  // The database, event projection, and cleanup marker share one canonical hash.
  const worktreeSuffix = getWorktreeSuffix(projectDir);
  const base = join(sessionsDir, `${hashProjectDirCanonical(projectDir)}${worktreeSuffix}`);
  const sessDbFound = tryUnlinkSqliteTriple(`${base}.db`, wipedPaths);
  const eventsFound = tryUnlink(`${base}-events.md`, wipedPaths);
  tryUnlink(`${base}.cleanup`, wipedPaths); // no user-facing label
  if (sessDbFound) deleted.push("session events DB");
  if (eventsFound) deleted.push("session events markdown");

  return { deleted, wipedPaths };
}
