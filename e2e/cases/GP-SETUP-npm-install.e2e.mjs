// Black-box scoped package, read-only setup plans and Lifecycle write ownership.
// Native host migration and uninstall are verified by the Lifecycle owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

// D-SETUP-COPILOT-SHIM-1 (#1360, dup #1361): VS Code's `copilot` launcher (microsoft/vscode copilot_shim, Linux
// /usr/bin/copilot) is on PATH but the Copilot CLI is not installed. With no terminal it prints "GitHub Copilot CLI was
// not found. ..." and exits 127 (app.rs l.42, l.485). The user ran `context-mode setup` and got FAIL (rolled back),
// exit 1 and a gh issue prompt. The built bin must report SKIPPED with Copilot CLI's own npm install, exit 0, no prompt.
test("[M6] GP-SETUP/copilot-launcher-without-cli: setup reports copilot-cli SKIPPED with npm install -g @github/copilot, exit 0, no issue prompt (#1360)", { timeout: 300_000, skip: WIN && "the stand-in launcher is a sh script" }, () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "cm-setup-copilot-shim-"));
  try {
    const home = path.join(tmp, "home");
    const bin = path.join(tmp, "bin");
    const outDir = path.join(tmp, "out");
    for (const d of [home, bin]) mkdirSync(d, { recursive: true });
    execFileSync(process.execPath, [path.join(REPO_ROOT, "build", "build.mjs"), "--out", outDir, "--version", VERSION], { cwd: REPO_ROOT, stdio: "pipe" });
    const log = path.join(tmp, "copilot.log");
    writeFileSync(path.join(bin, "copilot"), `#!/bin/sh
echo "$@" >> "${log}"
echo "GitHub Copilot CLI was not found. Run copilot in a terminal to install it, or see https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" >&2
exit 127
`);
    chmodSync(path.join(bin, "copilot"), 0o755);
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), PATH: [bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter) };
    delete env.CLAUDE_PROJECT_DIR;
    let code = 0, out = "";
    try {
      out = execFileSync(process.execPath, [path.join(outDir, "cli.mjs"), "setup", "--agents", "copilot-cli", "--yes", "--no-input"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { code = e.status; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    assert.equal(code, 2, out);
    assert.match(out, /Lifecycle/);
    assert.equal(out.includes("gh issue create"), false, `no issue prompt for a missing host: ${out}`);
    assert.equal(out.includes("FAIL"), false, out);
    assert.equal(existsSync(path.join(home, ".copilot")), false, "nothing written for a missing host");
    assert.equal(existsSync(log), false, "disabled setup never invokes the launcher");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// #1335 (D-R54-CLAUDE-MISE-1): mise installs `claude` as a symlink shim, shims/claude -> ../bin/mise, a native
// multi-call binary that reads argv[0] to pick the tool. Setup ran the realpath of the PATH file, so mise saw argv[0]
// "mise" and printed "error: unrecognized subcommand 'marketplace'" (exit 2): setup FAIL, bin: .../bin/mise. The stand-in
// below is compiled C with the same dispatch: argv[0] "claude" acts as Claude Code, any other name acts as mise.
const MISE_STANDIN = String.raw`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libgen.h>
int main(int argc, char **argv) {
  const char *state = getenv("FAKE_STATE");
  if (strcmp(basename(argv[0]), "claude") != 0) {
    if (argc > 2 && (strcmp(argv[1], "plugin") == 0 || strcmp(argv[1], "plugins") == 0)) {
      fprintf(stderr, "error: unrecognized subcommand '%s'\n\nUsage: mise plugins [FLAGS] [SUBCOMMAND]\n", argv[2]);
      return 2;
    }
    return 2;
  }
  if (argc > 1 && strcmp(argv[1], "--version") == 0) { puts("2.1.319 (Claude Code)"); return 0; }
  if (argc > 2 && strcmp(argv[1], "plugin") == 0) {
    if (strcmp(argv[2], "install") == 0) { FILE *f = fopen(state, "w"); if (f) fclose(f); return 0; }
    if (strcmp(argv[2], "uninstall") == 0) { remove(state); return 0; }
    if (strcmp(argv[2], "list") == 0) { FILE *f = fopen(state, "r"); if (f) { fclose(f); puts("context-mode@context-mode 2.0.0"); } return 0; }
  }
  return 0;
}
`;

test("[M6] GP-SETUP/claude-mise-shim: setup claude-code via a mise-style symlink shim runs the shim, PASS, and the bin line names the shim (#1335)", { timeout: 300_000, skip: WIN && "mise shims are symlinks to a Unix binary" }, (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "cm-setup-mise-"));
  try {
    const home = path.join(tmp, "home");
    const miseBin = path.join(tmp, "mise", "bin");
    const shims = path.join(tmp, "mise", "shims");
    const outDir = path.join(tmp, "out");
    for (const d of [home, miseBin, shims]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(tmp, "mise.c"), MISE_STANDIN);
    try { execFileSync("cc", ["-O2", "-o", path.join(miseBin, "mise"), path.join(tmp, "mise.c")], { stdio: "pipe" }); }
    catch (e) { t.skip(`no C compiler for the mise stand-in: ${e.message}`); return; }
    symlinkSync(path.join("..", "bin", "mise"), path.join(shims, "claude"));
    execFileSync(process.execPath, [path.join(REPO_ROOT, "build", "build.mjs"), "--out", outDir, "--version", VERSION], { cwd: REPO_ROOT, stdio: "pipe" });
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      FAKE_STATE: path.join(tmp, "claude.state"), PATH: [shims, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter) };
    delete env.CLAUDE_PROJECT_DIR;
    const cli = (...args) => {
      try { return { code: 0, out: execFileSync(process.execPath, [path.join(outDir, "cli.mjs"), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (e) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
    };
    const shimBin = `bin: ${path.join(shims, "claude")}`;
    const setup = cli("setup", "--agents", "claude-code", "--yes", "--no-input");
    assert.equal(setup.out.includes("unrecognized subcommand"), false, `mise never saw the claude call: ${setup.out}`);
    assert.equal(setup.code, 2, setup.out);
    assert.match(setup.out, /Lifecycle/);
    assert.equal(existsSync(env.FAKE_STATE), false, "disabled setup never installs the plugin");
    const doc = cli("doctor", "--agents", "claude-code");
    const drow = doc.out.split("\n").find((l) => l.trimStart().startsWith("claude-code") && l.includes(shimBin));
    assert.ok(drow, `doctor names the selected shim: ${doc.out}`);
    assert.equal(doc.out.includes("unrecognized subcommand"), false, doc.out);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
