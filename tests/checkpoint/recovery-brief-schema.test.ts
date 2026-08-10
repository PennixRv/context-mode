import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { recoveryBriefV1Schema } from "../../src/checkpoint/recovery-brief-schema.js";
import {
  RECOVERY_BRIEF_LIMITS,
  RECOVERY_BRIEF_SLOT_PRIORITIES,
  type RecoveryBrief,
  type RecoveryBriefFact,
  type RecoveryBriefSlot,
} from "../../src/checkpoint/types.js";

const SOURCE_SHA256 = "a".repeat(64);
const VALID_AT = "2026-08-10T00:00:00.000Z";

function fact(priority: RecoveryBriefFact["priority"]): RecoveryBriefFact {
  return {
    value: "Verified task state",
    priority,
    source_kind: "trellis_task",
    source_sha256: SOURCE_SHA256,
    valid_at: VALID_AT,
  };
}

function brief(): RecoveryBrief {
  return {
    schema_version: 1,
    updated_at: VALID_AT,
    objective: fact("critical"),
    hard_constraints: [],
    decisions: [],
    completed_work: [],
    open_work: [],
    latest_blocker: null,
    next_action: null,
    project_state: null,
  };
}

function briefWithSlot(slot: RecoveryBriefSlot, value: RecoveryBriefFact): RecoveryBrief {
  const candidate = brief();
  if (slot === "objective") candidate.objective = value;
  else if (slot === "hard_constraints") candidate.hard_constraints = [value];
  else if (slot === "decisions") candidate.decisions = [value];
  else if (slot === "completed_work") candidate.completed_work = [value];
  else if (slot === "open_work") candidate.open_work = [value];
  else candidate[slot] = value;
  return candidate;
}

describe("RecoveryBrief v1 MCP schema", () => {
  it("accepts the complete minimal shape and rejects unknown fields", () => {
    expect(recoveryBriefV1Schema.safeParse(brief()).success).toBe(true);
    expect(recoveryBriefV1Schema.safeParse({ ...brief(), extra: "not allowed" }).success).toBe(false);
    expect(recoveryBriefV1Schema.safeParse({
      ...brief(),
      objective: { ...brief().objective, extra: "not allowed" },
    }).success).toBe(false);
  });

  it("publishes and enforces the slot-specific priority literals", () => {
    for (const [slot, priority] of Object.entries(RECOVERY_BRIEF_SLOT_PRIORITIES) as Array<
      [RecoveryBriefSlot, RecoveryBriefFact["priority"]]
    >) {
      const valid = briefWithSlot(slot, fact(priority));
      expect(recoveryBriefV1Schema.safeParse(valid).success, slot).toBe(true);

      const wrongPriority = priority === "critical" ? "important" : "critical";
      const invalid = recoveryBriefV1Schema.safeParse(briefWithSlot(slot, fact(wrongPriority)));
      expect(invalid.success, slot).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues.some((issue) => issue.path.includes("priority")), slot).toBe(true);
      }
    }
  });

  it("exposes source, timestamp, digest, value, and list bounds", () => {
    const tooMany = Array.from(
      { length: RECOVERY_BRIEF_LIMITS.factsPerList + 1 },
      () => fact("critical"),
    );
    expect(recoveryBriefV1Schema.safeParse({ ...brief(), hard_constraints: tooMany }).success).toBe(false);
    expect(recoveryBriefV1Schema.safeParse({
      ...brief(),
      objective: { ...fact("critical"), source_kind: "caller_claim" },
    }).success).toBe(false);
    expect(recoveryBriefV1Schema.safeParse({
      ...brief(),
      objective: { ...fact("critical"), source_sha256: "A".repeat(64) },
    }).success).toBe(false);
    expect(recoveryBriefV1Schema.safeParse({ ...brief(), updated_at: "2026-08-10" }).success).toBe(false);
    expect(recoveryBriefV1Schema.safeParse({
      ...brief(),
      objective: { ...fact("critical"), value: " \t " },
    }).success).toBe(false);
  });

  it("projects the complete nested shape through MCP tools/list", async () => {
    const server = new McpServer({ name: "recovery-brief-schema-test", version: "0.0.0" });
    server.registerTool(
      "ctx_recovery_brief_update",
      { inputSchema: z.object({ brief: recoveryBriefV1Schema }) },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );
    const client = new Client(
      { name: "recovery-brief-schema-client", version: "0.0.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const listed = await client.listTools();
      const inputSchema = listed.tools.find((tool) => tool.name === "ctx_recovery_brief_update")
        ?.inputSchema as {
          properties?: Record<string, unknown>;
        } | undefined;
      const briefSchema = inputSchema?.properties?.brief as {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
        required?: string[];
      } | undefined;
      const hardConstraints = briefSchema?.properties?.hard_constraints as {
        maxItems?: number;
      } | undefined;

      expect(Object.keys(briefSchema?.properties ?? {})).toEqual([
        "schema_version",
        "updated_at",
        "objective",
        "hard_constraints",
        "decisions",
        "completed_work",
        "open_work",
        "latest_blocker",
        "next_action",
        "project_state",
      ]);
      expect(briefSchema?.required).toEqual(Object.keys(briefSchema?.properties ?? {}));
      expect(briefSchema?.additionalProperties).toBe(false);
      expect(hardConstraints?.maxItems).toBe(RECOVERY_BRIEF_LIMITS.factsPerList);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
