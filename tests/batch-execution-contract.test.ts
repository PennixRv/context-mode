import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { PolyglotExecutor } from "../src/executor.js";
import { detectRuntimes } from "../src/runtime.js";
import {
  buildBatchNodeOptionsPrefix,
  runBatchCommands,
  type BatchCommand,
} from "../src/server.js";

describe.runIf(process.platform !== "win32")("POSIX batch script preservation", () => {
  const parent = mkdtempSync(join(tmpdir(), "ctx-batch-contract-"));
  const root = join(parent, "path with space and 'quote");
  const preload = join(root, "preload.cjs");
  mkdirSync(root);
  const runtimes = detectRuntimes();
  const executor = new PolyglotExecutor({ projectRoot: root, runtimes });
  const prefix = buildBatchNodeOptionsPrefix(runtimes.shell, preload);
  writeFileSync(preload, "process.env.CTX_BATCH_PRELOAD = 'active';\n", "utf8");

  const suffix = `${JSON.stringify(process.execPath)} -e 'process.stdout.write(process.env.CTX_BATCH_PRELOAD || "missing")'`;
  const compoundCommands: BatchCommand[] = [
    { label: "for", command: `for value in one; do :; done\n${suffix}` },
    { label: "if", command: `if true; then :; fi\n${suffix}` },
    { label: "while", command: `count=0\nwhile [ "$count" -lt 1 ]; do count=$((count + 1)); done\n${suffix}` },
    { label: "brace", command: `{ :; }\n${suffix}` },
    { label: "function", command: `fixture_function() { :; }\nfixture_function\n${suffix}` },
  ];

  afterAll(() => {
    executor.cleanupBackgrounded();
    rmSync(parent, { recursive: true, force: true });
  });

  test.each([1, 3])("keeps compound commands intact at concurrency=%i", async (concurrency) => {
    const result = await runBatchCommands(compoundCommands, {
      timeout: 20_000,
      concurrency,
      nodeOptsPrefix: prefix,
      cwd: root,
    }, executor);

    expect(result.statuses).toEqual(compoundCommands.map(() => "completed"));
    expect(result.exitCodes).toEqual(compoundCommands.map(() => 0));
    expect(result.searchableOutputs.every((output) => output.includes("active"))).toBe(true);
    expect(result.searchableBodies).toEqual(compoundCommands.map(() => "active"));
  });

  test.each([1, 2])("preserves non-zero exit status at concurrency=%i", async (concurrency) => {
    const result = await runBatchCommands([
      { label: "success", command: "printf success-body" },
      { label: "failure", command: "printf failure-body; exit 23" },
    ], {
      timeout: 20_000,
      concurrency,
      nodeOptsPrefix: prefix,
      cwd: root,
    }, executor);

    expect(result.statuses).toEqual(["completed", "failed"]);
    expect(result.exitCodes).toEqual([0, 23]);
    expect(result.searchableOutputs[0]).toContain("success-body");
    expect(result.searchableOutputs[1]).toBe("");
    expect(result.searchableBodies).toEqual(["success-body", ""]);
    expect(result.outputs[1]).toContain("failure-body");
  });

  test.each([1, 2])("reports shell syntax errors as failed without searchable body at concurrency=%i", async (concurrency) => {
    const result = await runBatchCommands([
      { label: "syntax failure", command: "if true; then" },
    ], {
      timeout: 20_000,
      concurrency,
      nodeOptsPrefix: prefix,
      cwd: root,
    }, executor);

    expect(result.statuses).toEqual(["failed"]);
    expect(result.exitCodes[0]).not.toBe(0);
    expect(result.searchableOutputs).toEqual([""]);
    expect(result.searchableBodies).toEqual([""]);
  });
});
