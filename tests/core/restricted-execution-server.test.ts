import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { probeBubblewrapIsolation } from "../../src/execution-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const mcpEntry = join(repoRoot, "start.mjs");
const capabilityRoot = mkdtempSync(join(tmpdir(), "ctx-server-capability-"));
const isolationAvailable = process.platform === "linux"
  ? probeBubblewrapIsolation(capabilityRoot) !== null
  : false;
rmSync(capabilityRoot, { recursive: true, force: true });

interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema?: { properties?: Record<string, unknown> };
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: ToolDescriptor[];
  };
  error?: { code: number; message: string };
}

interface ServerFixture {
  root: string;
  project: string;
  outside: string;
  storage: string;
  home: string;
  hostTmp: string;
  proc: ChildProcess;
}

function cleanServerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(CLAUDE|CODEX|GEMINI|VSCODE|CURSOR|OPENCODE|KILO|KIRO|PI|OMP|ZED|QWEN|KIMI|ANTIGRAVITY|OPENCLAW|COPILOT)_/.test(key)
      || key.startsWith("CONTEXT_MODE_")
    ) {
      delete env[key];
    }
  }
  return env;
}

function spawnServerFixture(extraEnv: Record<string, string> = {}): ServerFixture {
  const root = mkdtempSync(join(tmpdir(), "ctx-restricted-server-"));
  const project = join(root, "project");
  const outside = join(root, "outside");
  const storage = join(root, "storage");
  const home = join(root, "home");
  const hostTmp = join(root, "host-tmp");
  for (const dir of [project, outside, home, hostTmp]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(project, "input.txt"), "server-project-data\n");
  writeFileSync(join(outside, "secret.txt"), "server-outside-secret\n");

  const proc = spawn(process.execPath, [mcpEntry], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...cleanServerEnv(),
      HOME: home,
      TMPDIR: hostTmp,
      PWD: project,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CONTEXT_MODE_PROJECT_DIR: project,
      CONTEXT_MODE_DIR: storage,
      CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
      CONTEXT_MODE_PLATFORM: "claude-code",
      CONTEXT_MODE_EXECUTION_MODE: "restricted",
      CONTEXT_MODE_RESTRICTED_PROJECT_ROOT: project,
      ...extraEnv,
    },
  });
  return { root, project, outside, storage, home, hostTmp, proc };
}

function sendRpc(proc: ChildProcess, message: Record<string, unknown>): void {
  proc.stdin!.write(`${JSON.stringify(message)}\n`);
}

async function rpc(
  proc: ChildProcess,
  id: number,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<RpcResponse> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let stderr = "";
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString(); };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as RpcResponse;
          if (parsed.id !== id) continue;
          cleanup();
          resolvePromise(parsed);
          return;
        } catch {
          // Ignore non-JSON server diagnostics.
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout!.off("data", onData);
      proc.stderr!.off("data", onStderr);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`RPC ${method} timed out; stderr=${stderr}`));
    }, timeoutMs);
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onStderr);
    sendRpc(proc, { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  });
}

async function initialize(proc: ChildProcess, id = 1): Promise<void> {
  const response = await rpc(proc, id, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "restricted-execution-test", version: "1.0" },
  });
  expect(response.error).toBeUndefined();
  sendRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
}

async function callTool(
  fixture: ServerFixture,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  return rpc(fixture.proc, id, "tools/call", {
    name,
    arguments: args,
  });
}

function responseText(response: RpcResponse): string {
  return response.result?.content?.map((entry) => entry.text).join("\n") ?? "";
}

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path));
    }
  };
  visit(root);
  return files.sort();
}

function stopFixture(fixture: ServerFixture): void {
  try { fixture.proc.kill("SIGTERM"); } catch { /* best effort */ }
  rmSync(fixture.root, { recursive: true, force: true });
}

describe.runIf(isolationAvailable)("restricted execution MCP server", () => {
  let fixture: ServerFixture;

  beforeAll(async () => {
    fixture = spawnServerFixture();
    await initialize(fixture.proc);
  });

  afterAll(() => stopFixture(fixture));

  test("tools/list exposes server-fixed read-only annotations and no authority input", async () => {
    const response = await rpc(fixture.proc, 10, "tools/list");
    const tools = response.result?.tools ?? [];
    for (const name of ["ctx_execute", "ctx_execute_file", "ctx_batch_execute"]) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool?.title).toContain("Restricted");
      expect(tool?.description).toContain("no network");
      expect(tool?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool?.inputSchema?.properties).not.toHaveProperty("mode");
      expect(tool?.inputSchema?.properties).not.toHaveProperty("readOnly");
    }
  });

  test("ctx_execute ignores caller elevation fields and cannot write", async () => {
    const target = join(fixture.project, "caller-elevation.txt");
    const padding = `# ${"x".repeat(280)}\n`;
    const code = padding
      + `if printf forbidden > '${target}' 2>/dev/null; then echo write=allowed; else echo write=blocked; fi`;
    const response = await callTool(fixture, 11, "ctx_execute", {
      language: "shell",
      code,
      mode: "compatibility",
      readOnly: false,
    });
    const text = responseText(response);
    expect(response.result?.isError ?? false).toBe(false);
    expect(text).toContain("Executed shell");
    expect(text).toContain(`240/${Array.from(code).length} chars`);
    expect(text).toContain("(truncated;");
    expect(text).toMatch(/sha256=[a-f0-9]{64}/);
    expect(text).toContain("Persisted: no (request-only).");
    expect(text).toContain("write=blocked");
    expect(existsSync(target)).toBe(false);
  });

  test("ctx_execute rejects background and out-of-project cwd before launch", async () => {
    const background = await callTool(fixture, 12, "ctx_execute", {
      language: "shell",
      code: "sleep 10",
      background: true,
    });
    expect(background.result?.isError).toBe(true);
    expect(responseText(background)).toContain("CTX_EXEC_BACKGROUND_FORBIDDEN");

    const outsideCwd = await callTool(fixture, 13, "ctx_execute", {
      language: "shell",
      code: "pwd",
      cwd: fixture.outside,
    });
    expect(outsideCwd.result?.isError).toBe(true);
    expect(responseText(outsideCwd)).toContain("CTX_EXEC_PATH_OUTSIDE_PROJECT");
    expect(responseText(outsideCwd)).not.toContain(fixture.outside);
  });

  test("ctx_execute_file reads an in-project file and rejects an absolute escape", async () => {
    const allowed = await callTool(fixture, 14, "ctx_execute_file", {
      path: "input.txt",
      language: "javascript",
      code: "console.log(FILE_CONTENT.trim());",
    });
    const allowedText = responseText(allowed);
    expect(allowed.result?.isError ?? false).toBe(false);
    expect(allowedText).toContain("path=input.txt");
    expect(allowedText).toContain("server-project-data");
    expect(allowedText).toContain("Persisted: no (request-only).");

    const denied = await callTool(fixture, 15, "ctx_execute_file", {
      path: join(fixture.outside, "secret.txt"),
      language: "javascript",
      code: "console.log(FILE_CONTENT);",
    });
    expect(denied.result?.isError).toBe(true);
    expect(responseText(denied)).toContain("CTX_EXEC_PATH_OUTSIDE_PROJECT");
    expect(responseText(denied)).not.toContain("server-outside-secret");
  });

  test("ctx_batch_execute supports concurrent request-local queries and rejects global scope", async () => {
    const marker = `restricted-only-${Date.now()}`;
    const response = await callTool(fixture, 16, "ctx_batch_execute", {
      commands: [
        { label: "alpha section", command: `printf '# Alpha\\n${marker} alpha result\\n'` },
        { label: "bravo section", command: "printf '# Bravo\\nbravo result\\n'" },
      ],
      queries: [marker, "bravo"],
      concurrency: 2,
    });
    const text = responseText(response);
    expect(response.result?.isError ?? false).toBe(false);
    expect(text).toContain("Persisted: no.");
    expect(text).toMatch(/Commands \(2\):.*sha256=[a-f0-9]{64}/);
    expect(text).toContain(`1 alpha section: printf '# Alpha\\n${marker} alpha result\\n'`);
    expect(text).toContain("2 bravo section: printf '# Bravo\\nbravo result\\n'");
    expect(text).toContain(`## ${marker}`);
    expect(text).toContain(marker);
    expect(text).toContain("Request-local sections (");
    expect(text).toContain("Alpha (");
    expect(text).toContain("Bravo (");
    expect(text).toContain("not available to ctx_search");
    expect(text).not.toContain("## Indexed Sections");
    const nonEmptyLines = text.split("\n").filter((line) => line.trim() !== "");
    expect(nonEmptyLines[0]).toMatch(/^Executed 2 commands /);
    expect(nonEmptyLines[1]).toMatch(/^Commands \(2\):.*sha256=[a-f0-9]{64}$/);
    expect(nonEmptyLines[2]).toBe(`## ${marker}`);

    const global = await callTool(fixture, 17, "ctx_batch_execute", {
      commands: [{ label: "one", command: "echo one" }],
      queries: ["one"],
      query_scope: "global",
    });
    expect(global.result?.isError).toBe(true);
    expect(responseText(global)).toContain("CTX_EXEC_GLOBAL_QUERY_FORBIDDEN");

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    expect(filesBelow(fixture.storage)).toEqual([]);
    expect(filesBelow(fixture.home)).toEqual([]);
    expect(filesBelow(fixture.hostTmp)).toEqual([]);

    const laterSearch = await callTool(fixture, 18, "ctx_search", {
      queries: [marker],
    });
    const laterText = responseText(laterSearch);
    expect(
      laterText.includes("No results found") || laterText.includes("Knowledge base is empty"),
    ).toBe(true);
    expect(laterText).not.toContain(`${marker} alpha result`);
  });
});

describe.runIf(isolationAvailable)("configured execution presentation over MCP", () => {
  test("configured preview is measured in Unicode code points", async () => {
    const fixture = spawnServerFixture({ CONTEXT_MODE_CODE_ECHO_MAX: "80" });
    try {
      await initialize(fixture.proc, 100);
      const code = `console.log('configured'); // ${"😀".repeat(120)}`;
      const response = await callTool(fixture, 101, "ctx_execute", {
        language: "javascript",
        code,
      });
      const text = responseText(response);
      const match = /80\/\d+ chars \(truncated; \d+ omitted\)[^\n]*\n(`{3,})javascript\n([\s\S]*?)\n\1/.exec(text);
      expect(match).not.toBeNull();
      expect(Array.from(match?.[2] ?? "")).toHaveLength(80);
      expect(text).toContain("(truncated;");
      expect(text).not.toContain(code);
    } finally {
      stopFixture(fixture);
    }
  });
});

describe.runIf(isolationAvailable)("restricted server lifecycle mutations", () => {
  test("shutdown does not delete compatibility preload or readiness paths", async () => {
    const fixture = spawnServerFixture();
    const pid = fixture.proc.pid;
    expect(pid).toBeDefined();
    const preload = join(fixture.hostTmp, `cm-fs-preload-${pid}.js`);
    const sentinel = join(
      process.platform === "win32" ? fixture.hostTmp : "/tmp",
      `context-mode-mcp-ready-${pid}`,
    );

    try {
      await initialize(fixture.proc, 125);
      writeFileSync(preload, "pre-existing preload marker\n");
      writeFileSync(sentinel, "pre-existing sentinel marker\n");

      const exited = new Promise<void>((resolvePromise) => {
        fixture.proc.once("exit", () => resolvePromise());
      });
      fixture.proc.kill("SIGTERM");
      await exited;

      expect(existsSync(preload)).toBe(true);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      try { fixture.proc.kill("SIGKILL"); } catch { /* already exited */ }
      rmSync(sentinel, { force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("restricted execution fail-closed MCP errors", () => {
  test("missing trusted restricted project root never falls back to cwd", async () => {
    const fixture = spawnServerFixture({ CONTEXT_MODE_RESTRICTED_PROJECT_ROOT: "" });
    try {
      await initialize(fixture.proc, 150);
      const response = await callTool(fixture, 151, "ctx_execute", {
        language: "shell",
        code: "pwd",
      });
      expect(response.result?.isError).toBe(true);
      expect(responseText(response)).toContain("CTX_EXEC_PROJECT_ROOT_INVALID");
      expect(responseText(response)).not.toContain(fixture.project);
    } finally {
      stopFixture(fixture);
    }
  });

  test("invalid server policy is never treated as compatibility", async () => {
    const fixture = spawnServerFixture({ CONTEXT_MODE_EXECUTION_MODE: "invalid" });
    try {
      await initialize(fixture.proc, 200);
      const response = await callTool(fixture, 201, "ctx_execute", {
        language: "shell",
        code: "echo should-not-run",
      });
      expect(response.result?.isError).toBe(true);
      expect(responseText(response)).toContain("CTX_EXEC_POLICY_INVALID");
      expect(responseText(response)).not.toContain("should-not-run\n");
    } finally {
      stopFixture(fixture);
    }
  });

  test.runIf(process.platform === "linux")(
    "missing bubblewrap returns a stable unavailable error",
    async () => {
      const fixture = spawnServerFixture();
      const isolatedBin = join(fixture.root, "bin-no-bwrap");
      mkdirSync(isolatedBin);
      for (const command of ["node", "zsh", "bash", "python3", "ps"] as const) {
        const known = [
          `/usr/bin/${command}`,
          `/bin/${command}`,
        ].find((candidate) => existsSync(candidate));
        if (known) symlinkSync(known, join(isolatedBin, command));
      }
      try {
        fixture.proc.kill("SIGTERM");
        fixture.proc = spawn(process.execPath, [mcpEntry], {
          cwd: repoRoot,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...cleanServerEnv(),
            HOME: fixture.home,
            TMPDIR: fixture.hostTmp,
            PWD: fixture.project,
            PATH: isolatedBin,
            CLAUDE_PROJECT_DIR: fixture.project,
            CONTEXT_MODE_PROJECT_DIR: fixture.project,
            CONTEXT_MODE_DIR: fixture.storage,
            CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
            CONTEXT_MODE_PLATFORM: "claude-code",
            CONTEXT_MODE_EXECUTION_MODE: "restricted",
            CONTEXT_MODE_RESTRICTED_PROJECT_ROOT: fixture.project,
          },
        });
        await initialize(fixture.proc, 300);
        const response = await callTool(fixture, 301, "ctx_execute", {
          language: "shell",
          code: "echo should-not-run",
        });
        expect(response.result?.isError).toBe(true);
        expect(responseText(response)).toContain("CTX_EXEC_ISOLATION_UNAVAILABLE");
      } finally {
        stopFixture(fixture);
      }
    },
  );
});
