#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";
/**
 * Codex CLI PreCompact hook - snapshot generation.
 */

import {
  readStdin,
  parseStdin,
  getSessionId,
  getSessionDBPath,
  getInputProjectDir,
  resolveConfigDir,
  getSessionEventsPath,
  CODEX_OPTS,
} from "../session-helpers.mjs";
import { createSessionLoaders } from "../session-loaders.mjs";
import { collectCodexRollout } from "./rollout.mjs";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const { loadSessionDB, loadSnapshot } = createSessionLoaders(HOOK_DIR);
const OPTS = CODEX_OPTS;

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const projectDir = getInputProjectDir(input, OPTS);
  const sessionId = getSessionId(input, OPTS);
  if (!sessionId) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  const { buildResumeSnapshot, CODEX_RECOVERY_MAX_BYTES } = await loadSnapshot();
  const { SessionDB } = await loadSessionDB();

  const dbPath = getSessionDBPath(OPTS, projectDir);
  const db = new SessionDB({ dbPath });
  db.ensureSession(sessionId, projectDir);
  await collectCodexRollout(db, sessionId, projectDir, "PreCompact");
  const events = db.getEvents(sessionId);

  if (events.length > 0) {
    const stats = db.getSessionStats(sessionId);
    const snapshot = buildResumeSnapshot(events, {
      compactCount: (stats?.compact_count ?? 0) + 1,
      maxBytes: CODEX_RECOVERY_MAX_BYTES,
      searchSource: `session-events:${sessionId}`,
    });

    db.upsertResume(sessionId, snapshot, events.length);
    db.incrementCompactCount(sessionId);

    const fileEvents = events.filter((event) => event.category === "file");
    db.insertEvent(sessionId, {
      type: "compaction_summary",
      category: "compaction",
      data: `Session compacted. ${events.length} events, ${fileEvents.length} files touched.`,
      priority: 1,
    }, "PreCompact");
  }

  db.close();
} catch (err) {
  try {
    process.stderr.write(`Context Mode PreCompact skipped: ${err?.message || err}\n`);
  } catch {
    // Hook errors must not break Codex compaction.
  }
}

// Codex PreCompact accepts universal hook fields only; no hookSpecificOutput.
process.stdout.write(JSON.stringify({}) + "\n");
