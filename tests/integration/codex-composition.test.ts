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
const hookEvents: Record<string, string> = {
  sessionstart: "SessionStart",
  userpromptsubmit: "UserPromptSubmit",
  posttooluse: "PostToolUse",
  pretooluse: "PreToolUse",
  precompact: "PreCompact",
  stop: "Stop",
};
function hook(name: string, thread: typeof threads[number], extra: Record<string, unknown> = {}) {
  const toolEvent = name === "pretooluse" || name === "posttooluse";
  const result = spawnSync(process.execPath, [join(packageRoot, "hooks/codex", `${name}.mjs`)], {
    env,
    input: JSON.stringify({
      session_id: thread.sessionId,
      transcript_path: join(sessions, `rollout-2026-10-18T00-00-00-${thread.sessionId}.jsonl`),
      cwd: thread.projectDir,
      hook_event_name: hookEvents[name],
      ...(toolEvent ? {turn_id: randomUUID(), tool_use_id: randomUUID(), permission_mode: "default"} : {}),
      ...extra,
    }),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

beforeAll(async () => {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(packageRoot, "server.bundle.mjs")], env, stderr: "pipe" }));
});
afterAll(async () => { await client.close(); rmSync(root, {recursive: true, force: true}); });

describe("Codex native identity and MCP composition", () => {
  test.each([1, 2])("batch tool reports silent failure even without search matches at concurrency=%i (F013)", async (concurrency) => {
    for (const queries of [["missing-audit-vocabulary"], []]) {
      const result = await call(threads[0], "ctx_batch_execute", {
        commands: [
          {label: "finished", command: "printf 'finished-evidence\\n'"},
          {label: "failed", command: "exit 7"},
        ],
        queries, concurrency,
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/finished: .*success; exit code: 0/);
      expect(textOf(result)).toMatch(/failed: .*nonzero_exit; exit code: 7/);
      const saved = await call(threads[0], "ctx_search", {queries: ["finished-evidence"]});
      expect(textOf(saved)).toContain("finished-evidence");
    }
    const soft = await call(threads[0], "ctx_batch_execute", {
      commands: [{label: "soft", command: "printf 'useful-result\\n'; exit 1"}],
      queries: [], concurrency,
    });
    expect(soft.isError).not.toBe(true);
    expect(textOf(soft)).toContain("soft_failure; exit code: 1");
  });

  test.each([1, 2])("batch tool runs compound shell at concurrency=%i (F019)", async (concurrency) => {
    const result = await call(threads[0], "ctx_batch_execute", {
      commands: [{label: "compound", command: "for i in first second; do printf '%s\\n' \"$i\"; done"}],
      queries: ["second"], concurrency,
    });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain("success; exit code: 0");
    expect(textOf(result)).toContain("second");
  });

  test("execute intent is bound to this output, excluding historical and :error sources (F014)", async () => {
    for (const suffix of ["", "; exit 7"]) {
      await call(threads[1], "ctx_execute", {
        language: "shell", code: `printf '%s\\n' '${"OLDINTENTONLY history evidence\n".repeat(240)}'${suffix}`, intent: "OLDINTENTONLY",
      });
    }
    const current = await call(threads[0], "ctx_execute", {
      language: "shell", code: `printf '%s\\n' '${"CURRENTINTENTONLY current evidence\n".repeat(240)}'`, intent: "OLDINTENTONLY",
    });
    expect(current.isError).not.toBe(true);
    expect(textOf(current)).toContain("No sections matched intent");
    const shared = await call(threads[0], "ctx_search", { queries: ["OLDINTENTONLY"] });
    expect(textOf(shared)).toContain("OLDINTENTONLY");
  });

  test("batch source IDs isolate colliding labels while explicit global remains shared (F014)", async () => {
    const label = "collision".repeat(12);
    await call(threads[1], "ctx_batch_execute", {
      commands: [{label: `${label}-old`, command: "printf 'OLDBATCHONLY history\\n'"}], queries: ["OLDBATCHONLY"],
    });
    const current = await call(threads[0], "ctx_batch_execute", {
      commands: [{label: `${label}-new`, command: "printf 'CURRENTBATCHONLY fresh\\n'"}], queries: ["OLDBATCHONLY", "CURRENTBATCHONLY"],
    });
    expect(textOf(current)).toContain("No matching sections found.");
    expect(textOf(current)).not.toContain("OLDBATCHONLY history");
    expect(textOf(current)).toContain("CURRENTBATCHONLY fresh");
    const global = await call(threads[0], "ctx_batch_execute", {
      commands: [{label: "global", command: "true"}], queries: ["OLDBATCHONLY"], query_scope: "global",
    });
    expect(textOf(global)).toContain("OLDBATCHONLY history");
    const simultaneous = await Promise.all(["CONCURRENTALPHA", "CONCURRENTBETA"].map(word => call(threads[0], "ctx_batch_execute", {
      commands: [{label, command: `printf '${word}\\n'`}], queries: ["CONCURRENTALPHA", "CONCURRENTBETA"],
    })));
    expect(textOf(simultaneous[0])).toContain("\n\nCONCURRENTALPHA\n");
    expect(textOf(simultaneous[0])).not.toContain("\n\nCONCURRENTBETA\n");
    expect(textOf(simultaneous[1])).toContain("\n\nCONCURRENTBETA\n");
    expect(textOf(simultaneous[1])).not.toContain("\n\nCONCURRENTALPHA\n");
  });

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
    const redirected = hook("pretooluse", a, {
      tool_name: "Bash",
      tool_input: {command: "curl https://example.com"},
    }).hookSpecificOutput;
    if (redirected.permissionDecision === "allow") {
      expect(redirected.updatedInput.command).toContain("curl/wget redirected");
    } else {
      expect(redirected.permissionDecision).toBe("deny");
      expect(redirected.permissionDecisionReason).toContain("curl/wget redirected");
    }
    const ownMcp = hook("pretooluse", a, {
      tool_name: "mcp__context_mode__ctx_search",
      tool_input: {queries: ["test"]},
    }).hookSpecificOutput;
    expect(ownMcp.permissionDecision).toBeUndefined();
    expect(ownMcp.additionalContext).toBeUndefined();
    hook("precompact", a);
    hook("stop", a);
    const restored = hook("sessionstart", a, {source: "compact"});
    expect(restored.hookSpecificOutput.additionalContext).toMatch(/historical/i);
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

  test("compact and resume stay bounded while full retained events remain queryable", async () => {
    const a = threads[0];
    const db = new SessionDB({dbPath: resolveSessionDbPath({projectDir: a.projectDir, sessionsDir: join(data, "sessions")})});
    db.ensureSession(a.sessionId, a.projectDir);
    db.insertEvent(a.sessionId, {type: "error_tool", category: "error", priority: 1, data: "OLD-HUGE-ERROR " + "x".repeat(1024 * 1024)});
    for (let i = 0; i < 12; i++) db.insertEvent(a.sessionId, {type: "data", category: "data", priority: 4, data: `DATAHEAD${i} ` + "body ".repeat(100) + ` RETAINEDTAIL${i}`});
    db.insertEvent(a.sessionId, {type: "constraint", category: "constraint", priority: 2, data: "RETAINEDCONSTRAINT exact native evidence"});
    db.insertEvent(a.sessionId, {type: "goal", category: "goal", priority: 1, data: "RETAINEDGOAL verify full projection"});
    db.upsertResume(a.sessionId, "OLD-OPAQUE-SNAPSHOT".repeat(100_000));
    for (const source of ["compact", "compact", "resume"]) {
      const output = hook("sessionstart", a, {source});
      const context = output.hookSpecificOutput.additionalContext;
      expect(Buffer.byteLength(context)).toBeLessThanOrEqual(8192);
      expect(context).not.toContain("OLD-OPAQUE-SNAPSHOT");
      expect(context).toContain(`session-events:${a.sessionId}`);
    }
    const found = await call(a, "ctx_search", {queries: ["RETAINEDTAIL0", "RETAINEDTAIL11", "RETAINEDCONSTRAINT", "RETAINEDGOAL"], source: `session-events:${a.sessionId}`});
    const text = textOf(found);
    for (const marker of ["RETAINEDTAIL0", "RETAINEDTAIL11", "RETAINEDCONSTRAINT", "RETAINEDGOAL"]) expect(text).toContain(marker);
    for (const sort of ["relevance", "timeline"]) {
      const sibling = await call(threads[1], "ctx_search", {queries: ["RETAINEDTAIL11"], source: `session-events:${a.sessionId}`, sort});
      expect(textOf(sibling)).toContain("No results found");
    }
    hook("precompact", a);
    expect(Buffer.byteLength(db.getResume(a.sessionId)!.snapshot)).toBeLessThanOrEqual(8192);
    db.close();
  }, 20_000);

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
