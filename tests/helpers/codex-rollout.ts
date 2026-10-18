import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function writeCodexRollout(codexHome: string, cwd: string, sessionId: string): void {
  const dir = join(codexHome, "sessions", "2026", "10", "18");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-test-${sessionId}.jsonl`), JSON.stringify({type: "session_meta", payload: {id: sessionId, cwd}}) + "\n");
}
