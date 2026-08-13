import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(__dirname, "..", "..");

interface RpcResponse {
  id: number;
  result?: { content?: Array<{ type: string; text: string }> };
  error?: { code: number; message: string };
}

function scrubEnvironment(temporaryRoot: string, fakeBin: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["LANG", "LC_ALL", "SHELL", "TERM", "TMPDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return {
    ...environment,
    HOME: temporaryRoot,
    CODEX_HOME: join(temporaryRoot, "codex-home"),
    CODEX_CI: "1",
    CONTEXT_MODE_PLATFORM: "codex",
    CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
    CONTEXT_MODE_DIR: join(temporaryRoot, "context-mode-state"),
    CONTEXT_MODE_PROJECT_DIR: join(temporaryRoot, "project"),
    PATH: `${fakeBin}${delimiter}/usr/local/bin${delimiter}/usr/bin${delimiter}/bin`,
  };
}

function writeFixture(temporaryRoot: string): {
  cacheRoot: string;
  fakeBin: string;
  packageVersion: string;
} {
  const packageVersion = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ).version as string;
  const cacheRoot = join(temporaryRoot, "cache", "context-mode", packageVersion);
  const fakeBin = join(temporaryRoot, "bin");
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(join(cacheRoot, ".codex-plugin"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(temporaryRoot, "project"), { recursive: true });
  copyFileSync(
    join(repositoryRoot, ".codex-plugin", "hooks.json"),
    join(cacheRoot, ".codex-plugin", "hooks.json"),
  );
  writeFileSync(join(cacheRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "context-mode",
    version: packageVersion,
  }));
  writeFileSync(join(codexHome, "config.toml"), [
    "[features]",
    "hooks = true",
    "",
    "[plugins.\"context-mode@context-mode\"]",
    "enabled = true",
    "",
  ].join("\n"));

  const json = JSON.stringify({
    installed: [{
      pluginId: "context-mode@context-mode",
      version: packageVersion,
      installed: true,
      enabled: true,
      marketplaceSource: { sourceType: "local", source: "/fixture/marketplace" },
      installedPath: cacheRoot,
    }],
    available: [],
  });
  const fakeCodex = join(fakeBin, "codex");
  writeFileSync(fakeCodex, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-cli 0.116.0'
elif [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '%s\\n' '${json}'
elif [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  printf '%s\\n' 'context-mode@context-mode  installed, enabled  ${packageVersion}  ${cacheRoot}'
else
  exit 2
fi
`);
  chmodSync(fakeCodex, 0o755);
  return { cacheRoot, fakeBin, packageVersion };
}

function extractDiagnostic(text: string): Record<string, unknown> {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const marker = plain.indexOf('"plugin_id"');
  if (marker < 0) throw new Error(`structured diagnostic not found in bounded output: ${plain.slice(-2000)}`);
  const start = plain.lastIndexOf("{", marker);
  if (start < 0) throw new Error(`structured diagnostic object start not found: ${plain.slice(-2000)}`);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < plain.length; index++) {
    const character = plain[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === "{") {
      depth++;
    } else if (character === "}" && --depth === 0) {
      return JSON.parse(plain.slice(start, index + 1)) as Record<string, unknown>;
    }
  }
  throw new Error(`structured diagnostic object was incomplete: ${plain.slice(-2000)}`);
}

function sendRpc(child: ChildProcess, message: Record<string, unknown>): void {
  child.stdin!.write(`${JSON.stringify(message)}\n`);
}

function awaitRpc(
  child: ChildProcess,
  id: number,
  request: Record<string, unknown>,
  stderr: () => string,
): Promise<RpcResponse> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.stdout!.off("data", onData);
      reject(new Error(`MCP RPC ${id} timed out: ${stderr().slice(-2000)}`));
    }, 20_000);
    const onData = (data: Buffer) => {
      buffer += data.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const response = JSON.parse(line) as RpcResponse;
            if (response.id === id) {
              clearTimeout(timer);
              child.stdout!.off("data", onData);
              resolvePromise(response);
              return;
            }
          } catch { /* Ignore non-protocol output. */ }
        }
        newline = buffer.indexOf("\n");
      }
    };
    child.stdout!.on("data", onData);
    sendRpc(child, request);
  });
}

describe("Issue 009 built Doctor entry points", () => {
  test("Codex manifest covers canonical and host shell tool names once", () => {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, ".codex-plugin", "hooks.json"), "utf8"),
    ) as { hooks?: { PreToolUse?: Array<{ matcher?: string }> } };
    const matchers = (manifest.hooks?.PreToolUse ?? []).map((entry) => entry.matcher ?? "");
    const shellMatcher = matchers.find((matcher) => matcher.includes("exec_command"));
    expect(shellMatcher).toBe("local_shell|shell|shell_command|exec_command|Bash|Shell|apply_patch|Edit|Write|grep_files");
    expect(matchers.filter((matcher) => matcher.includes("exec_command"))).toHaveLength(1);
  });

  test("CLI Doctor and MCP ctx_doctor serialize the same Plugin facts", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-doctor-entrypoints-"));
    const { cacheRoot, fakeBin, packageVersion } = writeFixture(temporaryRoot);
    const environment = scrubEnvironment(temporaryRoot, fakeBin);
    const cli = spawnSync(process.execPath, [join(repositoryRoot, "cli.bundle.mjs"), "doctor"], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
    });

    const child = spawn(process.execPath, [join(repositoryRoot, "server.bundle.mjs")], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });

    try {
      expect(cli.error).toBeUndefined();
      const cliDiagnostic = extractDiagnostic(`${cli.stdout}\n${cli.stderr}`);
      const initialized = await awaitRpc(child, 1, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "codex-doctor-entrypoint-test", version: "1.0" },
        },
      }, () => stderr);
      expect(initialized.error).toBeUndefined();
      sendRpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
      const called = await awaitRpc(child, 2, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ctx_doctor", arguments: {} },
      }, () => stderr);
      const mcpText = called.result?.content?.map((item) => item.text).join("\n") ?? "";
      const mcpDiagnostic = extractDiagnostic(mcpText);

      expect(mcpDiagnostic).toEqual(cliDiagnostic);
      expect(cliDiagnostic).toMatchObject({
        channel: "codex-marketplace",
        plugin_id: "context-mode@context-mode",
        version: packageVersion,
        installed: true,
        enabled: true,
        source_root: "/fixture/marketplace",
        cache_root: cacheRoot,
        runtime_root: repositoryRoot,
      });
      expect((cliDiagnostic.checks as Record<string, { state: string }>)[
        "codex.plugin.session_hooks_loaded"
      ]?.state).toBe("unavailable");
    } finally {
      child.kill("SIGTERM");
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 40_000);
});
