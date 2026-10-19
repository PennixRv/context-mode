#!/usr/bin/env node
// Exercise the real Codex transport against a local deterministic model fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const root = mkdtempSync(join(tmpdir(), "cm-native-codex-"));
const packageRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, "..");
const codex = process.env.CODEX_BIN || "codex";
const children = new Set();
const requests = [];
const fixture = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const outputs = body.input?.filter(item => item.type === "function_call_output") || [];
    const recovery = JSON.stringify(body.input).includes("RECOVERY_PROBE");
    const query = JSON.stringify(body.input).includes("RECOVERY_QUERY");
    if (req.url.endsWith("/compact")) {
      res.writeHead(200, {"content-type": "application/json"});
      res.end(JSON.stringify({id: "compact_fixture", object: "response.compaction", output: [{type: "message", role: "assistant", content: [{type: "output_text", text: "RECOVERY_PROBE summary"}]}], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}));
      return;
    }
    let item;
    if (!body.tools?.length || (query ? outputs.some(o => o.call_id === "recovery_query") : outputs.length >= (recovery ? 2 : 1))) {
      item = {type: "message", id: "msg_done", role: "assistant", status: "completed", content: [{type: "output_text", text: "fixture complete", annotations: []}]};
    } else if (recovery && !query) {
      const tools = body.tools.flatMap(t => t.type === "namespace" ? t.tools.map(x => ({...x, namespace: t.name})) : [t]);
      const tool = tools.find(t => t.name === "exec_command");
      assert.ok(tool, "native exec_command absent");
      const cmd = outputs.length ? "printf 'RECOVERY_NATIVE_FAILURE\\n' >&2; exit 7" : "printf '10 passed; 0 failed\\n'";
      item = {type: "function_call", id: `fc_native_${outputs.length}`, call_id: `native_${outputs.length}`, name: tool.name, ...(tool.namespace ? {namespace: tool.namespace} : {}), arguments: JSON.stringify({cmd}), status: "completed"};
    } else {
      const namespace = body.tools?.find(tool => tool.type === "namespace" && tool.name === "mcp__context_mode");
      const name = query ? "ctx_search" : "ctx_execute";
      const tool = namespace?.tools?.find(tool => tool.name === name) || body.tools?.find(tool => tool.name?.endsWith(name));
      assert.ok(tool, `ctx_execute absent: ${body.tools?.map(t => t.name || t.type).join(", ")}`);
      item = {type: "function_call", id: query ? "fc_recovery_query" : "fc_probe", call_id: query ? "recovery_query" : "probe", name: tool.name, ...(namespace ? {namespace: namespace.name} : {}), arguments: JSON.stringify(query ? {queries: ["RECOVERY_NATIVE_FAILURE"]} : {language: "javascript", code: "console.log(JSON.stringify({cwd:process.cwd(),thread:process.env.CODEX_THREAD_ID}))"}), status: "completed"};
    }
    res.writeHead(200, {"content-type": "text/event-stream"});
    for (const event of [
      {type: "response.created", response: {id: "resp_fixture", object: "response", status: "in_progress", output: []}},
      {type: "response.output_item.added", output_index: 0, item},
      {type: "response.output_item.done", output_index: 0, item},
      {type: "response.completed", response: {id: "resp_fixture", object: "response", status: "completed", output: [item], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (error) { console.error("Fixture request failed", req.url, req.headers["content-encoding"], String(error)); res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));

function start(mode, args) {
  const home = join(root, mode);
  const project = join(home, "project");
  const codexHome = join(home, "codex");
  mkdirSync(project, {recursive: true});
  mkdirSync(codexHome, {recursive: true});
  if (!existsSync(join(codexHome, "config.toml"))) writeFileSync(join(codexHome, "config.toml"), `model = "gpt-5.1"\nmodel_provider = "fixture"\n[features]\nhooks = true\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${fixture.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[mcp_servers.context-mode]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(join(packageRoot, "server.bundle.mjs"))}]\n[mcp_servers.context-mode.env]\nCONTEXT_MODE_PLATFORM = "codex"\nCODEX_HOME = ${JSON.stringify(codexHome)}\nCONTEXT_MODE_DIR = ${JSON.stringify(join(home, "data"))}\n`);
  const child = spawn(codex, ["-c", 'mcp_servers.context-mode.tools.ctx_execute.approval_mode="approve"', ...args], {cwd: project, env: {PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, CONTEXT_MODE_PLATFORM: "codex", CONTEXT_MODE_DIR: join(home, "data")}, stdio: ["pipe", "pipe", "pipe"]});
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => { children.delete(child); resolve({code, stdout, stderr}); });
  });
  child.on("exit", () => { if (child.exitCode !== 0) console.error(stderr + stdout); });
  return {child, done, project, home, codexHome};
}

async function openApp(mode) {
  const app = start(mode, ["app-server"]);
  let sequence = 0;
  const pending = new Map(), notifications = [], waiters = [];
  const lines = createInterface({input: app.child.stdout});
  lines.on("line", line => {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); }
    else { notifications.push(message); for (const waiter of [...waiters]) if (waiter.test(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message); } }
  });
  app.child.on("exit", () => { const error = new Error("app-server exited"); for (const entry of pending.values()) entry.reject(error); for (const entry of waiters) entry.reject(error); });
  app.rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); app.child.stdin.write(JSON.stringify({id, method, params}) + "\n"); });
  app.wait = (method, offset) => new Promise((resolve, reject) => {
    const test = m => m.method === method;
    const found = notifications.slice(offset).find(test);
    if (found) resolve(found); else waiters.push({test, resolve, reject});
  });
  app.notifications = notifications;
  app.close = async () => { app.child.stdin.end(); app.child.kill("SIGTERM"); await app.done; lines.close(); };
  await app.rpc("initialize", {clientInfo: {name: "cm-native-test", version: "1"}, capabilities: {experimentalApi: true}});
  app.child.stdin.write(JSON.stringify({method: "initialized"}) + "\n");
  return app;
}

function verifyOutput(project, offset) {
  const output = requests.slice(offset).flatMap(body => body.input || []).find(item => item.type === "function_call_output");
  assert.ok(output, "native host did not return MCP output to the model");
  const text = typeof output.output === "string" ? output.output : JSON.stringify(output.output);
  assert.ok(text.includes(project), text);
  assert.match(text, /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i);
  assert.ok(!text.includes("isError\":true"), text);
}

const timeout = setTimeout(() => { for (const child of children) child.kill("SIGTERM"); }, 45_000);
try {
  const cli = start("cli", ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "Run the context-mode probe."]);
  cli.child.stdin.end();
  const result = await cli.done;
  assert.equal(result.code, 0, result.stderr + result.stdout);
  verifyOutput(cli.project, 0);
  console.log("Codex CLI native MCP identity: passed");

  const offset = requests.length;
  const app = start("app-server", ["app-server"]);
  let sequence = 0;
  const pending = new Map();
  let complete;
  const turnDone = new Promise(resolve => { complete = resolve; });
  app.child.on("exit", () => {
    for (const entry of pending.values()) entry.reject(new Error("app-server exited"));
    complete({turn: {status: "failed"}});
  });
  const lines = createInterface({input: app.child.stdout});
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.id != null && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    }
    if (message.method === "turn/completed") complete(message.params);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, {resolve, reject});
    app.child.stdin.write(JSON.stringify({id, method, params}) + "\n");
  });
  await rpc("initialize", {clientInfo: {name: "cm-native-test", version: "1"}});
  app.child.stdin.write(JSON.stringify({method: "initialized"}) + "\n");
  const {thread} = await rpc("thread/start", {cwd: app.project, approvalPolicy: "never", sandbox: "read-only"});
  await rpc("turn/start", {threadId: thread.id, input: [{type: "text", text: "Run the context-mode probe.", text_elements: []}]});
  const completion = await turnDone;
  assert.equal(completion.turn.status, "completed", JSON.stringify(completion));
  verifyOutput(app.project, offset);
  app.child.stdin.end();
  app.child.kill("SIGTERM");
  await app.done;
  lines.close();
  console.log("Codex app-server native MCP identity: passed");

  const recoveryHome = join(root, "recovery"), recoveryCodex = join(recoveryHome, "codex");
  mkdirSync(recoveryCodex, {recursive: true});
  const capture = join(recoveryHome, "hook-evidence.jsonl"), wrapper = join(recoveryHome, "hook.mjs");
  writeFileSync(wrapper, `import {spawnSync} from 'node:child_process';import {appendFileSync} from 'node:fs';let input='';for await(const b of process.stdin)input+=b;const e=JSON.parse(input);const r=spawnSync(process.execPath,[process.argv[2]],{input,encoding:'utf8',env:process.env,maxBuffer:16*1024*1024});if(r.status!==0){process.stderr.write(r.stderr);process.exit(r.status||1);}const o=JSON.parse(r.stdout);appendFileSync(${JSON.stringify(capture)},JSON.stringify({hook:e.hook_event_name,source:e.source,session:e.session_id,contextBytes:Buffer.byteLength(o.hookSpecificOutput?.additionalContext||''),jsonBytes:Buffer.byteLength(r.stdout)})+'\\n',{mode:0o600});process.stdout.write(r.stdout);`);
  const hookNames = {SessionStart: "sessionstart", UserPromptSubmit: "userpromptsubmit", PreToolUse: "pretooluse", PostToolUse: "posttooluse", PreCompact: "precompact", Stop: "stop"};
  writeFileSync(join(recoveryCodex, "hooks.json"), JSON.stringify({hooks: Object.fromEntries(Object.entries(hookNames).map(([event, name]) => [event, [{hooks: [{type: "command", command: [process.execPath, wrapper, join(packageRoot, "hooks/codex", `${name}.mjs`)].map(JSON.stringify).join(" ")}]}]]))}));
  let recoveryApp = await openApp("recovery");
  const listed = await recoveryApp.rpc("hooks/list", {cwds: [recoveryApp.project]});
  const owned = listed.data.flatMap(x => x.hooks);
  assert.equal(owned.length, 6);
  for (const hook of owned) {
    assert.equal(hook.sourcePath, join(recoveryCodex, "hooks.json"));
    await recoveryApp.rpc("config/value/write", {keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`, value: hook.currentHash, mergeStrategy: "upsert"});
  }
  await recoveryApp.close();
  recoveryApp = await openApp("recovery");
  const trusted = await recoveryApp.rpc("hooks/list", {cwds: [recoveryApp.project]});
  assert.ok(trusted.data.flatMap(x => x.hooks).every(h => h.trustStatus === "trusted"));
  const recoveryThread = (await recoveryApp.rpc("thread/start", {cwd: recoveryApp.project, approvalPolicy: "never", sandboxPolicy: {type: "readOnly", networkAccess: true}})).thread;
  let notificationOffset = recoveryApp.notifications.length;
  // Keep filesystem read-only; the disposable fixture permits localhost networking
  // without asking CI's restricted network namespace to configure loopback.
  await recoveryApp.rpc("turn/start", {threadId: recoveryThread.id, sandboxPolicy: {type: "readOnly", networkAccess: true}, input: [{type: "text", text: "RECOVERY_PROBE run native success and failure.", text_elements: []}]});
  assert.equal((await recoveryApp.wait("turn/completed", notificationOffset)).params.turn.status, "completed");
  const {SessionDB, resolveSessionDbPath} = await import(join(packageRoot, "build/session/db.js"));
  const db = new SessionDB({dbPath: resolveSessionDbPath({projectDir: recoveryApp.project, sessionsDir: join(recoveryHome, "data/sessions")})});
  const failures = db.getEvents(recoveryThread.id).filter(e => e.category === "error");
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.match(failures[0].data, /call_id=native_1 exit_code=7/);
  db.insertEvent(recoveryThread.id, {type: "data", category: "data", priority: 4, data: "retained large payload " + "x ".repeat(524_288)});
  for (let i = 0; i < 40; i++) db.insertEvent(recoveryThread.id, {type: "data", category: `fixture-${i}`, priority: 4, data: `多字节恢复预算 ${i} ` + "验证 ".repeat(200)});
  // Exercise an old oversized cache through the actual native compact/resume hooks.
  db.upsertResume(recoveryThread.id, "OLD-OPAQUE-CACHE".repeat(100_000));
  notificationOffset = recoveryApp.notifications.length;
  await recoveryApp.rpc("thread/compact/start", {threadId: recoveryThread.id});
  assert.equal((await recoveryApp.wait("turn/completed", notificationOffset)).params.turn.status, "completed", "native compaction failed");
  await recoveryApp.close();
  recoveryApp = await openApp("recovery");
  await recoveryApp.rpc("thread/resume", {threadId: recoveryThread.id, cwd: recoveryApp.project, approvalPolicy: "never", sandbox: "read-only"});
  notificationOffset = recoveryApp.notifications.length;
  const queryOffset = requests.length;
  await recoveryApp.rpc("turn/start", {threadId: recoveryThread.id, input: [{type: "text", text: "RECOVERY_QUERY search retained error evidence.", text_elements: []}]});
  assert.equal((await recoveryApp.wait("turn/completed", notificationOffset)).params.turn.status, "completed");
  const queryOutput = requests.slice(queryOffset).flatMap(r => r.input || []).find(i => i.type === "function_call_output" && i.call_id === "recovery_query");
  assert.ok(queryOutput && JSON.stringify(queryOutput.output).includes("RECOVERY_NATIVE_FAILURE"), "native recovery evidence not searchable");
  const hooks = readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(hooks.some(h => h.hook === "PreCompact"), JSON.stringify(hooks));
  const restores = hooks.filter(h => h.hook === "SessionStart" && ["compact", "resume"].includes(h.source));
  assert.ok(restores.some(h => h.source === "resume"), JSON.stringify(hooks));
  assert.ok(restores.every(h => h.contextBytes > 0 && h.contextBytes <= 8192), JSON.stringify(restores));
  console.log(JSON.stringify({nativeRecovery: "passed", failureEvents: failures.length, restores}));
  db.close();
  await recoveryApp.close();
} finally {
  clearTimeout(timeout);
  for (const child of children) child.kill("SIGTERM");
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  rmSync(root, {recursive: true, force: true});
}
