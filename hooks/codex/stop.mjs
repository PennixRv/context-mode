#!/usr/bin/env node
import "./platform.mjs";
import "../suppress-stderr.mjs";
import "../ensure-deps.mjs";
/**
 * Codex CLI Stop hook — record turn-end state for continuity.
 *
 * Stop fires at the end of an assistant turn, not at true session shutdown.
 * Store a turn_end marker so session_end remains reserved for actual terminal
 * lifecycle events on platforms that expose one.
 */

import { readStdin, parseStdin, getSessionId, getSessionDBPath, getInputProjectDir, CODEX_OPTS } from "../session-helpers.mjs";
import { createSessionLoaders, attributeAndInsertEvents } from "../session-loaders.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const { loadSessionDB, loadProjectAttribution } = createSessionLoaders(HOOK_DIR);
const OPTS = CODEX_OPTS;

/**
 * Load the codex usage extractor (build/adapters/codex/usage.js), mirroring the
 * loadModule build-path fallback in session-loaders. Returns null if the module
 * is absent (e.g. pre-build dev tree) so the hook degrades gracefully.
 */
async function loadCodexUsage() {
  try {
    const pluginRoot = join(HOOK_DIR, "..", "..");
    const candidates = [
      join(pluginRoot, "build", "adapters", "codex", "usage.js"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return await import(pathToFileURL(p).href);
    }
  } catch {
    // ignore
  }
  return null;
}

try {
  const raw = await readStdin();
  const input = parseStdin(raw);
  const projectDir = getInputProjectDir(input, OPTS);
  const sessionId = getSessionId(input, OPTS);
  if (!sessionId) {
    process.stdout.write("{}\n");
    process.exit(0);
  }

  const { SessionDB, resolveCodexThreadContext } = await loadSessionDB();
  const dbPath = getSessionDBPath(OPTS, projectDir);
  const db = new SessionDB({ dbPath });
  db.ensureSession(sessionId, projectDir);
  const payload = {
    stop_hook_active: input.stop_hook_active ?? false,
    has_assistant_message: typeof input.last_assistant_message === "string",
  };
  db.insertEvent(sessionId, {
    type: "turn_end",
    category: "session",
    data: JSON.stringify(payload),
    priority: 1,
  }, "Stop");

  // ─── codex MAIN-turn cost capture (cursor-aware, no double-count) ─────────
  // Codex carries no tokens on the hook payload (model only); per-turn usage is
  // persisted to the session rollout JSONL as `event_msg`/`token_count`
  // records. We tail that file, cursor-gated by rollout LINE INDEX, summing
  // ONLY the completed turns NEW since the last Stop. Each step is best-effort
  // — a hook must never block the session, so any read/extract failure here is
  // swallowed without aborting the turn_end write above.
  try {
    const rolloutPath = resolveCodexThreadContext(sessionId).transcriptPath;
    if (rolloutPath) {
      let rollout = null;
      try { rollout = readFileSync(rolloutPath, "utf-8"); } catch { /* unreadable — skip */ }
      if (rollout) {
        const usageMod = await loadCodexUsage();
        if (usageMod && typeof usageMod.extractCodexUsageSince === "function") {
          const { resolveProjectAttributions } = await loadProjectAttribution();
          const cursor = db.getUsageCursor(sessionId);
          const { events, cursor: next } = usageMod.extractCodexUsageSince(rollout, cursor);
          if (events.length > 0) {
            // Usage metadata stays local to this verified thread.
            attributeAndInsertEvents(db, sessionId, events, input, projectDir, "Stop", resolveProjectAttributions);
          }
          if (next) db.setUsageCursor(sessionId, next);
        }
      }
    }
  } catch {
    // Best-effort cost capture — never block the session on failure.
  }

  db.close();
} catch {
  // Codex hooks must not block the session.
}

process.stdout.write("{}\n");
