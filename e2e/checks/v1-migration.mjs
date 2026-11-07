#!/usr/bin/env node
// e2e/checks/v1-migration.mjs <agent> [--root <dir>] — the R8 v1 -> v2 switch rehearsal for one agent.
// Spec: docs/architecture/modules/15-v1-transition.md §3; ADR-0017 R3, R4, R6, R8; ADR-0011 "v1 cleanup";
// DECISIONS-r4 A37 (Kiro steering doc), B28 (VS Code session paths, .vscode/mcp.json); DEVIATIONS D-M7-arch-6.
//
// Steps (one path, no fallback):
//   1. temp HOME (+ temp TMPDIR, temp npm_config_prefix whose bin dir is first on PATH) under --root or os.tmpdir()
//   2. plantV1Install(agent, home); the project dir is a git repo (resolveProject needs one)
//   3. spawn release-out/server.mjs --agent <agent> (the built server bundle; D-M7-arch-6 calls it
//      "server.bundle.mjs", build/build.mjs writes server.mjs) and call MCP ctx_doctor (before), ctx_upgrade,
//      ctx_doctor (after)
//   4. Pennix: D4 retains its WARN findings; ctx_upgrade names Lifecycle and preserves host files.
//      Seeded legacy configuration/data remain byte-identical; doctor may create native runtime files.
//   5. remove the planted global bin (stands for `npm uninstall -g context-mode`, R3 order: last)
//   6. run every hook command from release-out/hooks/<agent>.json (the hook entries the install writes) with
//      the GP3 fixture on stdin; expect exit 0
// Output: one JSON line {ok, agent, steps:[{step, ok, detail}]}; exit 0 when ok, else 1.
// Rules: no src/ import (GS4); deletes only the temp dir it made.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBundle } from "../harness/mcp-client.mjs";
import { plantV1Install, v1GlobalBin, v1NpmBinDir, v1NpmPrefix, v1Project } from "../live/cases/v1-migration-setup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE_OUT = path.join(ROOT, "release-out");
const SERVER_BUNDLE = path.join(RELEASE_OUT, "server.mjs");
const FIXTURES = path.join(ROOT, "e2e", "fixtures");
const FIXTURE_EVENT = "PreToolUse.json"; // GP3 fixture-replay payload
const FIXTURE_FALLBACK_AGENT = "claude-code"; // agents with no recorded fixture get the Claude-shape payload
const INIT = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-v1-migration", version: "0" } };
const HOOK_TIMEOUT_MS = 30000;
const ROW_SEP = " | ";
const D4_PREFIX = "| D4 "; // report.ts rowLine: "| " + id + " " + label
const WORKSPACE_FOLDER_FLAG = "--workspace-folder"; // VS Code project source (D-M1-5)

// impl/15 §3.2: the six agents whose v1 hooks (or v1 data) the R8 set rehearses.
const CASE_AGENTS = Object.freeze(["claude-code", "codex", "gemini", "copilot-cli", "vscode", "kiro"]);

// Pennix keeps legacy configuration/data untouched until the corresponding owner migrates or removes it.
function hostSnapshot(home) {
  const files = {};
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (file === path.join(home, ".context-mode", "projects")) continue; // the running bundle owns its new project DB
      if (statSync(file).isDirectory()) visit(file);
      else files[path.relative(home, file)] = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
  }
  visit(home);
  return files;
}

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const agent = process.argv[2];
const steps = [];
const step = (name, ok, detail = "") => { steps.push({ step: name, ok, detail }); return ok; };

function finish(tempDir) {
  if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
  const ok = steps.length > 0 && steps.every((s) => s.ok);
  console.log(JSON.stringify({ ok, agent, steps }));
  process.exit(ok ? 0 : 1);
}

const text = (r) => r?.content?.[0]?.text ?? "";

/** The D4 row {status, detail, line} from the doctor table ("| D4 old entries | WARN | <detail> | <fix> |"), or null. */
function d4Row(report) {
  for (const line of report.split("\n")) {
    if (!line.startsWith(D4_PREFIX)) continue;
    const cells = line.split(ROW_SEP);
    return { status: cells[1], detail: cells[2] ?? "", line };
  }
  return null;
}

/** Every string value under a "command" key, in file order, without duplicates. */
function commandsOf(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) commandsOf(v, out); return out; }
  if (node === null || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === "command" && typeof v === "string") { if (!out.includes(v)) out.push(v); }
    else commandsOf(v, out);
  }
  return out;
}

/** GP3 fixture payload: e2e/fixtures/<agent>/<newest ver>/PreToolUse.json, or the Claude-shape one. */
function fixturePayload(project) {
  const own = path.join(FIXTURES, agent);
  const versIn = (b) => readdirSync(b).filter((v) => statSync(path.join(b, v)).isDirectory() && existsSync(path.join(b, v, FIXTURE_EVENT))).sort();
  // D-FU-OI-KIRO-1: an agent dir that holds no PreToolUse.json (kiro: SessionStart only) uses the Claude-shape payload.
  const base = existsSync(own) && versIn(own).length > 0 ? own : path.join(FIXTURES, FIXTURE_FALLBACK_AGENT);
  const vers = versIn(base);
  const payload = JSON.parse(readFileSync(path.join(base, vers[vers.length - 1], FIXTURE_EVENT), "utf8"));
  payload.cwd = project;
  return payload;
}

async function main() {
  if (!CASE_AGENTS.includes(agent)) {
    step("args", false, `usage: v1-migration.mjs <${CASE_AGENTS.join("|")}> [--root <dir>]`);
    return finish(null);
  }
  if (!existsSync(SERVER_BUNDLE)) {
    step("bundle", false, `missing ${SERVER_BUNDLE}: run node build/build.mjs --out release-out`);
    return finish(null);
  }
  const rootDir = arg("--root") ?? os.tmpdir();
  mkdirSync(rootDir, { recursive: true });
  const temp = realpathSync.native(mkdtempSync(path.join(rootDir, `cm-v1-migration-${agent}-`)));
  const home = path.join(temp, "home");
  const tmp = path.join(temp, "tmp");
  mkdirSync(home);
  mkdirSync(tmp);

  // Step 2: plant v1, then make the project a git repo.
  plantV1Install(agent, home);
  const project = v1Project(home);
  mkdirSync(project, { recursive: true });
  execFileSync("git", ["init", "-q", project]);
  const bin = v1GlobalBin(home);
  step("plant", existsSync(bin), bin);
  const codexHome = path.join(home, ".codex");
  const threadId = randomUUID();
  if (agent === "codex") {
    mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
    writeFileSync(path.join(codexHome, "sessions", `rollout-fixture-${threadId}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: threadId, cwd: project } }) + "\n");
  }
  const hostBefore = hostSnapshot(home);

  const env = {
    PATH: v1NpmBinDir(home) + path.delimiter + (process.env.PATH ?? ""),
    HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    npm_config_prefix: v1NpmPrefix(home),
    ...(agent === "claude-code" ? { CLAUDE_PROJECT_DIR: project } : {}),
  };

  // Step 3: doctor (before) -> upgrade -> doctor (after), one server process, cwd = project.
  const prevCwd = process.cwd();
  process.chdir(project);
  const c = spawnBundle(SERVER_BUNDLE, env, ["--agent", agent, ...(agent === "vscode" ? [WORKSPACE_FOLDER_FLAG, project] : [])]);
  process.chdir(prevCwd);
  let before = "", upgrade = "", after = "", upgradeErr = false;
  const call = (name) => c.request("tools/call", { name, arguments: {}, ...(agent === "codex" ? { _meta: { threadId } } : {}) });
  try {
    await c.request("initialize", INIT);
    c.notify("notifications/initialized");
    before = text(await call("ctx_doctor"));
    const upgradeBefore = hostSnapshot(home);
    const u = await call("ctx_upgrade");
    upgrade = text(u);
    upgradeErr = u?.isError === true;
    step("upgrade-host-files-preserved", JSON.stringify(hostSnapshot(home)) === JSON.stringify(upgradeBefore), "ctx_upgrade changes no host file");
    after = text(await call("ctx_doctor"));
  } catch (err) {
    step("mcp", false, String(err?.message ?? err));
  } finally {
    await c.close().catch(() => c.kill());
  }
  if (steps.some((s) => !s.ok)) return finish(temp);

  // Step 4: diagnostics retain the findings; ctx_upgrade hands off without changing host files.
  const d4Before = d4Row(before);
  // D-D4-WARN-1 (#1304): 1.x leftovers are WARN with the fix, not FAIL.
  step("doctor-before-d4-warn", d4Before?.status === "WARN", d4Before?.line ?? before.split("\n")[0]);
  step("upgrade-owner", !upgradeErr && upgrade.includes("pennix"), upgrade.split("\n").slice(0, 3).join(" / "));
  const d4After = d4Row(after);
  step("doctor-after-d4", d4After?.status === "WARN" && d4After?.detail === d4Before?.detail, d4After?.line ?? "no D4 row");
  const hostAfter = hostSnapshot(home);
  step("host-files-preserved", Object.entries(hostBefore).every(([file, hash]) => hostAfter[file] === hash), "all seeded config and legacy data retain their bytes; doctor may create native runtime files");

  // Step 5: npm uninstall -g (R3: last).
  rmSync(bin, { force: true });
  step("uninstall-global-bin", !existsSync(bin), bin);

  // Step 6: the written hook commands still run (they never call the global bin).
  // D-FU-RM-GEMINI-1: Gemini reads only <ext>/hooks/hooks.json, and its commands name the script as
  // ${extensionPath}${/}hook.mjs; the host fills both, so the check does the same (as windows-hosts.mjs does).
  const hooksFile = path.join(RELEASE_OUT, "hooks", agent === "gemini" ? "hooks.json" : `${agent}.json`);
  const hostFill = (cmd) => cmd.split("${extensionPath}").join(RELEASE_OUT).split("${/}").join(path.sep);
  const commands = existsSync(hooksFile) ? commandsOf(JSON.parse(readFileSync(hooksFile, "utf8"))).map(hostFill) : [];
  step("hook-commands", commands.length > 0, hooksFile);
  const payload = JSON.stringify(fixturePayload(project));
  for (const cmd of commands) {
    const r = spawnSync(cmd, { shell: true, cwd: RELEASE_OUT, input: payload, encoding: "utf8", timeout: HOOK_TIMEOUT_MS,
      env: { ...env, CLAUDE_PLUGIN_ROOT: RELEASE_OUT, CLAUDE_PROJECT_DIR: project } });
    step(`hook ${cmd}`, r.status === 0, r.status === 0 ? "exit 0" : `exit ${r.status}: ${(r.stderr || r.stdout || "").split("\n")[0]}`);
  }
  return finish(temp);
}

main().catch((err) => { step("crash", false, String(err?.stack ?? err).split("\n")[0]); finish(null); });
