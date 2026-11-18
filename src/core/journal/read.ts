// impl/02 §11, impl/00 §4 signatures (DEVIATIONS D-M1-1: null for a missing seq, optional kind kept).
// Read-only: WAL readers never block on BEGIN IMMEDIATE writers, so no transaction here.
import type { DbHandle, EventKind, JournalRow } from "../contracts/types.ts";
import { MAX_CANDIDATES } from "../contracts/constants.ts";
import type { StateEvent } from "../compaction/candidates.ts";

/** Bounded resume projection, preserving latest-per-key state and full-history repeat counts. */
export function readResumeEvents(db: DbHandle, sessionId: string): { rows: StateEvent[]; repeatCounts: Map<number, number> } {
  const rows = new Map<number, StateEvent>();
  const repeatCounts = new Map<number, number>();
  if (sessionId === "") return { rows: [], repeatCounts };
  // Command bodies are not used by the state renderer. Prompt candidates use only the first line;
  // full seq reads and recall still use the untouched journal body.
  const fields = "e.seq, e.session_id, e.turn, e.kind, e.key, e.path, e.ok, e.tool, "
    + "CASE WHEN e.kind = 'prompt' THEN CASE WHEN instr(e.body, char(10)) > 0 THEN substr(e.body, 1, instr(e.body, char(10))-1) ELSE e.body END "
    + "WHEN e.kind = 'decision' THEN e.body ELSE '' END AS body";
  const add = (sql: string, ...args: (string | number)[]): void => {
    const found = db.raw.prepare(sql).all(...args) as unknown as (StateEvent & { repeat_count?: number })[];
    for (const row of found) {
      rows.set(row.seq, row);
      if (row.repeat_count !== undefined) repeatCounts.set(row.seq, row.repeat_count);
    }
  };
  add(`SELECT ${fields} FROM events e WHERE e.session_id = ? ORDER BY e.seq DESC LIMIT 1`, sessionId);
  const upto = [...rows.keys()][0];
  if (upto === undefined) return { rows: [], repeatCounts };
  // An append from another process between queries belongs to the next resume, not this snapshot.
  add(`SELECT ${fields} FROM events e WHERE e.session_id = ? AND e.seq <= ? AND e.kind = 'prompt' ORDER BY e.seq DESC LIMIT ?`, sessionId, upto, MAX_CANDIDATES + 1);
  add(`SELECT ${fields} FROM events e WHERE e.session_id = ? AND e.seq <= ? AND e.kind = 'index' ORDER BY e.seq DESC LIMIT ?`, sessionId, upto, MAX_CANDIDATES);
  add(`SELECT ${fields}, g.repeat_count FROM events e JOIN (
    SELECT max(seq) AS seq, sum(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS repeat_count FROM events
    WHERE session_id = ? AND seq <= ? AND kind IN ('cmd','toolerr') AND key IS NOT NULL AND ok IS NOT NULL GROUP BY key
  ) g ON e.seq = g.seq WHERE e.ok = 0 ORDER BY e.seq DESC LIMIT ?`, sessionId, upto, MAX_CANDIDATES);
  add(`SELECT ${fields}, g.repeat_count FROM events e JOIN (
    SELECT max(seq) AS seq, count(*) AS repeat_count FROM events
    WHERE session_id = ? AND seq <= ? AND kind = 'edit' AND path IS NOT NULL GROUP BY path
  ) g ON e.seq = g.seq ORDER BY e.seq DESC LIMIT ?`, sessionId, upto, MAX_CANDIDATES);
  add(`SELECT ${fields}, g.repeat_count FROM events e JOIN (
    SELECT max(seq) AS seq, count(*) AS repeat_count FROM events
    WHERE session_id = ? AND seq <= ? AND kind = 'decision' AND body <> '' GROUP BY coalesce(key, body)
  ) g ON e.seq = g.seq ORDER BY e.seq DESC LIMIT ?`, sessionId, upto, MAX_CANDIDATES);
  return { rows: [...rows.values()].sort((a, b) => a.seq - b.seq), repeatCounts };
}

/**
 * Rows of one session in seq order, optionally of one kind. An empty or unknown session id
 * returns []; never a "latest session" fallback (ADR-0009 §2, DECISIONS-r9 F4, PR #398).
 */
export function readSessionEvents(db: DbHandle, sessionId: string, kind?: EventKind): JournalRow[] {
  if (sessionId === "") return [];
  if (kind === undefined) {
    return db.raw
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as unknown as JournalRow[];
  }
  return db.raw
    .prepare("SELECT * FROM events WHERE session_id = ? AND kind = ? ORDER BY seq ASC")
    .all(sessionId, kind) as unknown as JournalRow[];
}

/** Primary-key read behind ctx_resume(seq:N) (ADR-0009 §4). A missing row is null, never a throw. */
export function readEventBySeq(db: DbHandle, seq: number): JournalRow | null {
  const row = db.raw.prepare("SELECT * FROM events WHERE seq = ?").get(seq);
  return row === undefined ? null : (row as unknown as JournalRow);
}

/** D-M7-SV-5: body of the newest prompt row of one session, or "" when there is none. */
export function readLastPrompt(db: DbHandle, sessionId: string): string {
  if (sessionId === "") return "";
  const row = db.raw
    .prepare("SELECT body FROM events WHERE session_id = ? AND kind = 'prompt' ORDER BY seq DESC LIMIT 1")
    .get(sessionId) as { body: string } | undefined;
  return row === undefined ? "" : row.body;
}

/** r3-ledger: the session goal, read as the first prompt of the session ("" when none). */
export function readFirstPrompt(db: DbHandle, sessionId: string): string {
  if (sessionId === "") return "";
  const row = db.raw
    .prepare("SELECT body FROM events WHERE session_id = ? AND kind = 'prompt' ORDER BY seq ASC LIMIT 1")
    .get(sessionId) as { body: string } | undefined;
  return row === undefined ? "" : row.body;
}

/**
 * DECISIONS-r11 (B): recall candidates, newest first. This session's rows plus the same worktree's rows of
 * prior sessions (ADR-0009 §8 rule 2: always filter by the current worktree). Cost rows carry no text.
 */
export function readRecallRows(
  db: DbHandle, sessionId: string, worktree: string, limit: number, maxSeq: number = Number.MAX_SAFE_INTEGER,
): JournalRow[] {
  if (sessionId === "") return [];
  // #1394: this session's rows after the latest compaction (seq > maxSeq) are still in the model's live context.
  return db.raw
    .prepare(
      "SELECT * FROM events WHERE kind <> 'cost' AND ((session_id = ? AND seq <= ?) OR (worktree = ? AND session_id <> ?)) " +
      "ORDER BY seq DESC LIMIT ?",
    )
    .all(sessionId, maxSeq, worktree, sessionId, limit) as unknown as JournalRow[];
}

/** #1394: the newest journal seq (0 for an empty journal); the recall boundary a compaction records. */
export function readMaxSeq(db: DbHandle): number {
  const row = db.raw.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM events").get() as { n: number };
  return Number(row.n);
}

/** D-FU-GCH-2: true when this worktree holds at least one journal row written by this agent. */
export function hasAgentRows(db: DbHandle, worktree: string, agent: string): boolean {
  return db.raw.prepare("SELECT 1 FROM events WHERE worktree = ? AND agent = ? LIMIT 1").get(worktree, agent) !== undefined;
}

/** D-FU-GCH-2: true when this session already holds a journal row (so this is not its first turn). */
export function hasSessionRows(db: DbHandle, sessionId: string): boolean {
  return db.raw.prepare("SELECT 1 FROM events WHERE session_id = ? LIMIT 1").get(sessionId) !== undefined;
}

/** #1396: newest journal seq of one session, or 0 when it has none. Keys the SessionStart(compact) marker per compaction. */
export function lastSessionSeq(db: DbHandle, sessionId: string): number {
  const row = db.raw.prepare("SELECT MAX(seq) AS m FROM events WHERE session_id = ?").get(sessionId) as { m: number | null } | undefined;
  return row?.m ?? 0;
}
