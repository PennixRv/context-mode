import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(__dirname, "..", "..");
const serverSource = readFileSync(resolve(repositoryRoot, "src", "server.ts"), "utf8");
const reportToolStart = serverSource.indexOf('server.registerTool(\n  "ctx_checkpoint_report"');
const reportToolEnd = serverSource.indexOf("// ── ctx-doctor", reportToolStart);
const reportToolSource = serverSource.slice(reportToolStart, reportToolEnd);

describe("ctx_checkpoint_report MCP contract", () => {
  test("registers the report as a local read-only tool with a bounded window", () => {
    expect(reportToolStart).toBeGreaterThanOrEqual(0);
    expect(reportToolEnd).toBeGreaterThan(reportToolStart);
    expect(reportToolSource).toContain("readOnlyHint: true");
    expect(reportToolSource).toContain("destructiveHint: false");
    expect(reportToolSource).toContain("idempotentHint: true");
    expect(reportToolSource).toContain("openWorldHint: false");
    expect(reportToolSource).toContain("window_days: z.number().int().min(1).max(30).optional()");
  });

  test("delegates to the local aggregate report without exposing checkpoint evidence", () => {
    expect(reportToolSource).toContain("getCheckpointReliabilityReport(projectDir, configDir");
    expect(reportToolSource).toContain('trackResponse("ctx_checkpoint_report"');
    expect(reportToolSource).toContain("never returns checkpoint payloads, prompts");
    expect(reportToolSource).not.toContain("payload_json");
    expect(reportToolSource).not.toContain("tool_input");
    expect(reportToolSource).not.toContain("tool_output");
  });
});
