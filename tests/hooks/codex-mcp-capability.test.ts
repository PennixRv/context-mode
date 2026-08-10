import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  CODEX_MCP_CAPABILITY_TTL_MS,
  getCodexMcpCapabilityMarkerPath,
  hasCodexMcpCapability,
  isCodexCtxExecuteToolName,
  recordCodexMcpCapability,
} from "../../hooks/codex/mcp-capability.mjs";
import { HOST_TEMP_DIRECTORY } from "../../src/util/system-temp.js";

const REPOSITORY_ROOT = resolve(__dirname, "..", "..");
const PRETOOLUSE_PATH = join(REPOSITORY_ROOT, "hooks", "codex", "pretooluse.mjs");
const cleanup: string[] = [];

type HookOutput = {
  hookSpecificOutput?: Record<string, unknown>;
};

function runHook(input: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync(process.execPath, [PRETOOLUSE_PATH], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    input: JSON.stringify(input),
    timeout: 30_000,
  });
}

function parseHookOutput(result: { stdout?: string | Buffer | null }): HookOutput {
  return JSON.parse(String(result.stdout ?? "")) as HookOutput;
}

function expectPassthrough(output: HookOutput): void {
  expect(output.hookSpecificOutput).toEqual({ hookEventName: "PreToolUse" });
}

function makeHookEnvironment(root: string): Record<string, string> {
  const codexHome = join(root, "codex-home");
  const sentinelDir = join(root, "sentinels");
  const fakeCodex = join(root, "codex");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(sentinelDir, { recursive: true });
  writeFileSync(
    fakeCodex,
    "#!/bin/sh\nprintf 'codex-cli 0.141.0\\n'\n",
    "utf8",
  );
  chmodSync(fakeCodex, 0o755);
  writeFileSync(
    join(sentinelDir, `context-mode-mcp-ready-${process.pid}`),
    String(process.pid),
    "utf8",
  );
  return {
    CODEX_HOME: codexHome,
    CONTEXT_MODE_MCP_SENTINEL_DIR: sentinelDir,
    CONTEXT_MODE_SUPPRESS_SECURITY_WARNING: "1",
    PATH: `${root}:${process.env.PATH ?? ""}`,
    TMPDIR: root,
  };
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Codex MCP capability proof", () => {
  test("accepts only context-mode's exact Codex ctx_execute names", () => {
    expect(isCodexCtxExecuteToolName("ctx_execute")).toBe(true);
    expect(isCodexCtxExecuteToolName("mcp__context_mode__ctx_execute")).toBe(true);
    expect(isCodexCtxExecuteToolName("mcp__plugin_context-mode_context-mode__ctx_execute")).toBe(true);
    expect(isCodexCtxExecuteToolName("mcp__other__ctx_execute")).toBe(false);
    expect(isCodexCtxExecuteToolName("mcp__context_mode__ctx_execute_file")).toBe(false);
  });

  test("is opaque, content-free, session-bound, and short-lived", () => {
    const storageDir = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-capability-"));
    cleanup.push(storageDir);
    const sessionId = "codex-session-a";
    const now = 1_000_000;
    const options = { storageDir, now: () => now };

    expect(recordCodexMcpCapability(sessionId, options)).toBe(true);
    expect(statSync(storageDir).mode & 0o777).toBe(0o700);
    const markerPath = getCodexMcpCapabilityMarkerPath(sessionId, options);
    expect(markerPath).toBeTruthy();
    expect(statSync(markerPath!).mode & 0o777).toBe(0o600);
    expect(readFileSync(markerPath!, "utf8")).not.toContain(sessionId);
    expect(readFileSync(markerPath!, "utf8")).not.toContain("ctx_execute");

    expect(hasCodexMcpCapability(sessionId, options)).toBe(true);
    expect(hasCodexMcpCapability("codex-session-b", options)).toBe(false);
    expect(hasCodexMcpCapability("invalid\nsession", options)).toBe(false);
    expect(hasCodexMcpCapability(sessionId, {
      storageDir,
      now: () => now + CODEX_MCP_CAPABILITY_TTL_MS,
    })).toBe(false);
  });

  test("fails open when the exact session marker is malformed", () => {
    const storageDir = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-capability-"));
    cleanup.push(storageDir);
    const sessionId = "codex-session-malformed";
    const markerPath = getCodexMcpCapabilityMarkerPath(sessionId, { storageDir });
    mkdirSync(storageDir, { recursive: true, mode: 0o700 });
    writeFileSync(markerPath!, "not-json\n", { mode: 0o600 });
    chmodSync(markerPath!, 0o600);

    expect(hasCodexMcpCapability(sessionId, { storageDir })).toBe(false);
  });

  test("fails open for non-private capability storage without changing it", () => {
    const storageDir = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-capability-"));
    cleanup.push(storageDir);
    const sessionId = "codex-session-non-private";
    chmodSync(storageDir, 0o755);

    expect(recordCodexMcpCapability(sessionId, { storageDir })).toBe(false);
    expect(statSync(storageDir).mode & 0o777).toBe(0o755);
    expect(hasCodexMcpCapability(sessionId, { storageDir })).toBe(false);
  });

  test.runIf(process.platform !== "win32")(
    "fails open when capability storage traverses a symbolic link",
    () => {
      const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-capability-"));
      cleanup.push(root);
      const storageTarget = join(root, "storage-target");
      const storageLink = join(root, "storage-link");
      mkdirSync(storageTarget, { recursive: true, mode: 0o700 });
      symlinkSync(storageTarget, storageLink);

      expect(recordCodexMcpCapability("codex-session-symlink", {
        storageDir: storageLink,
      })).toBe(false);
    },
  );
});

describe("Codex PreToolUse capability routing", () => {
  test("requires a bare ctx_execute proof even when an MCP-ready sentinel is live", () => {
    const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-capability-hook-"));
    cleanup.push(root);
    const env = makeHookEnvironment(root);
    const baseInput = { session_id: "codex-session-a", cwd: root };

    const unproven = runHook({
      ...baseInput,
      tool_name: "exec_command",
      tool_input: { cmd: "curl https://example.com" },
    }, env);
    if ((unproven.error as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
      const source = readFileSync(PRETOOLUSE_PATH, "utf8");
      expect(source).toContain("isCodexCtxExecuteToolName(tool)");
      expect(source).toContain("recordCodexMcpCapability(input.session_id)");
      expect(source).toContain("hasCodexMcpCapability(input.session_id)");
      return;
    }
    expect(unproven.status, unproven.stderr).toBe(0);
    expectPassthrough(parseHookOutput(unproven));

    const external = runHook({
      ...baseInput,
      tool_name: "mcp__other__ctx_execute",
      tool_input: { language: "javascript", code: "1 + 1" },
    }, env);
    expect(external.status, external.stderr).toBe(0);

    const stillUnproven = runHook({
      ...baseInput,
      tool_name: "exec_command",
      tool_input: { cmd: "wget https://example.com" },
    }, env);
    expect(stillUnproven.status, stillUnproven.stderr).toBe(0);
    expectPassthrough(parseHookOutput(stillUnproven));

    const proof = runHook({
      ...baseInput,
      tool_name: "mcp__context_mode__ctx_execute",
      tool_input: { language: "javascript", code: "1 + 1" },
    }, env);
    expect(proof.status, proof.stderr).toBe(0);
    expectPassthrough(parseHookOutput(proof));

    for (const [toolName, toolInput] of [
      ["exec_command", { cmd: "curl https://example.com" }],
      ["exec_command", { cmd: "wget https://example.com" }],
      ["exec_command", { cmd: "node -e \"fetch('https://example.com')\"" }],
      ["exec_command", { cmd: "python -c \"import requests; requests.get('https://example.com')\"" }],
      ["WebFetch", { url: "https://example.com" }],
    ] as const) {
      const redirected = runHook({ ...baseInput, tool_name: toolName, tool_input: toolInput }, env);
      expect(redirected.status, `${toolName}: ${redirected.stderr}`).toBe(0);
      const output = parseHookOutput(redirected);
      const serialized = JSON.stringify(output);
      expect(serialized).toContain("ctx_execute");
      expect(serialized).not.toContain("ctx_fetch_and_index");
      expect(serialized).not.toContain("ctx_search");
      if (toolName === "WebFetch") {
        expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
      } else {
        expect(output.hookSpecificOutput?.permissionDecision).toBe("allow");
      }
    }

    const otherSession = runHook({
      session_id: "codex-session-b",
      cwd: root,
      tool_name: "exec_command",
      tool_input: { cmd: "curl https://example.com" },
    }, env);
    expect(otherSession.status, otherSession.stderr).toBe(0);
    expectPassthrough(parseHookOutput(otherSession));
  });
});
