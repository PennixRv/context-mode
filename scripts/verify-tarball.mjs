#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

assert.ok(process.argv[2], "usage: node scripts/verify-tarball.mjs <tarball>");
const tarball = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "cm-tarball-"));
const home = join(root, "home"), prefix = join(root, "prefix"), codexHome = join(home, ".codex");
const fixtures = [join(home, ".claude/plugins/installed_plugins.json"), join(home, ".claude/settings.json"), join(codexHome, "AGENTS.md")];
for (const path of fixtures) { mkdirSync(resolve(path, ".."), {recursive: true}); writeFileSync(path, "preserve this host file\n"); }
const env = {...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome};
try {
  const installed = spawnSync("npm", ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", tarball], {env, encoding: "utf8", timeout: 180_000});
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  fixtures.forEach(path => assert.equal(readFileSync(path, "utf8"), "preserve this host file\n"));
  const packageRoot = join(prefix, "lib/node_modules/@pennixrv/context-mode");
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const expected = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, expected.name); assert.equal(pkg.version, expected.version);
  assert.equal(realpathSync(join(prefix, "bin/context-mode")), join(packageRoot, "cli.bundle.mjs"));
  const version = spawnSync(join(prefix, "bin/context-mode"), ["--version"], {env, encoding: "utf8", timeout: 5000});
  assert.equal(version.status, 0, version.stderr); assert.equal(version.stdout.trim(), expected.version);
  const host = spawnSync(process.execPath, [resolve(import.meta.dirname, "verify-codex-host.mjs"), packageRoot], {env, encoding: "utf8", timeout: 60_000});
  assert.equal(host.status, 0, host.stdout + host.stderr);
  process.stdout.write(host.stdout);
  console.log("npm tarball install, bin ownership and host preservation: passed");
} finally { rmSync(root, {recursive: true, force: true}); }
