import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(__dirname, "..", "..");
const presentationEnvVars = [
  "CONTEXT_MODE_CODE_ECHO_MAX",
  "CONTEXT_MODE_COMMAND_ECHO_MAX",
  "CONTEXT_MODE_TITLE_PREVIEW_MAX",
  "CONTEXT_MODE_SEARCHABLE_TERMS_MAX",
  "CONTEXT_MODE_RESULT_PREVIEW_MAX",
] as const;

interface CodexMcpEntry {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  env_vars: string[];
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, ".codex-plugin", "mcp.json"), "utf8"),
) as { mcpServers: Record<string, CodexMcpEntry> };
const mcpEntry = manifest.mcpServers["context-mode"];

function createSourceFixture(): string {
  const keys = JSON.stringify(presentationEnvVars);
  const executable = `const k=${keys};console.log("ENV_PROBE="+JSON.stringify(k.map(x=>process.env[x]??"unset")));`;
  const suffixLength = 365 - executable.length - 3;
  if (suffixLength < 0) throw new Error(`source fixture prefix is ${executable.length} characters`);
  const source = `${executable}\n//${"x".repeat(suffixLength)}`;
  if (source.length !== 365) throw new Error(`source fixture is ${source.length} characters`);
  return source;
}

function materializeManifestEnvironment(
  parentValues: Record<string, string>,
  temporaryRoot: string,
): NodeJS.ProcessEnv {
  const parentEnvironment = { ...process.env };
  for (const name of presentationEnvVars) delete parentEnvironment[name];
  for (const name of Object.keys(parentEnvironment)) {
    if (/^(CLAUDE|CODEX|GEMINI|VSCODE|CURSOR|OPENCODE|KILO|KIRO|PI|OMP|ZED|QWEN|KIMI|ANTIGRAVITY|OPENCLAW|COPILOT)_/.test(name)) {
      delete parentEnvironment[name];
    }
  }
  Object.assign(parentEnvironment, parentValues);

  const forwardedEnvironment = Object.fromEntries(
    mcpEntry.env_vars
      .filter((name) => parentEnvironment[name] !== undefined)
      .map((name) => [name, parentEnvironment[name]!]),
  );
  return {
    ...parentEnvironment,
    ...mcpEntry.env,
    ...forwardedEnvironment,
    CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
    CONTEXT_MODE_DIR: join(temporaryRoot, "state"),
    CONTEXT_MODE_PROJECT_PATH: join(temporaryRoot, "project"),
  };
}

function sendRpc(process: ChildProcess, message: Record<string, unknown>): void {
  process.stdin!.write(`${JSON.stringify(message)}\n`);
}

async function awaitRpc(
  process: ChildProcess,
  id: number,
  request: Record<string, unknown>,
  stderr: () => string,
  timeoutMs = 20_000,
): Promise<RpcResponse> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as RpcResponse;
          if (parsed.id === id) {
            process.stdout!.off("data", onData);
            clearTimeout(timer);
            resolvePromise(parsed);
            return;
          }
        } catch {
          // Ignore non-JSON process output while waiting for the matching RPC.
        }
      }
    };
    const timer = setTimeout(() => {
      process.stdout!.off("data", onData);
      reject(new Error(`MCP RPC ${id} timed out: ${stderr()}`));
    }, timeoutMs);
    process.stdout!.on("data", onData);
    sendRpc(process, request);
  });
}

async function runProbe(parentValues: Record<string, string>): Promise<string> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-codex-env-forwarding-"));
  const child = spawn(mcpEntry.command, mcpEntry.args, {
    cwd: resolve(repositoryRoot, mcpEntry.cwd),
    stdio: ["pipe", "pipe", "pipe"],
    env: materializeManifestEnvironment(parentValues, temporaryRoot),
  });
  let stderr = "";
  child.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });

  try {
    const initialized = await awaitRpc(child, 1, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "codex-presentation-env-forwarding-test", version: "1.0" },
      },
    }, () => stderr);
    expect(initialized.error).toBeUndefined();
    sendRpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    const source = createSourceFixture();
    const response = await awaitRpc(child, 2, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ctx_execute", arguments: { language: "javascript", code: source } },
    }, () => stderr);
    expect(response.error).toBeUndefined();
    expect(response.result?.isError ?? false).toBe(false);
    return response.result?.content?.[0]?.text ?? "";
  } finally {
    try { child.kill("SIGTERM"); } catch { /* best effort */ }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function expectPresentationMetadata(text: string, preview: number): void {
  expect(text).toMatch(new RegExp(
    `Executed javascript \\| ${preview}/365 chars \\(truncated; ${365 - preview} omitted\\) ` +
    `\\| sha256=[a-f0-9]{64}`,
  ));
  expect(text.indexOf("```javascript")).toBeLessThan(text.indexOf("ENV_PROBE="));
}

describe("Codex Plugin presentation environment forwarding", () => {
  test("keeps presentation variables absent so the MCP uses server defaults", async () => {
    const text = await runProbe({});

    expectPresentationMetadata(text, 240);
    expect(text).toContain(`ENV_PROBE=${JSON.stringify(presentationEnvVars.map(() => "unset"))}`);
    expect({ chars: text.length, lines: text.split("\n").length }).toEqual({
      chars: 447,
      lines: 7,
    });
  }, 30_000);

  test("forwards 64/64/16/0/160 and applies the 64-character source preview", async () => {
    const configuredValues = ["64", "64", "16", "0", "160"];
    const text = await runProbe(Object.fromEntries(
      presentationEnvVars.map((name, index) => [name, configuredValues[index]]),
    ));

    expectPresentationMetadata(text, 64);
    expect(text).toContain(`ENV_PROBE=${JSON.stringify(configuredValues)}`);
    expect({ chars: text.length, lines: text.split("\n").length }).toEqual({
      chars: 255,
      lines: 7,
    });
  }, 30_000);
});
