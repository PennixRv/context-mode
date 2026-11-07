import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

// Verify only the native thread's session_meta. Never harvest events or choose a rollout by recency.
export function resolveCodexThreadContext(threadId: unknown, codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex")): {
  sessionId: string; projectDir: string; transcriptPath: string;
} {
  if (typeof threadId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(threadId)) {
    throw new Error("Codex request is missing a valid native threadId.");
  }
  const root = path.join(codexHome, "sessions");
  const matches: string[] = [];
  const stack = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++visited > 100_000) throw new Error("Codex rollout search exceeded its directory bound.");
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) stack.push({ dir: full, depth: depth + 1 });
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(`-${threadId}.jsonl`)) matches.push(full);
    }
  }
  if (matches.length !== 1) throw new Error(`Codex thread ${threadId}: expected one rollout, found ${matches.length}.`);
  const fd = fs.openSync(matches[0], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let header: string | undefined;
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Codex rollout is not a regular file.");
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(16_384);
    let offset = 0;
    while (offset < 1_048_576) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (!length) break;
      const newline = buffer.subarray(0, length).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, newline < 0 ? length : newline)));
      offset += length;
      if (newline >= 0) { header = Buffer.concat(chunks).toString("utf8"); break; }
    }
    if (!header) throw new Error("Codex rollout session metadata is missing or exceeds 1 MiB.");
  } finally { fs.closeSync(fd); }
  const row = JSON.parse(header);
  const meta = row?.type === "session_meta" ? row.payload : undefined;
  if (meta?.id !== threadId || typeof meta.cwd !== "string" || !path.isAbsolute(meta.cwd) || !fs.statSync(meta.cwd).isDirectory()) {
    throw new Error("Codex rollout metadata does not match the native thread or a valid project directory.");
  }
  return { sessionId: threadId, projectDir: fs.realpathSync(meta.cwd), transcriptPath: matches[0] };
}
