// Black-box scoped package, read-only setup plans and Lifecycle write ownership.
// Native host migration and uninstall are verified by the Lifecycle owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WIN = process.platform === "win32";
const VERSION = "2.1.5-pennix.1";
const ALL_AGENTS = ["claude-code", "codex", "gemini", "qwen", "copilot-cli", "pi", "opencode", "vscode", "kiro", "zcode"];
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}
const snapshot = (home) => new Map(walk(home).sort().map((rel) => [rel, sha(path.join(home, rel))]));

test("[M6] GP-SETUP/npm-pack-managed-install: scoped npm bin prints plans and refuses host writes", { timeout: 600_000 }, (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "cm-setup-e2e-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, "home");
  const prefix = path.join(tmp, "prefix");
  const outDir = path.join(tmp, "out");
  const packDir = path.join(tmp, "pack");
  for (const dir of [home, prefix, packDir]) mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [path.join(REPO_ROOT, "build/build.mjs"), "--out", outDir, "--version", VERSION], { cwd: REPO_ROOT, stdio: "pipe" });
  const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", shell: WIN, windowsHide: true, ...opts });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
    npm_config_cache: path.join(tmp, "npm-cache"), npm_config_userconfig: path.join(tmp, "npmrc"),
    npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false",
  };
  for (const key of ["CLAUDE_PROJECT_DIR", "XDG_CONFIG_HOME", "OPENCODE_CONFIG_DIR"]) delete env[key];
  const packResult = JSON.parse(sh("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: outDir, env }));
  const packed = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
  assert.equal(packed.name, "@pennixrv/context-mode");
  const sums = new Map(readFileSync(path.join(outDir, "SHA256SUMS"), "utf8").trim().split("\n").map((line) => {
    const [hash, ...rel] = line.split("  ");
    return [rel.join("  "), hash];
  }));
  assert.deepEqual(packed.files.map((f) => f.path).sort(), [...sums.keys(), "SHA256SUMS"].sort());
  assert.ok(sums.has("package.json") && sums.has("cli.mjs"));
  sh("npm", ["i", "-g", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", path.join(packDir, packed.filename)], { env });
  const pkgDir = path.join(prefix, ...(WIN ? [] : ["lib"]), "node_modules", "@pennixrv", "context-mode");
  assert.deepEqual(walk(pkgDir).sort(), [...sums.keys(), "SHA256SUMS"].sort());
  for (const [rel, hash] of sums) assert.equal(sha(path.join(pkgDir, rel)), hash, rel);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@pennixrv/context-mode");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  const bin = path.join(prefix, ...(WIN ? ["context-mode.cmd"] : ["bin", "context-mode"]));
  const cm = (args) => {
    try { return { code: 0, stdout: sh(bin, args, { env }), stderr: "" }; }
    catch (e) { return { code: e.status, stdout: `${e.stdout ?? ""}`, stderr: `${e.stderr ?? ""}` }; }
  };
  assert.equal(cm(["--version"]).stdout.trim(), VERSION);
  mkdirSync(env.CODEX_HOME, { recursive: true });
  writeFileSync(path.join(env.CODEX_HOME, "config.toml"), 'model = "mine"\n');
  writeFileSync(path.join(env.CODEX_HOME, "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "context-mode hook codex pretooluse" }] }] } }));
  const before = snapshot(home);
  for (const agent of ALL_AGENTS) {
    const result = cm(["setup", "--print", agent, "--json"]);
    assert.equal(result.code, 0, `${agent}: ${result.stderr}`);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.print.agent, agent);
    assert.ok(Array.isArray(plan.print.steps) && plan.print.steps.length > 0, agent);
    assert.deepEqual(snapshot(home), before, `${agent} plan is read-only`);
  }
  for (const args of [
    ["setup", "--yes", "--agents", ALL_AGENTS.join(","), "--json"],
    ["setup", "--remove", "--yes", "--json"],
    ["setup", "--dry-run", "--json"],
    ["upgrade"],
  ]) {
    const result = cm(args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stdout + result.stderr, /pennix/);
    assert.deepEqual(snapshot(home), before, `${args.join(" ")} preserves every HOME file`);
  }
});
