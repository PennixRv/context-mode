// tests/0019-cli.test.mjs
// ADR-0019 (one interactive context-mode setup), PRD-setup. CLI behaviour through the real entry and a real pty.

import { after, before, describe, test } from "node:test";
import { SETUP_NODE } from "../src/setup/registry.ts"; // D-STABLE-NODE-1
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS } from "../src/adapters/table.ts";
import { TOOL_ORDER } from "../src/core/contracts/constants.ts";
import { vscodeUserDirOf } from "../src/core/project/config-dir.ts";
import { isEntry } from "../src/entries/is-entry.ts";

// Serial: tests share one scratch dir and one built package from before(); every CLI call is spawnSync, which blocks the event loop.
describe("ADR-0019 cli", () => {
  describe("ADR-0019 setup, doctor and CLI conventions", () => {
    // Spec: docs/architecture/adr/0019-interactive-setup-and-npm-channel.md sections 4-8 and Owner decisions D4-D7.
    // E2E style: build the real release tree once, copy the bundled cli.mjs next to a fake server.mjs and hook.mjs
    // (the CLI finds its siblings from its own path), then drive `context-mode` with a temp HOME and a temp PATH.
    // Interactive runs go through a real pty (python3 pty, tests/_lib/pty-run.py).


    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const REPO = path.resolve(HERE, "..");
    const GOLDEN = path.join(REPO, "e2e", "golden", "cli");
    const PTY = path.join(HERE, "_lib", "pty-run.py");
    const ESC = "\x1b";
    let scratch;
    let out;

    before(() => {
      scratch = mkdtempSync(path.join(tmpdir(), "cm-v2-cli-"));
      out = path.join(scratch, "out");
      const r = spawnSync(process.execPath, [path.join(REPO, "build", "build.mjs"), "--out", out, "--version", "2.0.0"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    });
    after(() => rmSync(scratch, { recursive: true, force: true }));

    const FAKE_SERVER = `
  import { createInterface } from "node:readline";
  import { closeSync } from "node:fs";
  if (process.env.CM_FAKE_BROKEN) process.exit(3);
  // CM_FAKE_NOSTDIN: a server that closes its input and then answers initialize. The CLI's next write hits a closed pipe
  // (EPIPE), the same thing a server that dies right after start does on a fast or loaded host.
  if (process.env.CM_FAKE_NOSTDIN) { try { closeSync(0); } catch { /* Windows may refuse; the server then never reads again anyway */ } process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "context-mode", version: "2.0.0" } } }) + "\\n"); await new Promise((r) => setTimeout(r, 30000)); process.exit(0); } // never reads again: no tools/list answer on any OS
  const tools = ${JSON.stringify([...TOOL_ORDER])};
  const delay = process.env.CM_FAKE_SLOW ? 4000 : 0;
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (l) => {
    const m = JSON.parse(l);
    if (m.id === undefined) return;
    const result = m.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "context-mode", version: "2.0.0" } }
      : { tools: tools.map((name) => ({ name, inputSchema: { type: "object" } })) };
    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n"), delay);
  });
  `;
    const FAKE_HOOK = `let s = ""; process.stdin.on("data", (d) => { s += d; }); process.stdin.on("end", () => { const p = JSON.parse(s); if (!JSON.stringify(p).includes("context-mode-doctor-hook-runs")) return; const t = "deny: run ctx_execute; ctx_search( finds the rest"; process.stderr.write(t + "\\n"); process.stdout.write(JSON.stringify({ decision: "deny", reason: t })); });\n`;

    /** A fake installed package: the real bundled cli.mjs next to fake server.mjs and hook.mjs. */
    function makePkg(dir) {
      mkdirSync(dir, { recursive: true });
      copyFileSync(path.join(out, "cli.mjs"), path.join(dir, "cli.mjs"));
      writeFileSync(path.join(dir, "server.mjs"), FAKE_SERVER);
      writeFileSync(path.join(dir, "hook.mjs"), FAKE_HOOK);
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "context-mode", version: "2.0.0", type: "module" }));
      cpSync(path.join(REPO, "skills"), path.join(dir, "skills"), { recursive: true }); // ADR-0020: package ships skills/
      cpSync(path.join(REPO, "skills"), path.join(dir, "pi", "skills"), { recursive: true }); // D-HQ-SKILLS-1: pi prefix is ""
      cpSync(path.join(REPO, "skills"), path.join(dir, "claude-code", "skills"), { recursive: true }); // D-HQ-SKILLS-2
      return dir;
    }

    function sandbox(t) {
      const root = mkdtempSync(path.join(scratch, "sb-"));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const home = path.join(root, "home");
      const bin = path.join(root, "bin");
      mkdirSync(home, { recursive: true });
      mkdirSync(bin, { recursive: true });
      const pkg = makePkg(path.join(root, "pkg"));
      // D-HL-GATE-1: timing is not under test in the cli tests (the D3 gate has its own tests and e2e check): same CI-only
      // knob as the engine, hooks-all and zcode-shape sandboxes, so a loaded host does not flip a PASS row.
      const env = { PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter), HOME: home, USERPROFILE: home, NO_COLOR: "1", LOG: path.join(root, "calls.log"), CM_HOOK_OVERHEAD_BUDGET_MS: "60000" };
      return { root, home, bin, pkg, env };
    }

    function fakeBin(s, name, script) {
      const file = path.join(s.bin, name);
      writeFileSync(file, `#!/bin/sh\n${script}\n`);
      chmodSync(file, 0o755);
    }

    function run(s, args, { env = {}, input = "", timeout = 60_000 } = {}) {
      const r = spawnSync(process.execPath, [path.join(s.pkg, "cli.mjs"), ...args], { encoding: "utf8", input, timeout, env: { ...s.env, ...env } });
      assert.equal(r.error, undefined, `context-mode ${args.join(" ")} did not finish: ${r.error}`);
      return r;
    }

    function pty(s, args, steps, { env = {}, timeout = 40 } = {}) {
      const spec = { argv: [process.execPath, path.join(s.pkg, "cli.mjs"), ...args], env: { ...s.env, TERM: "xterm-256color", ...env }, steps, timeout };
      const r = spawnSync("python3", ["-I", PTY, JSON.stringify(spec)], { encoding: "utf8", timeout: (timeout + 20) * 1000 });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    }

    /** Every file under dir with its bytes, so a test can prove nothing changed. */
    function snapshot(dir) {
      const outMap = {};
      const walk = (d) => {
        if (!existsSync(d)) return;
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f); else outMap[path.relative(dir, f)] = readFileSync(f, "utf8");
        }
      };
      walk(dir);
      return outMap;
    }

    const CODEX_V1 = `model = "o3"\n\n[mcp_servers.context-mode]\ncommand = "context-mode"\n`;
    function codexHome(s, text = CODEX_V1) {
      const f = path.join(s.home, ".codex", "config.toml");
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, text);
      return f;
    }

    // Pennix owns installation via Lifecycle; upstream's registry/engine tests stay independent.
    for (const args of [
      ["setup"], ["setup", "--yes", "--agents", "codex"],
      ["setup", "--remove", "--yes"], ["setup", "--repair", "--yes"],
      ["setup", "--dry-run", "--agents", "codex"],
      ["upgrade"], ["upgrade", "--yes"], ["upgrade", "--dry-run", "--tag", "beta"],
    ]) for (const json of [false, true]) {
      test(`Pennix owner boundary: ${args.join(" ")} json=${json}`, t => {
        const s = sandbox(t);
        codexHome(s);
        fakeBin(s, "npm", 'echo unexpected-npm >> "$LOG"; exit 99');
        const before = snapshot(s.home);
        const r = run(s, [...args, ...(json ? ["--json"] : [])]);
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stdout + r.stderr, /pennix-component-lifecycle/);
        if (json) assert.equal(JSON.parse(r.stdout).status, "owner_required");
        assert.deepEqual(snapshot(s.home), before);
        assert.equal(existsSync(s.env.LOG), false, "no installation subprocess");
      });
    }

    // ---------- D7: help, exit codes, streams ----------

    for (const [name, args] of [["main", ["--help"]], ["setup", ["setup", "--help"]], ["doctor", ["doctor", "--help"]], ["upgrade", ["upgrade", "--help"]]]) {
      test(`[M7] cli/help-golden: context-mode ${args.join(" ")} equals e2e/golden/cli/help-${name}.txt`, (t) => {
        const s = sandbox(t);
        const r = run(s, args);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, "");
        assert.equal(r.stdout, readFileSync(path.join(GOLDEN, `help-${name}.txt`), "utf8"));
        assert.match(r.stdout, /Examples:/);
        assert.match(r.stdout, /Exit codes:[\s\S]*0[\s\S]*1[\s\S]*2[\s\S]*130/);
      });
    }

    test("[M7] cli/help-word: `context-mode help <command>` prints that command's help; an unknown topic is exit 2", (t) => {
      const s = sandbox(t);
      for (const cmd of ["setup", "doctor", "upgrade"]) {
        const r = run(s, ["help", cmd]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, readFileSync(path.join(GOLDEN, `help-${cmd}.txt`), "utf8"));
      }
      const bad = run(s, ["help", "setpu"]);
      assert.equal(bad.status, 2);
      assert.match(bad.stderr, /Did you mean "setup"/);
    });


    test("[M7] cli/help-short: -h works on every command and writes nothing", (t) => {
      const s = sandbox(t);
      for (const cmd of ["setup", "doctor", "upgrade"]) {
        const r = run(s, [cmd, "-h"]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, new RegExp(`Usage: context-mode ${cmd}`));
      }
      assert.deepEqual(snapshot(s.home), {});
    });

    test("[M7] cli/typo-command: an unknown command suggests the closest one, exit 2", (t) => {
      const s = sandbox(t);
      const r = run(s, ["setpu"]);
      assert.equal(r.status, 2);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /unknown command "setpu"/);
      assert.match(r.stderr, /Did you mean "setup"\?/);
    });

    test("[M7] cli/typo-flag: an unknown flag suggests the closest one, exit 2, nothing written", (t) => {
      const s = sandbox(t);
      codexHome(s);
      const before = snapshot(s.home);
      const r = run(s, ["setup", "--dryrun"]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /unknown option "--dryrun"/);
      assert.match(r.stderr, /Did you mean "--dry-run"\?/);
      assert.deepEqual(snapshot(s.home), before);
    });

    test("[M7] cli/exit-usage: unknown agent in --agents and a missing flag value are usage errors (2)", (t) => {
      const s = sandbox(t);
      const a = run(s, ["setup", "--yes", "--agents", "codexx"]);
      assert.equal(a.status, 2);
      assert.match(a.stderr, /unknown agent "codexx"/);
      assert.match(a.stderr, /Did you mean "codex"\?/);
      const b = run(s, ["setup", "--agents"]);
      assert.equal(b.status, 2);
      assert.match(b.stderr, /--agents needs a value/);
    });




    test("[WIN] cli/home-rule: setup uses the D-M1-T3-1 home rule (HOME, then USERPROFILE), the same as hooks and server (D-WIN-HOME-1)", (t) => {
      const s = sandbox(t);
      codexHome(s);
      const env = { ...s.env, USERPROFILE: s.home };
      delete env.HOME; // a Windows shell with no HOME: the, USERPROFILE: the profile dir is the only home
      const r = spawnSync(process.execPath, [path.join(s.pkg, "cli.mjs"), "setup", "--print", "codex"], { encoding: "utf8", timeout: 60_000, env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes(path.join(s.home, ".codex", "config.toml")), `plan must edit ${s.home}/.codex/config.toml, got:\n${r.stdout}`);
    });

    test("[WIN] cli/home-rule: HOME and USERPROFILE differ (Git Bash, MSYS): win32 plans under USERPROFILE, POSIX under HOME (D-WIN-HOME-2, GEM-WIN-3, PI-WIN-4)", (t) => {
      const s = sandbox(t);
      codexHome(s);
      const other = path.join(s.root, "msys-home"); // a second home the host never reads on Windows
      mkdirSync(other, { recursive: true });
      const win = process.platform === "win32";
      const env = { ...s.env, HOME: win ? other : s.home, USERPROFILE: win ? s.home : other };
      const r = spawnSync(process.execPath, [path.join(s.pkg, "cli.mjs"), "setup", "--print", "codex"], { encoding: "utf8", timeout: 60_000, env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes(path.join(s.home, ".codex", "config.toml")), `plan must edit ${s.home}/.codex/config.toml, got:\n${r.stdout}`);
      assert.ok(!r.stdout.includes(other), `plan must not touch the other home ${other}`);
    });

    test("[WIN] cli/home-rule: zcode plans config.json and skills under the os.homedir() home when HOME and USERPROFILE differ (Z-WIN-6, D-WIN-ZCODE-HOME-1)", (t) => {
      // ZCode CLI (zai-org/ZCode 3c5b2276): resolvePath("~/.zcode/cli") = join(homedir(), ...), skills roots = join(homedir(), ".zcode", "skills"); no HOME read.
      const s = sandbox(t);
      const other = path.join(s.root, "msys-home");
      mkdirSync(other, { recursive: true });
      const win = process.platform === "win32";
      const env = { ...s.env, HOME: win ? other : s.home, USERPROFILE: win ? s.home : other };
      const r = spawnSync(process.execPath, [path.join(s.pkg, "cli.mjs"), "setup", "--print", "zcode"], { encoding: "utf8", timeout: 60_000, env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes(path.join(s.home, ".zcode", "cli", "config.json")), `plan must edit ${s.home}/.zcode/cli/config.json, got:\n${r.stdout}`);
      assert.ok(!r.stdout.includes(other), `plan must not touch the other home ${other}`);
    });



    test("[M7] cli/no-color: NO_COLOR output has no escape codes (help, list, setup fail, doctor)", (t) => {
      const s = sandbox(t);
      codexHome(s);
      for (const [args, env] of [[["--help"], {}], [["setup", "--list"], {}], [["setup", "--yes", "--agents", "codex"], { CM_FAKE_BROKEN: "1" }], [["doctor"], {}], [["setup", "--list"], { NO_COLOR: "", TERM: "dumb" }], [["doctor", "--no-color"], { NO_COLOR: "" }]]) {
        const r = run(s, args, { env });
        assert.ok(!r.stdout.includes(ESC) && !r.stderr.includes(ESC), `${args.join(" ")} printed an escape code`);
      }
    });

    test("[M7] cli/list: setup --list prints every supported agent with its support level and writes nothing", (t) => {
      const s = sandbox(t);
      codexHome(s);
      const before = snapshot(s.home);
      const r = run(s, ["setup", "--list"]);
      assert.equal(r.status, 0, r.stderr);
      for (const a of ADAPTERS) assert.match(r.stdout, new RegExp(`^${a.id}\\s`, "m"));
      assert.match(r.stdout, /HOOKS/);
      assert.ok(!r.stdout.includes("MCP only"));
      for (const a of ADAPTERS) assert.match(r.stdout, new RegExp(`^${a.id}\\s+${a.hookChannel.kind}\\s`, "m"));
      assert.match(r.stdout, /^codex\s+.*detected/m);
      assert.deepEqual(snapshot(s.home), before);
      const j = JSON.parse(run(s, ["setup", "--list", "--json"]).stdout);
      assert.equal(j.agents.length, ADAPTERS.length);
      for (const a of j.agents) assert.equal(a.hooks, ADAPTERS.find((x) => x.id === a.id).hookChannel.kind);
    });


    // ---------- doctor ----------


    // ---------- upgrade ----------




    // ---------- D6 issue report ----------



    // ---------- pty: interactive flow, D6 consent, Ctrl-C ----------

    const hasPython = spawnSync("python3", ["-c", "import pty"]).status === 0 && process.platform !== "win32";





    // ---------- setup --print (owner 2026-10-25: users never type paths, JSON or scripts) ----------

    /** Absolute paths in --print output become <NODE>, <PKG>, <HOME> so one golden fits every machine. */
    function normPaths(text, s) {
      let t = text;
      // D-WIN-VSCODE-MCP-1: VS Code's user dir differs per OS (%APPDATA%\\Code\\User, Library/Application Support/Code/User,
      // ~/.config/Code/User). The golden holds the tag; the dir itself is asserted by tests/project/vscode-user-dir.test.mjs.
      for (const home of [realpathSync(s.home), s.home]) {
        const dir = vscodeUserDirOf(s.env, home);
        t = t.replaceAll(JSON.stringify(dir).slice(1, -1), "<VSCODE_USER>").replaceAll(dir, "<VSCODE_USER>");
      }
      // The CLI finds its package dir through realpath (macOS: /var -> /private/var), so map that form first.
      for (const [p, tag] of [[realpathSync(s.pkg), "<PKG>"], [s.pkg, "<PKG>"], [realpathSync(s.home), "<HOME>"], [s.home, "<HOME>"], [SETUP_NODE, "<NODE>"], [process.execPath, "<NODE>"]]) {
        t = t.replaceAll(JSON.stringify(p).slice(1, -1), tag).replaceAll(p, tag);
      }
      // D-HA-CODEX-TRUST-1: a codex trust hash covers the hook command, which holds this sandbox's paths; the golden
      // holds the tag, and cli/print-apply proves the printed hash makes doctor PASS.
      t = t.replace(/trusted_hash = "sha256:[0-9a-f]{64}"/g, 'trusted_hash = "sha256:<HASH>"');
      if (process.platform === "win32") {
        // The goldens hold the POSIX form. On Windows the same step has `\` (`\\` inside TOML/JSON strings) after a
        // tag, and shellWord single-quotes a word with a backslash. Map both back; the product output is right as is.
        t = t.replace(/(<(?:PKG|NODE|HOME|VSCODE_USER)>)((?:\\{1,2}[^\s"'\\]+)+)/g, (_m, tag, rest) => tag + rest.replace(/\\{1,2}/g, "/"));
        t = t.replace(/'(<(?:PKG|NODE|HOME|VSCODE_USER)>[^'\s]*)'/g, "$1");
      }
      return t;
    }

    /** A fake agent CLI: logs every call; `... list` prints context-mode once an install command ran. */
    function fakeAgentBin(s, name) {
      const script = `echo "${name} $*" >> "$LOG"\ncase "$*" in *list*) [ -f "$LOG.done" ] && echo context-mode;; *) touch "$LOG.done";; esac\nexit 0`;
      if (name !== "claude") return fakeBin(s, name, script);
      // OPEN-ITEMS H8: setup runs only the real Claude Code, so the fake lives in npm's layout for @anthropic-ai/claude-code.
      const pkg = path.join(s.root, "npm", "lib", "node_modules", "@anthropic-ai", "claude-code");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-code", version: "2.0.0" }));
      writeFileSync(path.join(pkg, "cli.sh"), `#!/bin/sh\n${script}\n`);
      chmodSync(path.join(pkg, "cli.sh"), 0o755);
      if (!existsSync(path.join(s.bin, name))) symlinkSync(path.join(pkg, "cli.sh"), path.join(s.bin, name));
    }

    for (const a of ADAPTERS) {
      test(`[M7] cli/print-golden: setup --print ${a.id} equals e2e/golden/cli/print-${a.id}.txt and writes nothing`, (t) => {
        const s = sandbox(t);
        const before = snapshot(s.home);
        const r = run(s, ["setup", "--print", a.id]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, "");
        assert.equal(normPaths(r.stdout, s), readFileSync(path.join(GOLDEN, `print-${a.id}.txt`), "utf8"));
        assert.deepEqual(snapshot(s.home), before, "--print must not write");
        assert.equal(existsSync(path.join(s.home, ".context-mode")), false, "no state dir");
      });

      test(`[M7] cli/print-apply: the --print --json step for ${a.id}, applied by hand, makes doctor PASS`, { skip: process.platform === "win32" && "fake agent CLIs are sh scripts" }, (t) => {
        const s = sandbox(t);
        const r = run(s, ["setup", "--print", a.id, "--json"]);
        assert.equal(r.status, 0, r.stderr);
        const j = JSON.parse(r.stdout);
        assert.equal(j.command, "setup");
        assert.equal(j.print.agent, a.id);
        assert.equal(j.print.verify, `context-mode doctor --agents ${a.id}`);
        assert.ok(j.print.steps.length >= 1);
        assert.equal(existsSync(path.join(s.home, ".context-mode")), false, "--json --print writes nothing");
        for (const step of j.print.steps) {
          if (step.kind === "config") {
            assert.ok(path.isAbsolute(step.file) && step.file.startsWith(s.home), step.file);
            mkdirSync(path.dirname(step.file), { recursive: true });
            writeFileSync(step.file, step.block);
          } else if (step.kind === "hook") {
            // ADR-0020: the hook block goes next to the user's keys (zcode and opencode share the config file).
            assert.ok(path.isAbsolute(step.file) && step.file.startsWith(s.home), step.file);
            mkdirSync(path.dirname(step.file), { recursive: true });
            const cur = existsSync(step.file) ? JSON.parse(readFileSync(step.file, "utf8")) : {};
            writeFileSync(step.file, JSON.stringify({ ...cur, ...JSON.parse(step.block) }, null, 2) + "\n");
          } else if (step.kind === "skill") {
            assert.ok(path.isAbsolute(step.file) && step.file.startsWith(s.home), step.file);
            mkdirSync(path.dirname(step.file), { recursive: true });
            writeFileSync(step.file, step.block);
          } else {
            assert.equal(step.kind, "run");
            fakeAgentBin(s, step.argv[0]);
            const c = spawnSync(step.argv[0], step.argv.slice(1), { env: s.env, input: step.input ?? "", encoding: "utf8" });
            assert.equal(c.status, 0, c.stderr);
          }
        }
        const d = run(s, ["doctor", "--agents", a.id, "--json"]);
        assert.equal(d.status, 0, d.stdout + d.stderr);
        assert.equal(JSON.parse(d.stdout).agents.find((x) => x.id === a.id).status, "PASS");
      });
    }


    test("[M7] cli/print-usage: --print needs a known agent and cannot mix with other setup modes (exit 2)", (t) => {
      const s = sandbox(t);
      const typo = run(s, ["setup", "--print", "codx"]);
      assert.equal(typo.status, 2);
      assert.match(typo.stderr, /unknown agent "codx"\. Did you mean "codex"\?/);
      assert.equal(run(s, ["setup", "--print"]).status, 2);
      for (const extra of [["--remove"], ["--list"], ["--dry-run"], ["--repair"], ["--agents", "codex"]]) {
        const r = run(s, ["setup", "--print", "codex", ...extra]);
        assert.equal(r.status, 2, extra.join(" "));
        assert.match(r.stderr, /--print cannot be used with/);
      }
      assert.equal(existsSync(path.join(s.home, ".context-mode")), false);
    });

    // D-INST-7: new-user test round 2. A PASS row says what was checked; the plan line for a report-only finding says
    // nothing is to be done; --print says the agent, not its id, restarts.

    // D-HL-GATE-1: cli tests check what setup and doctor print, not hook timing (timing is gated by the D3 engine
    // tests and e2e/checks/setup-hook-overhead.mjs). A loaded host (the full suite in parallel) must not flip a PASS row.

    // OPEN-ITEMS H8: a wrapper first on PATH (claude-worktree shim) is skipped; doctor names the claude it ran.

    test("[M7] cli/print-text: --print never names a bare agent id as the thing to restart, and says what to do with a missing file", (t) => {
      const s = sandbox(t);
      const cfg = run(s, ["setup", "--print", "codex"]);
      assert.match(cfg.stdout, /Then restart the agent and check it: context-mode doctor --agents codex/);
      assert.match(cfg.stdout, /If the folder or file is missing, create it/);
      assert.match(cfg.stdout, /These paths are for this machine/);
      const cmd = run(s, ["setup", "--print", "claude-code"]);
      assert.doesNotMatch(cmd.stdout, /restart claude-code/);
    });
  });

  describe("ADR-0019 cli entry (isEntry)", () => {
    // D-HNE-CLI-ENTRY-1: import.meta.main exists from Node 24.2. On Node 22 (Copilot CLI's own minimum) it is undefined, so
    // cli.mjs ran nothing: `context-mode --version`, `setup`, `doctor` and the v1 `hook <platform> <event>` form exited 0
    // with no output. isEntry decides "am I the process entry" without import.meta.main when it is missing.


    test("[D-HNE-CLI-ENTRY-1] cli/isEntry trusts import.meta.main when the Node has it", () => {
      assert.equal(isEntry(true, undefined, "/x/cli.mjs"), true);
      assert.equal(isEntry(false, "/x/cli.mjs", "/x/cli.mjs"), false);
    });

    test("[D-HNE-CLI-ENTRY-1] cli/isEntry on Node 22 (import.meta.main undefined) compares argv[1] with this file", (t) => {
      const dir = mkdtempSync(path.join(tmpdir(), "cm-cli-entry-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const self = path.join(dir, "cli.mjs");
      const other = path.join(dir, "other.mjs");
      const link = path.join(dir, "context-mode");
      writeFileSync(self, "");
      writeFileSync(other, "");
      symlinkSync(self, link); // the npm bin link
      assert.equal(isEntry(undefined, self, self), true);
      assert.equal(isEntry(undefined, link, self), true);
      assert.equal(isEntry(undefined, other, self), false);
      assert.equal(isEntry(undefined, undefined, self), false);
      assert.equal(isEntry(undefined, path.join(dir, "gone.mjs"), self), false);
    });
  });
});
