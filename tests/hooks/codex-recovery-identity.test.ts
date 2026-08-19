import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { issueRecoveryBriefCapability } from "../../src/checkpoint/recovery-brief-capability.js";
import {
  getRecoveryBriefProviderStatus,
  initializeProjectRecoveryBriefProvider,
  updateRecoveryBriefProvider,
} from "../../src/checkpoint/runtime.js";
import { HOST_TEMP_DIRECTORY } from "../../src/util/system-temp.js";

const REPOSITORY_ROOT = resolve(__dirname, "..", "..");
const PRETOOLUSE_PATH = join(REPOSITORY_ROOT, "hooks", "codex", "pretooluse.mjs");
const cleanup: string[] = [];
const describeCodexIdentity = process.platform === "win32" ? describe.skip : describe;

function makeProject(root: string, sessionId: string): string {
  const project = join(root, "project");
  const taskDir = join(project, ".trellis", "tasks", "task-1");
  const runtimeDir = join(project, ".trellis", ".runtime", "sessions");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({ id: "task-1", status: "in_progress" }), "utf8");
  writeFileSync(join(runtimeDir, `codex_${sessionId}.json`), JSON.stringify({ current_task: "tasks/task-1" }), "utf8");
  return project;
}

function runHook(input: Record<string, unknown>, env: Record<string, string>) {
  return spawnSync("node", [PRETOOLUSE_PATH], {
    cwd: REPOSITORY_ROOT,
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

function toolPayload(result: { content?: Array<{ text?: string }> }): Record<string, unknown> {
  return JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

describeCodexIdentity("Codex RecoveryBrief identity hook", () => {
  test("rewrites only the two exact owned MCP calls and preserves external/native inputs", () => {
    const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-recovery-hook-"));
    cleanup.push(root);
    const codexHome = join(root, "codex-home");
    const project = makeProject(root, "hook-session");
    mkdirSync(codexHome, { recursive: true });
    const fakeCodex = join(root, "codex");
    writeFileSync(fakeCodex, "#!/bin/sh\nprintf 'codex-cli 0.141.0\\n'\n", "utf8");
    chmodSync(fakeCodex, 0o755);
    const env = { CODEX_HOME: codexHome, TMPDIR: root, PATH: `${root}:${process.env.PATH ?? ""}` };

    const exact = runHook({
      tool_name: "mcp__context_mode__ctx_recovery_brief_status",
      tool_input: { retained: "value" },
      session_id: "hook-session",
      cwd: project,
    }, env);
    if ((exact.error as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
      // The restricted local worker blocks spawnSync children. CI and normal
      // Codex hook hosts execute the branch above; retain an exact static
      // assertion here so the capability path cannot silently disappear.
      const source = readFileSync(PRETOOLUSE_PATH, "utf8");
      expect(source).toContain("isCodexRecoveryBriefToolName(tool)");
      expect(source).toContain("issueRecoveryBriefCapability({ cwd: input.cwd, sessionId: input.session_id })");
      return;
    }
    expect(exact.status, exact.stderr).toBe(0);
    const rewritten = JSON.parse(exact.stdout) as { hookSpecificOutput: Record<string, unknown> };
    expect(rewritten.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(rewritten.hookSpecificOutput.updatedInput).toMatchObject({ retained: "value" });
    const capability = (rewritten.hookSpecificOutput.updatedInput as Record<string, unknown>)
      .__context_mode_recovery_brief_capability;
    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);

    for (const toolName of [
      "mcp__other_server__ctx_recovery_brief_status",
      "mcp__context_mode__ctx_recovery_brief_init",
      "mcp__context_mode__ctx_recovery_brief_status_extra",
      "Agent",
      "Bash",
    ]) {
      const result = runHook({
        tool_name: toolName,
        tool_input: { command: "git status", untouched: toolName },
        session_id: "hook-session",
        cwd: project,
      }, env);
      expect(result.status, `${toolName}: ${result.stderr}`).toBe(0);
      const output = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, unknown> };
      expect(JSON.stringify(output)).not.toContain("__context_mode_recovery_brief_capability");
    }
  });

  test("requires the explicit authoritative Codex cwd and session_id", () => {
    const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-recovery-hook-missing-"));
    cleanup.push(root);
    const codexHome = join(root, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    const fakeCodex = join(root, "codex");
    writeFileSync(fakeCodex, "#!/bin/sh\nprintf 'codex-cli 0.141.0\\n'\n", "utf8");
    chmodSync(fakeCodex, 0o755);
    const result = runHook({
      tool_name: "mcp__context_mode__ctx_recovery_brief_status",
      tool_input: {},
      session_id: "pid-not-accepted",
    }, { CODEX_HOME: codexHome, TMPDIR: root, PATH: `${root}:${process.env.PATH ?? ""}` });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
      expect(readFileSync(PRETOOLUSE_PATH, "utf8")).toContain("permissionDecision: \"deny\"");
      return;
    }
    const output = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, unknown> };
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.updatedInput).toBeUndefined();
  });
});

describeCodexIdentity("Codex RecoveryBrief identity server binding", () => {
  let root: string;
  let storage: string;
  let project: string;
  const originalEnvironment = {
    CONTEXT_MODE_DIR: process.env.CONTEXT_MODE_DIR,
    CONTEXT_MODE_PLATFORM: process.env.CONTEXT_MODE_PLATFORM,
    CONTEXT_MODE_PROJECT_DIR: process.env.CONTEXT_MODE_PROJECT_DIR,
    CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS,
    CONTEXT_MODE_DISABLE_VERSION_CHECK: process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK,
  };

  beforeEach(() => {
    root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-codex-recovery-server-"));
    cleanup.push(root);
    storage = join(root, "storage");
    project = makeProject(root, "server-session-a");
    process.env.CONTEXT_MODE_DIR = storage;
    process.env.CONTEXT_MODE_PLATFORM = "codex";
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK = "1";
    delete process.env.CONTEXT_MODE_PROJECT_DIR;
    vi.resetModules();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("captures the plugin-root/no-project-env regression and binds the valid capability to the exact Trellis session", async () => {
    const pluginRoot = join(root, "plugin-root");
    mkdirSync(pluginRoot, { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(pluginRoot);
    try {
      expect(getRecoveryBriefProviderStatus(pluginRoot, undefined).errorCode).toBe("SESSION_UNAVAILABLE");
    } finally {
      process.chdir(originalCwd);
    }

    const { REGISTERED_CTX_TOOLS } = await import("../../src/server.js");
    const statusTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_status");
    const updateTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_update");
    expect(statusTool).toBeDefined();
    expect(updateTool).toBeDefined();
    const capabilitySchemas = REGISTERED_CTX_TOOLS.filter((tool) =>
      Object.prototype.hasOwnProperty.call(
        (tool.config.inputSchema as { shape?: Record<string, unknown> }).shape ?? {},
        "__context_mode_recovery_brief_capability",
      ),
    ).map((tool) => tool.name).sort();
    expect(capabilitySchemas).toEqual([
      "ctx_recovery_brief_status",
      "ctx_recovery_brief_update",
    ]);
    const missing = await statusTool!.handler({}) as { content?: Array<{ text?: string }>; isError?: boolean };
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing)).toContain("SESSION_UNAVAILABLE");

    const capability = issueRecoveryBriefCapability({ cwd: project, sessionId: "server-session-a" });
    const valid = await statusTool!.handler({ __context_mode_recovery_brief_capability: capability }) as {
      content?: Array<{ text?: string }>;
      isError?: boolean;
    };
    expect(valid.isError).not.toBe(true);
    expect(toolPayload(valid)).toMatchObject({ provider: "trellis", errorCode: "NONE" });
    expect(JSON.stringify(valid)).not.toContain(project);
    expect(JSON.stringify(valid)).not.toContain("server-session-a");
  });

  test("fails closed when a consumed capability has no exact Trellis pointer", async () => {
    makeProject(join(root, "other-holder"), "other-session");
    const { REGISTERED_CTX_TOOLS } = await import("../../src/server.js");
    const statusTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_status");
    const updateTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_update");
    const valid = issueRecoveryBriefCapability({ cwd: project, sessionId: "server-session-a" });
    const first = await statusTool!.handler({ __context_mode_recovery_brief_capability: valid });
    expect(toolPayload(first as { content?: Array<{ text?: string }> })).toMatchObject({ provider: "trellis" });
    const replay = await statusTool!.handler({ __context_mode_recovery_brief_capability: valid });
    expect(toolPayload(replay as { content?: Array<{ text?: string }> })).toMatchObject({ errorCode: "SESSION_UNAVAILABLE" });

    writeFileSync(join(project, "local-evidence.md"), "local provider evidence", "utf8");
    expect(initializeProjectRecoveryBriefProvider(project, {
      storage: "tracked",
      sourcePaths: ["local-evidence.md"],
    }).ok).toBe(true);
    const providerConfig = JSON.parse(
      readFileSync(join(project, ".context-mode", "recovery-provider.json"), "utf8"),
    ) as { source_paths: Array<{ sha256: string }> };
    const sourceSha256 = providerConfig.source_paths[0]!.sha256;
    const localBrief = {
      schema_version: 1,
      updated_at: "2026-08-04T00:00:00.000Z",
      objective: {
        value: "local provider must remain unselected",
        priority: "critical",
        source_kind: "explicit_project_state",
        source_sha256: sourceSha256,
        valid_at: "2026-08-04T00:00:00.000Z",
      },
      hard_constraints: [],
      decisions: [],
      completed_work: [],
      open_work: [],
      latest_blocker: null,
      next_action: null,
      project_state: null,
    };
    expect(updateRecoveryBriefProvider(project, "local-provider-session", {
      expectedSha256: "absent",
      brief: localBrief,
    }).ok).toBe(true);
    const localBriefPath = join(project, ".context-mode", "recovery-brief.json");
    const localBriefBefore = readFileSync(localBriefPath, "utf8");

    const statusCapability = issueRecoveryBriefCapability({ cwd: project, sessionId: "other-session" });
    const wrongSessionStatus = await statusTool!.handler({
      __context_mode_recovery_brief_capability: statusCapability,
    });
    expect(toolPayload(wrongSessionStatus as { content?: Array<{ text?: string }> })).toMatchObject({
      provider: "none",
      errorCode: "SESSION_UNAVAILABLE",
    });

    const updateCapability = issueRecoveryBriefCapability({ cwd: project, sessionId: "other-session" });
    const wrongSessionUpdate = await updateTool!.handler({
      expected_sha256: "absent",
      brief: localBrief,
      __context_mode_recovery_brief_capability: updateCapability,
    });
    expect(toolPayload(wrongSessionUpdate as { content?: Array<{ text?: string }> })).toMatchObject({
      provider: "none",
      errorCode: "SESSION_UNAVAILABLE",
    });
    expect(readFileSync(localBriefPath, "utf8")).toBe(localBriefBefore);
    expect(readdirSync(join(storage, "recovery-brief-capabilities"))).not.toContain(statusCapability);
    expect(readdirSync(join(storage, "recovery-brief-capabilities"))).not.toContain(updateCapability);
  });

  test("routes a valid CAS update to the bound Trellis task only", async () => {
    const { REGISTERED_CTX_TOOLS } = await import("../../src/server.js");
    const statusTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_status");
    const updateTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_recovery_brief_update");
    const statusCapability = issueRecoveryBriefCapability({ cwd: project, sessionId: "server-session-a" });
    const statusResponse = await statusTool!.handler({ __context_mode_recovery_brief_capability: statusCapability }) as {
      content?: Array<{ text?: string }>;
    };
    const status = JSON.parse(statusResponse.content?.[0]?.text ?? "{}") as { trellisSourceSha256?: string };
    expect(status.trellisSourceSha256).toMatch(/^[a-f0-9]{64}$/);

    const sourceFact = {
      value: "bound task update",
      priority: "critical",
      source_kind: "trellis_task",
      source_sha256: status.trellisSourceSha256,
      valid_at: "2026-08-04T00:00:00.000Z",
    };
    const updateCapability = issueRecoveryBriefCapability({ cwd: project, sessionId: "server-session-a" });
    const updateResponse = await updateTool!.handler({
      expected_sha256: "absent",
      brief: {
        schema_version: 1,
        updated_at: "2026-08-04T00:00:00.000Z",
        objective: sourceFact,
        hard_constraints: [],
        decisions: [],
        completed_work: [],
        open_work: [],
        latest_blocker: null,
        next_action: null,
        project_state: null,
      },
      __context_mode_recovery_brief_capability: updateCapability,
    }) as { content?: Array<{ text?: string }>; isError?: boolean };
    expect(updateResponse.isError).not.toBe(true);
    expect(toolPayload(updateResponse)).toMatchObject({ provider: "trellis", errorCode: "NONE" });
    expect(existsSync(join(project, ".trellis", "tasks", "task-1", "recovery-brief.json"))).toBe(true);
  });

  test("reports Codex bridge readiness without capability identity details", async () => {
    const { REGISTERED_CTX_TOOLS } = await import("../../src/server.js");
    const doctorTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_doctor");
    expect(doctorTool).toBeDefined();

    const response = await doctorTool!.handler({}) as { content?: Array<{ text?: string }> };
    const report = response.content?.[0]?.text ?? "";
    const bridgeLine = report.split("\n").find((line) =>
      line.includes("Codex RecoveryBrief identity bridge"),
    );
    expect(bridgeLine).toMatch(/^\[(OK|FAIL)\] Codex RecoveryBrief identity bridge:/);
    expect(bridgeLine).not.toContain(storage);
    expect(bridgeLine).not.toContain(project);
    expect(bridgeLine).not.toContain("server-session-a");
    expect(bridgeLine).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});
