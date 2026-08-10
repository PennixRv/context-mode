import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SessionDB, resolveSessionDbPath } from "../../src/session/db.js";
import { HOST_TEMP_DIRECTORY } from "../../src/util/system-temp.js";

interface ToolResponse {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

function responseText(result: unknown): string {
  return ((result as ToolResponse).content ?? [])
    .map((entry) => entry.text ?? "")
    .join("\n");
}

describe("registered shared-mode ctx_index and ctx_search handlers", () => {
  let rootDir: string;
  let storageRoot: string;
  let projectA: string;
  let projectB: string;
  const originalEnvironment = {
    CONTEXT_MODE_DIR: process.env.CONTEXT_MODE_DIR,
    CONTEXT_MODE_PROJECT_DIR: process.env.CONTEXT_MODE_PROJECT_DIR,
    CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS,
    CONTEXT_MODE_DISABLE_VERSION_CHECK: process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK,
  };

  beforeEach(() => {
    rootDir = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-shared-handler-"));
    storageRoot = join(rootDir, "storage");
    projectA = join(rootDir, "project-a");
    projectB = join(rootDir, "project-b");
    mkdirSync(storageRoot, { recursive: true });
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    process.env.CONTEXT_MODE_DIR = storageRoot;
    process.env.CONTEXT_MODE_PROJECT_DIR = projectA;
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK = "1";
    vi.resetModules();
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.resetModules();
    rmSync(rootDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  test("attributes indexed records and filters rendered shared-store results by project", async () => {
    const sessionA = "shared-handler-session-a";
    const sessionB = "shared-handler-session-b";
    const markerA = "shared-handler-project-a-marker";
    const markerB = "shared-handler-project-b-marker";
    const sharedQuery = "shared-handler-common-token";
    const sessionsDir = join(storageRoot, "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    for (const [projectDir, sessionId] of [[projectA, sessionA], [projectB, sessionB]] as const) {
      const sessionDb = new SessionDB({
        dbPath: resolveSessionDbPath({ projectDir, sessionsDir }),
      });
      try {
        sessionDb.ensureSession(sessionId, projectDir);
        sessionDb.insertEvent(sessionId, {
          type: "test",
          category: "test",
          data: `allow-set-${sessionId}`,
          priority: 1,
          project_dir: projectDir,
          attribution_source: "test",
          attribution_confidence: 1,
        }, "Test");
      } finally {
        sessionDb.close();
      }
    }

    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../../src/server.js");
    const indexTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index");
    const searchTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search");
    const purgeTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge");
    expect(indexTool).toBeDefined();
    expect(searchTool).toBeDefined();
    expect(purgeTool).toBeDefined();

    const indexedA = await withProjectDirOverride(
      { projectDir: projectA, sessionId: sessionA },
      async () => indexTool!.handler({
        content: `# Project A\n\n${sharedQuery}\n\n${markerA}`,
        source: "shared-handler-project-a",
      }),
    );
    const indexedB = await withProjectDirOverride(
      { projectDir: projectB, sessionId: sessionB },
      async () => indexTool!.handler({
        content: `# Project B\n\n${sharedQuery}\n\n${markerB}`,
        source: "shared-handler-project-b",
      }),
    );
    expect(responseText(indexedA)).toMatch(/Indexed \d+ section/);
    expect(responseText(indexedB)).toMatch(/Indexed \d+ section/);

    const searchResult = await withProjectDirOverride(
      { projectDir: projectA, sessionId: sessionA },
      async () => searchTool!.handler({
        queries: [sharedQuery],
        project: projectA,
        limit: 2,
      }),
    );
    const rendered = responseText(searchResult);
    expect(rendered).toContain(markerA);
    expect(rendered).not.toContain(markerB);

    const controlledPath = join(projectA, ".trellis", "tasks", "task-1", "recovery-brief.json");
    mkdirSync(join(projectA, ".trellis", "tasks", "task-1"), { recursive: true });
    writeFileSync(controlledPath, `# Controlled RecoveryBrief\n\n${markerB}-recovery\n`, "utf8");
    const rejected = await withProjectDirOverride(
      { projectDir: projectA, sessionId: sessionA },
      async () => indexTool!.handler({ path: controlledPath }),
    ) as ToolResponse;
    expect(rejected.isError).toBe(true);
    expect(responseText(rejected)).toContain("controlled RecoveryBrief state cannot be indexed");

    const recoverySearch = await withProjectDirOverride(
      { projectDir: projectA, sessionId: sessionA },
      async () => searchTool!.handler({
        queries: [`${markerB}-recovery`],
        project: projectA,
      }),
    );
    expect(responseText(recoverySearch)).toContain("No results found.");

    // ctx_search schedules retrieval-byte accounting after the handler returns.
    // Keep the isolated storage override in scope until those callbacks flush.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const purged = await withProjectDirOverride(
      { projectDir: projectA, sessionId: sessionA },
      async () => purgeTool!.handler({ confirm: true, scope: "project" }),
    );
    expect((purged as ToolResponse).isError).not.toBe(true);
  });

  test("ctx_index enforces protected and Git-ignored paths regardless of caller filters", async () => {
    execFileSync("git", ["init", "-q", projectA]);
    writeFileSync(join(projectA, ".gitignore"), "ignored-runtime.md\n", "utf8");
    writeFileSync(join(projectA, "visible.md"), "visible-handler-marker\n", "utf8");
    writeFileSync(join(projectA, "ignored-runtime.md"), "ignored-handler-marker\n", "utf8");
    mkdirSync(join(projectA, ".trellis", "tasks"), { recursive: true });
    writeFileSync(join(projectA, ".trellis", "tasks", "state.md"), "trellis-handler-marker\n", "utf8");

    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../../src/server.js");
    const indexTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index");
    const searchTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search");
    const purgeTool = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge");
    expect(indexTool).toBeDefined();
    expect(searchTool).toBeDefined();
    expect(purgeTool).toBeDefined();

    const directoryResult = await withProjectDirOverride(
      { projectDir: projectA, sessionId: "protected-index-session" },
      async () => indexTool!.handler({
        path: projectA,
        include: ["**"],
        exclude: [],
        extensions: [".md"],
        respectGitignore: false,
        maxDepth: 8,
      }),
    ) as ToolResponse;
    expect(directoryResult.isError).not.toBe(true);
    expect(responseText(directoryResult)).toContain("Indexed 1 file");

    const rejected = await withProjectDirOverride(
      { projectDir: projectA, sessionId: "protected-index-session" },
      async () => indexTool!.handler({ path: join(projectA, "ignored-runtime.md") }),
    ) as ToolResponse;
    expect(rejected.isError).toBe(true);
    expect(responseText(rejected)).toMatch(/ignored|refusing to index/i);

    const protectedRejected = await withProjectDirOverride(
      { projectDir: projectA, sessionId: "protected-index-session" },
      async () => indexTool!.handler({ path: join(projectA, ".trellis", "tasks", "state.md") }),
    ) as ToolResponse;
    expect(protectedRejected.isError).toBe(true);
    expect(responseText(protectedRejected)).toMatch(/protected|controlled RecoveryBrief/i);

    const searchResult = await withProjectDirOverride(
      { projectDir: projectA, sessionId: "protected-index-session" },
      async () => searchTool!.handler({
        queries: ["ignored-handler-marker", "trellis-handler-marker"],
        project: projectA,
      }),
    );
    expect(responseText(searchResult)).toContain("No results found.");

    const purged = await withProjectDirOverride(
      { projectDir: projectA, sessionId: "protected-index-session" },
      async () => purgeTool!.handler({ confirm: true, scope: "project" }),
    ) as ToolResponse;
    expect(purged.isError).not.toBe(true);
  });
});
