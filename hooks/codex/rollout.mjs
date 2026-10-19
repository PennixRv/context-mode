import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSessionLoaders } from "../session-loaders.mjs";

const loaders = createSessionLoaders(fileURLToPath(new URL(".", import.meta.url)));

/** Read only the native verified thread; both hooks use the same DB cursor. */
export async function collectCodexRollout(db, sessionId, projectDir, hookName) {
  try {
    const {resolveCodexThreadContext} = await loaders.loadSessionDB();
    const context = resolveCodexThreadContext(sessionId);
    if (context.projectDir !== projectDir) throw new Error("Codex rollout project mismatch");
    const {extractCodexRolloutSince} = await import("../../build/adapters/codex/usage.js");
    const cursor = db.getUsageCursor(sessionId);
    const parsed = extractCodexRolloutSince(readFileSync(context.transcriptPath, "utf8"), cursor);
    if (parsed.cursor === null || parsed.cursor === cursor) return;
    const {resolveProjectAttributions} = await loaders.loadProjectAttribution();
    const attributions = resolveProjectAttributions(parsed.events, {sessionOriginDir: projectDir, inputProjectDir: projectDir});
    db.commitCodexRollout(sessionId, cursor, parsed.cursor, parsed.events, hookName, attributions);
  } catch (error) {
    process.stderr.write(`Context Mode ${hookName} rollout skipped: ${String(error?.message ?? error).slice(0, 240)}\n`);
  }
}
