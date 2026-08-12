import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { addResponseNotice, compactTypedResult } from "../../src/server.js";

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
    expect(reportToolSource).toContain("compactTypedResult(report)");
    expect(serverSource).toContain("addResponseNotice(response, warning)");
  });

  test("keeps compact text self-sufficient and exactly mirrors bounded structured state", () => {
    const report = {
      available: true,
      windowDays: 7,
      warnings: ["pending checkpoint"],
      delivery: { full: 2, pruned: 1, idOnly: 0 },
    };
    const result = compactTypedResult(report);

    expect(result.content[0].text).toBe(JSON.stringify(report));
    expect(JSON.parse(result.content[0].text)).toEqual(report);
    expect(result.structuredContent).toEqual(report);
    expect(result.content[0].text).not.toContain("\n");
    expect(result.isError).toBeUndefined();

    const failure = compactTypedResult({ ok: false, errorCode: "CONFLICT" }, true);
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toEqual(JSON.parse(failure.content[0].text));
  });

  test("keeps version notices without corrupting compact typed JSON", () => {
    const typed = compactTypedResult({ available: true, warnings: [] });
    addResponseNotice(typed, "upgrade available");

    expect(typed.content).toEqual([
      { type: "text", text: '{"available":true,"warnings":[]}' },
      { type: "text", text: "upgrade available" },
    ]);
    expect(typed.structuredContent).toEqual(JSON.parse(typed.content[0].text));

    const plain = { content: [{ type: "text" as const, text: "result" }] };
    expect(addResponseNotice(plain, "upgrade available").content[0].text).toBe(
      "upgrade available\n\nresult",
    );
  });
});
