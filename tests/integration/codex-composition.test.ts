import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, utimesSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveCodexThreadContext } from "../../src/util/project-dir.js";
import { SessionDB, resolveSessionDbPath, resolveSessionEventsPath } from "../../src/session/db.js";

const root = mkdtempSync(join(tmpdir(), "cm-codex-composition-"));
const codexHome = join(root, "codex");
const data = join(root, "data");
const packageRoot = resolve(import.meta.dirname, "../..");
const sessions = join(codexHome, "sessions", "2026", "10", "18");
mkdirSync(sessions, { recursive: true });
const projects = [join(root, "项目 A"), join(root, "project B")];
projects.forEach(project => mkdirSync(project));
const threads = projects.flatMap(projectDir => [0, 1].map(() => ({ projectDir, sessionId: randomUUID() })));
for (const thread of threads) {
  writeFileSync(join(sessions, `rollout-2026-10-18T00-00-00-${thread.sessionId}.jsonl`), JSON.stringify({type: "session_meta", payload: {id: thread.sessionId, cwd: thread.projectDir}}) + "\n");
}
const env = { PATH: process.env.PATH!, HOME: root, CODEX_HOME: codexHome, CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_DIR: data };
const client = new Client({ name: "codex-composition-test", version: "1" });
const textOf = (result: any) => result.content?.map((part: any) => part.text ?? "").join("\n") ?? "";
const call = (thread: typeof threads[number], name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args, _meta: { threadId: thread.sessionId } });
function hook(name: string, thread: typeof threads[number], extra: Record<string, unknown> = {}) {
  const result = spawnSync(process.execPath, [join(packageRoot, "hooks/codex", `${name}.mjs`)], {
    env, input: JSON.stringify({session_id: thread.sessionId, cwd: thread.projectDir, ...extra}), encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

beforeAll(async () => {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "server.bundle.mjs")], env, stderr: "pipe" }));
});
afterAll(async () => { await client.close(); rmSync(root, {recursive: true, force: true}); });

describe("Codex native identity and MCP composition", () => {
  test("only the exact native thread determines cwd; missing or ambiguous identity fails", () => {
    for (const thread of threads) expect(resolveCodexThreadContext(thread.sessionId, codexHome).projectDir).toBe(thread.projectDir);
    expect(() => resolveCodexThreadContext(undefined, codexHome)).toThrow(/threadId/);
    const original = join(sessions, `rollout-2026-10-18T00-00-00-${threads[0].sessionId}.jsonl`);
    const duplicate = join(sessions, `rollout-other-${threads[0].sessionId}.jsonl`);
    writeFileSync(duplicate, readFileSync(original));
    utimesSync(duplicate, new Date(0), new Date(0));
    expect(() => resolveCodexThreadContext(threads[0].sessionId, codexHome)).toThrow(/found 2/);
    rmSync(duplicate);
  });

  test("one MCP process keeps four concurrent threads and two projects separate", async () => {
    const results = await Promise.all(threads.map(thread => call(thread, "ctx_execute", {
      language: "javascript", code: "console.log(JSON.stringify({cwd:process.cwd(),thread:process.env.CODEX_THREAD_ID}))",
    })));
    results.forEach((result, index) => {
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toContain(threads[index].projectDir);
      expect(textOf(result)).toContain(threads[index].sessionId);
    });
    const missing = await client.callTool({name: "ctx_execute", arguments: {language: "shell", code: "pwd"}});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("threadId");
  });

  test("same source labels do not overwrite another thread, and project purge stays in its project", async () => {
    for (let i = 0; i < threads.length; i++) {
      const result = await call(threads[i], "ctx_index", {content: `# Evidence\nunique-composition-marker-${i}`, source: "same-label"});
      expect(result.isError, textOf(result)).not.toBe(true);
    }
    const first = await call(threads[0], "ctx_search", {queries: ["unique-composition-marker-0", "unique-composition-marker-1"], source: "same-label"});
    expect(textOf(first)).toContain("unique-composition-marker-0");
    expect(textOf(first)).toContain("unique-composition-marker-1");
    expect(textOf(first)).not.toContain("unique-composition-marker-2");
    const wrongThread = await call(threads[0], "ctx_purge", {confirm: true, scope: "session", sessionId: threads[1].sessionId});
    expect(wrongThread.isError).toBe(true);
    await call(threads[0], "ctx_purge", {confirm: true, scope: "project"});
    const other = await call(threads[2], "ctx_search", {queries: ["unique-composition-marker-2"], source: "same-label"});
    expect(textOf(other)).toContain("unique-composition-marker-2");
  });

  test("six hooks use matching native identity; recovery is consumed only by its owner", async () => {
    const [a, b] = threads;
    hook("sessionstart", a, {source: "startup"});
    hook("userpromptsubmit", a, {prompt: "Investigate the composition fixture"});
    hook("posttooluse", a, {tool_name: "apply_patch", tool_input: {patch: "*** Begin Patch\n*** Add File: fixture.txt\n+test\n*** End Patch"}, tool_response: "ok"});
    const pre = hook("pretooluse", a, {tool_name: "exec_command", tool_input: {cmd: "pwd"}});
    expect(pre.hookSpecificOutput.permissionDecision).not.toBe("deny");
    hook("precompact", a);
    hook("stop", a);
    const restored = hook("sessionstart", a, {source: "compact"});
    expect(restored.hookSpecificOutput.additionalContext).toContain("historical");
    const file = resolveSessionEventsPath({ ...a, sessionsDir: join(data, "sessions") });
    expect(existsSync(file)).toBe(true);
    await call(b, "ctx_index", {content: "sibling", source: "sibling"});
    expect(existsSync(file)).toBe(true);
    await call(a, "ctx_index", {content: "owner", source: "owner"});
    expect(existsSync(file)).toBe(false);
    const dbPath = resolveSessionDbPath({projectDir: a.projectDir, sessionsDir: join(data, "sessions")});
    const db = new SessionDB({dbPath});
    expect(db.getEvents(a.sessionId).some(event => event.type === "user_prompt")).toBe(true);
    db.upsertResume(a.sessionId, "owned snapshot");
    expect(db.claimResume(b.sessionId)).toBeNull();
    expect(db.claimResume(a.sessionId)?.snapshot).toBe("owned snapshot");
    expect(db.claimResume(a.sessionId)).toBeNull();
    db.close();
    if (process.platform !== "win32") expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    expect(existsSync(join(codexHome, "AGENTS.md"))).toBe(false);
  });

  test("native sensitive operations and unverified candidates retain status only", () => {
    const thread = threads[3];
    hook("posttooluse", thread, {tool_name: "exec_command", tool_input: {cmd: "windsurf-code-search query fixture"}, tool_response: "UNVERIFIED-CANDIDATE-PRIVATE"});
    hook("posttooluse", thread, {tool_name: "apply_patch", tool_input: {patch: "*** Update File: .env\n+API_KEY=FAKE-SECRET-PRIVATE"}, tool_response: "FAKE-SECRET-PRIVATE"});
    hook("posttooluse", thread, {tool_name: "functions.exec", tool_input: {code: "opaque native call"}, tool_response: "OPAQUE-PRIVATE-PAYLOAD"});
    const db = new SessionDB({dbPath: resolveSessionDbPath({projectDir: thread.projectDir, sessionsDir: join(data, "sessions")})});
    const events = db.getEvents(thread.sessionId);
    const captured = JSON.stringify(events);
    expect(captured).not.toMatch(/UNVERIFIED-CANDIDATE-PRIVATE|FAKE-SECRET-PRIVATE|OPAQUE-PRIVATE-PAYLOAD/);
    expect(events.filter(event => event.type === "tool_status")).toHaveLength(3);
    db.close();
  });

  test("RPC cancellation kills descendants before a delayed write", async () => {
    const marker = join(threads[2].projectDir, "cancelled-marker");
    const started = join(threads[2].projectDir, "started-marker");
    const controller = new AbortController();
    const pending = client.callTool({name: "ctx_execute", arguments: {
      language: "shell", code: `touch '${started}'; (sleep 1; touch '${marker}') & wait`,
    }, _meta: {threadId: threads[2].sessionId}}, undefined, { signal: controller.signal });
    while (!existsSync(started)) await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(existsSync(marker)).toBe(false);
  }, 10_000);
});
