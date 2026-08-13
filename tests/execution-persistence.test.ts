import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { ContentStore } from "../src/store.js";
import { HOST_TEMP_DIRECTORY } from "../src/util/system-temp.js";

interface ToolResponse {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

function responseText(result: unknown): string {
  return ((result as ToolResponse).content ?? []).map((item) => item.text ?? "").join("\n");
}

describe("execution persistence and verified provenance", () => {
  const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-persistence-"));
  const project = join(root, "project");
  const storage = join(root, "storage");
  const original = {
    CONTEXT_MODE_DIR: process.env.CONTEXT_MODE_DIR,
    CONTEXT_MODE_PROJECT_DIR: process.env.CONTEXT_MODE_PROJECT_DIR,
    CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS: process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS,
    CONTEXT_MODE_DISABLE_VERSION_CHECK: process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK,
  };

  beforeAll(() => {
    mkdirSync(project, { recursive: true });
    mkdirSync(storage, { recursive: true });
    process.env.CONTEXT_MODE_DIR = storage;
    process.env.CONTEXT_MODE_PROJECT_DIR = project;
    process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
    process.env.CONTEXT_MODE_DISABLE_VERSION_CHECK = "1";
    vi.resetModules();
  });

  afterAll(async () => {
    try {
      const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
      const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
      await withProjectDirOverride(project, async () => purge.handler({
        confirm: true,
        scope: "project",
      }));
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("default output stays request-local; verified success is searchable and purgeable", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const execute = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_execute")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
    const localMarker = `request-local-${Date.now()}`;
    const verifiedMarker = `verified-${Date.now()}`;
    const failedMarker = `failed-${Date.now()}`;
    const source = `verified-source-${Date.now()}`;
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const local = await run(() => execute.handler({
      language: "javascript",
      code: `console.log(${JSON.stringify(localMarker)})`,
      background: false,
      persistence: { mode: "none" },
    }));
    expect(responseText(local)).toContain("Persisted: no");
    expect(responseText(await run(() => search.handler({ queries: [localMarker] }))))
      .toMatch(/Knowledge base is empty|No results found/);

    const verified = await run(() => execute.handler({
      language: "javascript",
      code: `console.log(${JSON.stringify(verifiedMarker)})`,
      background: false,
      persistence: {
        mode: "verified",
        source,
        provenance: { kind: "local-command", reference: "temporary fixture command" },
      },
    }));
    expect(responseText(verified)).toContain("Persisted: yes");
    expect(responseText(await run(() => search.handler({ queries: [verifiedMarker], source })))).toContain(verifiedMarker);

    const failed = await run(() => execute.handler({
      language: "javascript",
      code: `console.log(${JSON.stringify(failedMarker)}); process.exit(7)`,
      background: false,
      persistence: {
        mode: "verified",
        source: `${source}-failed`,
        provenance: { kind: "local-command", reference: "expected failing fixture" },
      },
    })) as ToolResponse;
    expect(failed.isError).toBe(true);
    expect(responseText(failed)).toContain("Persisted: no (failed output)");
    expect(responseText(await run(() => search.handler({ queries: [failedMarker] })))).toContain("No results found");

    const removed = await run(() => purge.handler({ confirm: true, scope: "source", source }));
    expect(responseText(removed)).toContain("Purged exact source");
    expect(responseText(await run(() => search.handler({ queries: [verifiedMarker], source }))))
      .toMatch(/Knowledge base is empty|No results found/);
  });

  test("ContentStore records bounded provenance and exact source removal", () => {
    const store = new ContentStore(join(root, "provenance.db"));
    try {
      store.indexPlainText(
        "verified provenance marker",
        "provenance-source",
        undefined,
        undefined,
        undefined,
        {
          kind: "external-locally-verified",
          reference: "local fixture after verification",
          verifiedAt: "2026-08-12T00:00:00.000Z",
          contentHash: "a".repeat(64),
        },
      );
      expect(store.getSourceMeta("provenance-source")).toMatchObject({
        provenanceKind: "external-locally-verified",
        provenanceReference: "local fixture after verification",
        verifiedAt: "2026-08-12T00:00:00.000Z",
        contentHash: "a".repeat(64),
      });
      expect(store.removeSource("provenance-source")).toBe(true);
      expect(store.removeSource("provenance-source")).toBe(false);
    } finally {
      store.cleanup();
    }
  });

  test("ContentStore index writes provenance through the atomic insertion path", () => {
    const store = new ContentStore(join(root, "index-provenance.db"));
    try {
      store.index({
        content: "# Verified file\n\natomic provenance marker",
        source: "index-provenance-source",
        provenance: {
          kind: "local-file",
          reference: "host-authorized fixture",
          verifiedAt: "2026-08-12T01:00:00.000Z",
          contentHash: "b".repeat(64),
        },
      });
      expect(store.getSourceMeta("index-provenance-source")).toMatchObject({
        provenanceKind: "local-file",
        provenanceReference: "host-authorized fixture",
        verifiedAt: "2026-08-12T01:00:00.000Z",
        contentHash: "b".repeat(64),
      });
    } finally {
      store.cleanup();
    }
  });

  test("empty successful output from execute and execute_file creates no persistent source", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const execute = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_execute")!;
    const executeFile = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_execute_file")!;
    const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
    const fixture = join(project, "empty-output.fixture");
    const executeSource = `empty-execute-${Date.now()}`;
    const fileSource = `empty-file-${Date.now()}`;
    writeFileSync(fixture, "fixture", "utf8");
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const executeResponse = await run(() => execute.handler({
      language: "javascript",
      code: "void 0",
      background: false,
      persistence: {
        mode: "verified",
        source: executeSource,
        provenance: { kind: "local-command", reference: "empty output fixture" },
      },
    }));
    expect(responseText(executeResponse)).toContain("Persisted: no (empty stdout)");

    const fileResponse = await run(() => executeFile.handler({
      path: fixture,
      language: "javascript",
      code: "void FILE_CONTENT",
      persistence: {
        mode: "verified",
        source: fileSource,
        provenance: { kind: "local-file", reference: fixture },
      },
    }));
    expect(responseText(fileResponse)).toContain("Persisted: no (empty stdout)");

    expect(responseText(await run(() => purge.handler({ confirm: true, scope: "source", source: executeSource }))))
      .toContain("No persistent source matched");
    expect(responseText(await run(() => purge.handler({ confirm: true, scope: "source", source: fileSource }))))
      .toContain("No persistent source matched");
  });

  test("execute, execute_file, and explicit index(path) share host-authorized external path semantics", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const execute = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_execute")!;
    const executeFile = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_execute_file")!;
    const index = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
    const outside = join(root, "host-authorized-outside.txt");
    const marker = `outside-path-${Date.now()}`;
    const source = `outside-source-${Date.now()}`;
    writeFileSync(outside, marker, "utf8");
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const shellResponse = await run(() => execute.handler({
      language: "shell",
      code: `cat ${JSON.stringify(outside)}`,
      background: false,
      persistence: { mode: "none" },
    }));
    expect(responseText(shellResponse)).toContain(marker);
    expect(responseText(shellResponse)).toContain("Persisted: no");

    const fileResponse = await run(() => executeFile.handler({
      path: outside,
      language: "javascript",
      code: "console.log(FILE_CONTENT)",
      persistence: { mode: "none" },
    }));
    expect(responseText(fileResponse)).toContain(marker);
    expect(responseText(fileResponse)).toContain("Persisted: no");

    const indexResponse = await run(() => index.handler({ path: outside, source }));
    expect(responseText(indexResponse)).toContain("Indexed");
    expect(responseText(await run(() => search.handler({ queries: [marker], source })))).toContain(marker);
    expect(responseText(await run(() => purge.handler({ confirm: true, scope: "source", source }))))
      .toContain("Purged exact source");
  });

  test("verified batch persistence stores successful bodies but not labels or commands", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const batch = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_batch_execute")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    const source = `verified-batch-${Date.now()}`;
    const bodyMarker = `body-${Date.now()}`;
    const labelMarker = `label-${Date.now()}`;
    const commandMarker = `command-${Date.now()}`;
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const response = await run(() => batch.handler({
      commands: [{
        label: labelMarker,
        command: `ignored=${JSON.stringify(commandMarker)}; printf %s ${JSON.stringify(bodyMarker)}`,
      }],
      queries: [bodyMarker],
      timeout: 20_000,
      concurrency: 1,
      cwd: project,
      query_scope: "batch",
      persistence: {
        mode: "verified",
        source,
        provenance: { kind: "local-command", reference: "verified batch fixture" },
      },
    }));

    expect(responseText(response)).toContain("Persisted: yes");
    expect(responseText(await run(() => search.handler({ queries: [bodyMarker], source })))).toContain(bodyMarker);
    expect(responseText(await run(() => search.handler({ queries: [labelMarker], source })))).toContain("No results found");
    expect(responseText(await run(() => search.handler({ queries: [commandMarker], source })))).toContain("No results found");
  });

  test("verified batch with empty successful stdout creates no persistent source", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const batch = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_batch_execute")!;
    const purge = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_purge")!;
    const source = `empty-batch-${Date.now()}`;
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const response = await run(() => batch.handler({
      commands: [{ label: "empty successful command", command: ":" }],
      queries: [],
      timeout: 20_000,
      concurrency: 1,
      cwd: project,
      query_scope: "batch",
      persistence: {
        mode: "verified",
        source,
        provenance: { kind: "local-command", reference: "empty batch fixture" },
      },
    }));

    expect(responseText(response)).toContain("No successful stdout was eligible");
    expect(responseText(await run(() => purge.handler({ confirm: true, scope: "source", source }))))
      .toContain("No persistent source matched");
  });

  test("batch query finds dynamically discovered body in the same request without persistence", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const batch = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_batch_execute")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    const marker = `dynamic-discovery-${Date.now()}`;
    writeFileSync(join(project, "discovered.fixture"), marker, "utf8");
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    const response = await run(() => batch.handler({
      commands: [{
        label: "dynamic discovery",
        command: "for file in *.fixture; do cat \"$file\"; done",
      }],
      queries: [marker],
      timeout: 20_000,
      concurrency: 1,
      cwd: project,
      query_scope: "batch",
      persistence: { mode: "none" },
    }));

    expect(responseText(response)).toContain(marker);
    expect(responseText(response)).toContain("Persisted: no");
    expect(responseText(await run(() => search.handler({ queries: [marker] }))))
      .toMatch(/Knowledge base is empty|No results found/);
  });

  test("non-persistent global batch query reads existing FTS without retaining current output", async () => {
    const { REGISTERED_CTX_TOOLS, withProjectDirOverride } = await import("../src/server.js");
    const batch = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_batch_execute")!;
    const index = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_index")!;
    const search = REGISTERED_CTX_TOOLS.find((tool) => tool.name === "ctx_search")!;
    const persistentMarker = `existing-global-${Date.now()}`;
    const currentMarker = `request-only-global-${Date.now()}`;
    const source = `global-source-${Date.now()}`;
    const fixture = join(project, "global-query.fixture");
    writeFileSync(fixture, persistentMarker, "utf8");
    const run = <T>(operation: () => Promise<T> | T) => withProjectDirOverride(project, async () => operation());

    await run(() => index.handler({ path: fixture, source }));
    const response = await run(() => batch.handler({
      commands: [{ label: "request-only output", command: `printf %s ${JSON.stringify(currentMarker)}` }],
      queries: [persistentMarker],
      timeout: 20_000,
      concurrency: 1,
      cwd: project,
      query_scope: "global",
      persistence: { mode: "none" },
    }));

    expect(responseText(response)).toContain("Persisted: no");
    expect(responseText(response)).toContain(persistentMarker);
    expect(responseText(await run(() => search.handler({ queries: [currentMarker] }))))
      .toContain("No results found");
  });

});
