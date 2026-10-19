#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";
/**
 * Codex CLI sessionStart hook for context-mode.
 */

import { createToolNamer } from "../core/tool-naming.mjs";

const toolNamer = createToolNamer("codex");
const ROUTING_BLOCK = "Context Mode stores local session history for reference. Current host instructions and native task state remain authoritative; use pennix-context-mode-integration for workflow boundaries.";
import {
  writeSessionEventsFile,
  getSessionEvents,
} from "../session-directive.mjs";
import {
  readStdin,
  parseStdin,
  getSessionId,
  getSessionDBPath,
  getSessionEventsPath,
  getCleanupFlagPath,
  getInputProjectDir,
  resolveConfigDir,
  CODEX_OPTS,
} from "../session-helpers.mjs";
import { createSessionLoaders } from "../session-loaders.mjs";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = fileURLToPath(new URL(".", import.meta.url));
const { loadSessionDB, loadSnapshot } = createSessionLoaders(HOOK_DIR);
const OPTS = CODEX_OPTS;

let additionalContext = ROUTING_BLOCK;

function captureCodexInstructionRules(db, sessionId, projectDir) {
  const paths = [];
  for (const baseDir of [resolveConfigDir(OPTS), projectDir]) {
    paths.push(join(baseDir, "AGENTS.md"));
    paths.push(join(baseDir, "AGENTS.override.md"));
  }

  for (const p of [...new Set(paths)]) {
    try {
      if (!existsSync(p)) continue;
      const content = readFileSync(p, "utf8");
      db.insertEvent(sessionId, { type: "rule", category: "rule", data: p, priority: 1 });
      db.insertEvent(sessionId, { type: "rule_content", category: "rule", data: content, priority: 1 });
    } catch {
      // Missing or unreadable rule files should never break SessionStart.
    }
  }
}

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const source = input.source ?? "startup";
  const projectDir = getInputProjectDir(input, CODEX_OPTS);
  const sessionId = getSessionId(input, OPTS);

  if (sessionId && (source === "compact" || source === "resume")) {
    const { SessionDB } = await loadSessionDB();
    const dbPath = getSessionDBPath(OPTS, projectDir);
    const db = new SessionDB({ dbPath });
    const { buildResumeSnapshot, CODEX_RECOVERY_MAX_BYTES } = await loadSnapshot();
    let claimed = source === "resume";

    if (source === "compact") {
      const resume = db.claimResume(sessionId);
      claimed = Boolean(resume);
    } else {
      try { unlinkSync(getCleanupFlagPath(OPTS, projectDir)); } catch { /* no flag */ }
    }

    // Filter events to the session being resumed/compacted. Falling back to
    // getLatestSessionEvents(db) for resume leaks events from any other
    // session whose session_meta.started_at is more recent — observed
    // cross-session bleed when a different session started after this one
    // and before the resume.
    const events = sessionId ? getSessionEvents(db, sessionId) : [];
    if (events.length > 0) {
      writeSessionEventsFile(events, getSessionEventsPath(OPTS, projectDir, sessionId), {fullData: true});
      const searchSource = `session-events:${sessionId}`;
      const hint = `\nHistorical observations only. Query retained history on demand: ${toolNamer("ctx_search")}(${JSON.stringify({queries: ["session history"], source: searchSource})}).`;
      const remaining = CODEX_RECOVERY_MAX_BYTES - Buffer.byteLength(additionalContext + "\n");
      const snapshot = claimed ? buildResumeSnapshot(events, {maxBytes: remaining, searchSource, searchTool: toolNamer("ctx_search")}) : "";
      additionalContext += snapshot ? `\n${snapshot}` : hint;
    }

    if (Buffer.byteLength(additionalContext) > CODEX_RECOVERY_MAX_BYTES) additionalContext = ROUTING_BLOCK;

    db.close();
  } else if (source === "startup" && sessionId) {
    const { SessionDB } = await loadSessionDB();
    const dbPath = getSessionDBPath(OPTS, projectDir);
    const db = new SessionDB({ dbPath });
    try { unlinkSync(getSessionEventsPath(OPTS, projectDir, sessionId)); } catch { /* no stale file */ }

    db.ensureSession(sessionId, projectDir);
    db.cleanupOldSessions(30, sessionId);
    db.pruneOrphanedEvents(30, sessionId);
    captureCodexInstructionRules(db, sessionId, projectDir);

    db.close();
  }
  // clear => routing block only
} catch {
  additionalContext = `${ROUTING_BLOCK}\nContext Mode history projection unavailable; retained source events were preserved.`;
}

// Codex SessionStart requires hookEventName in hookSpecificOutput
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
}) + "\n");
