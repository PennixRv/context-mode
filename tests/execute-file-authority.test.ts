import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { PolyglotExecutor } from "../src/executor.js";

describe("ctx_execute_file host authority and resource protection", () => {
  const root = mkdtempSync(join(tmpdir(), "ctx-file-authority-"));
  const project = join(root, "project");
  const outside = join(root, "outside.txt");
  mkdirSync(project);
  writeFileSync(outside, "outside-authority-marker", "utf8");

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test.each([
    ["absolute", outside],
    ["relative traversal", "../outside.txt"],
  ])("reads a host-readable project-external file by %s path", async (_label, path) => {
    const executor = new PolyglotExecutor({ projectRoot: project });
    const result = await executor.executeFile({
      path,
      language: "javascript",
      code: "console.log(FILE_CONTENT)",
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("outside-authority-marker");
  });

  test("rejects an oversized snapshot before execution", async () => {
    const oversized = join(root, "oversized.txt");
    writeFileSync(oversized, "123456789", "utf8");
    const executor = new PolyglotExecutor({ projectRoot: project, maxInputFileBytes: 8 });
    const result = await executor.executeFile({
      path: oversized,
      language: "javascript",
      code: "console.log('must-not-run')",
    });
    expect(result).toMatchObject({ exitCode: 1, timedOut: false });
    expect(result.stderr).toContain("CTX_EXEC_FILE_TOO_LARGE");
    expect(result.stdout).not.toContain("must-not-run");
  });

  test("rejects directories and bounds symlink-loop errors", async () => {
    const loop = join(root, "loop");
    symlinkSync("loop", loop);
    const executor = new PolyglotExecutor({ projectRoot: project });
    const directoryResult = await executor.executeFile({
      path: root,
      language: "javascript",
      code: "console.log('must-not-run')",
    });
    const loopResult = await executor.executeFile({
      path: loop,
      language: "javascript",
      code: "console.log('must-not-run')",
    });

    expect(directoryResult.stderr).toContain("CTX_EXEC_FILE_NOT_REGULAR");
    expect(directoryResult.stderr).not.toContain(root);
    expect(loopResult.exitCode).toBe(1);
    expect(Array.from(loopResult.stderr).length).toBeLessThanOrEqual(2_048);
    expect(loopResult.stderr).not.toContain(loop);
    expect(loopResult.stdout).toBe("");
  });

  test("bounds OS path errors before returning them", async () => {
    const executor = new PolyglotExecutor({ projectRoot: project });
    const result = await executor.executeFile({
      path: `missing-${"x".repeat(3_000)}.txt`,
      language: "javascript",
      code: "console.log('must-not-run')",
    });

    expect(result.exitCode).toBe(1);
    expect(Array.from(result.stderr).length).toBeLessThanOrEqual(2_048);
    expect(result.stderr).not.toContain(project);
    expect(result.stdout).toBe("");
  });
});
