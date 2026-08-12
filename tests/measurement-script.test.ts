import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, test } from "vitest";
import { sourcePreviewChars } from "../scripts/response-measurement-utils.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = mkdtempSync(join(tmpdir(), "ctx-measure-failure-"));
const failingEntry = join(fixture, "failing-entry.mjs");

writeFileSync(
  failingEntry,
  [
    'process.stderr.write("authorization=fixture-secret\\n");',
    'process.stderr.write("x".repeat(3000));',
    'process.stderr.write("\\nMEASURE_FAILURE_TAIL\\n");',
    "process.exit(17);",
  ].join("\n"),
  "utf8",
);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

describe("response measurement replay", () => {
  test("extracts current and archived source-preview formats", () => {
    expect(sourcePreviewChars(
      "Executed javascript | 64/365 chars (truncated; 301 omitted) | sha256=fixture",
    )).toBe(64);
    expect(sourcePreviewChars(
      "Executed javascript | path=input.txt | 80/4027 chars (truncated; 3947 omitted) | sha256=fixture",
    )).toBe(80);
    expect(sourcePreviewChars(
      "Executed javascript | source=365 chars | preview=240 chars | omitted=125 chars",
    )).toBe(240);
    expect(sourcePreviewChars("Persisted: no")).toBeNull();
  });

  test.each([
    "scripts/measure-response-sizes.mjs",
    ".trellis/tasks/archive/2026-08/08-10-harden-execution-project-boundary/research/measure-response-sizes.mjs",
  ])("%s discovers the component root and reports bounded sanitized MCP stderr", (relativeScript) => {
    const run = spawnSync(
      process.execPath,
      [resolve(root, relativeScript), "--entry", failingEntry],
      {
        cwd: fixture,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, CONTEXT_MODE_DISABLE_VERSION_CHECK: "1" },
      },
    );

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("response measurement legacy-proxy failed");
    expect(run.stderr).toContain("MEASURE_FAILURE_TAIL");
    expect(run.stderr).not.toContain("fixture-secret");
    const encodedTail = /stderrTail=("(?:\\.|[^"\\])*")/.exec(run.stderr)?.[1];
    expect(encodedTail).toBeTruthy();
    expect(JSON.parse(encodedTail!).length).toBeLessThanOrEqual(2_048);
  });
});
