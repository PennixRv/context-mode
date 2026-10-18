#!/usr/bin/env node
// Exercise the real Codex transport against a local deterministic model fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    let item;
    if (outputs.length) {
      item = {type: "message", id: "msg_done", role: "assistant", status: "completed", content: [{type: "output_text", text: "fixture complete", annotations: []}]};
    } else {
      const namespace = body.tools?.find(tool => tool.type === "namespace" && tool.name === "mcp__context_mode");
      const tool = namespace?.tools?.find(tool => tool.name === "ctx_execute") || body.tools?.find(tool => /ctx_execute$/.test(tool.name));
      assert.ok(tool, `ctx_execute absent: ${body.tools?.map(t => t.name || t.type).join(", ")}`);
      item = {type: "function_call", id: "fc_probe", call_id: "probe", name: tool.name, ...(namespace ? {namespace: namespace.name} : {}), arguments: JSON.stringify({language: "javascript", code: "console.log(JSON.stringify({cwd:process.cwd(),thread:process.env.CODEX_THREAD_ID}))"}), status: "completed"};
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
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, "config.toml"), `model = "gpt-5.1"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${fixture.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[mcp_servers.context-mode]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(join(packageRoot, "server.bundle.mjs"))}]\n[mcp_servers.context-mode.env]\nCONTEXT_MODE_PLATFORM = "codex"\nCODEX_HOME = ${JSON.stringify(codexHome)}\n`);
  const child = spawn(codex, ["-c", 'mcp_servers.context-mode.tools.ctx_execute.approval_mode="approve"', ...args], {cwd: project, env: {PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome}, stdio: ["pipe", "pipe", "pipe"]});
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => { children.delete(child); resolve({code, stdout, stderr}); });
  });
  child.on("exit", () => { if (child.exitCode !== 0) console.error(stderr + stdout); });
  return {child, done, project};
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
} finally {
  clearTimeout(timeout);
  for (const child of children) child.kill("SIGTERM");
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  rmSync(root, {recursive: true, force: true});
}
