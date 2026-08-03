import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isRecoveryBriefIndexPath } from "../../src/store.js";

const repositoryRoot = resolve(__dirname, "..", "..");
const serverSource = readFileSync(resolve(repositoryRoot, "src", "server.ts"), "utf8");
const providerSkillPath = resolve(repositoryRoot, "skills", "ctx-recovery-brief", "SKILL.md");
const providerReferencePath = resolve(
  repositoryRoot,
  "skills",
  "ctx-recovery-brief",
  "references",
  "recovery-brief-v1.md",
);

function toolSource(name: string, nextMarker: string): string {
  const start = serverSource.indexOf(`server.registerTool(\n  "${name}"`);
  const end = serverSource.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return serverSource.slice(start, end);
}

describe("RecoveryBrief MCP contracts", () => {
  it("registers explicit init, content-free status, and CAS update tools", () => {
    const init = toolSource("ctx_recovery_brief_init", 'server.registerTool(\n  "ctx_recovery_brief_status"');
    const status = toolSource("ctx_recovery_brief_status", 'server.registerTool(\n  "ctx_recovery_brief_update"');
    const update = toolSource("ctx_recovery_brief_update", "// ── ctx-doctor");

    expect(init).toContain("readOnlyHint: false");
    expect(init).toContain('storage: z.enum(["local", "tracked"])');
    expect(init).toContain("initializeProjectRecoveryBriefProvider");
    expect(status).toContain("readOnlyHint: true");
    expect(status).toContain("currentAttribution()?.sessionId");
    expect(status).not.toContain("session_id");
    expect(update).toContain('z.literal("absent")');
    expect(update).toContain("updateRecoveryBriefProvider");
    expect(update).toContain("Never echoes the submitted Brief");
    expect(update).not.toContain("JSON.stringify(brief");
  });

  it("disables the upstream clone fallback for Codex marketplace installs", () => {
    const upgradeStart = serverSource.indexOf('server.registerTool(\n  "ctx_upgrade"');
    const upgradeSource = serverSource.slice(upgradeStart);
    expect(upgradeSource).toContain('platformId === "codex"');
    expect(upgradeSource).toContain("legacy clone/global upgrade fallback is intentionally disabled");
  });
});

describe("RecoveryBrief indexing and skill packaging", () => {
  it("denies controlled state from direct and directory index paths", () => {
    expect(isRecoveryBriefIndexPath("/work/.trellis/.runtime/sessions/codex_1.json")).toBe(true);
    expect(isRecoveryBriefIndexPath("/work/.trellis/tasks/task-1/recovery-brief.json")).toBe(true);
    expect(isRecoveryBriefIndexPath("/work/.context-mode/recovery-provider.json")).toBe(true);
    expect(isRecoveryBriefIndexPath("/work/.context-mode/recovery-brief.json")).toBe(true);
    expect(isRecoveryBriefIndexPath("/work/docs/recovery-brief.json")).toBe(false);
  });

  it("ships a focused dynamic skill with a one-level reference", () => {
    expect(existsSync(providerSkillPath)).toBe(true);
    expect(existsSync(providerReferencePath)).toBe(true);
    const skill = readFileSync(providerSkillPath, "utf8");
    const reference = readFileSync(providerReferencePath, "utf8");

    expect(skill).toContain("name: ctx-recovery-brief");
    expect(skill).toContain("compaction preparation");
    expect(skill).toContain("FTS results");
    expect(skill).toContain("Never assume this skill is loaded before compaction");
    expect(skill).toContain("references/recovery-brief-v1.md");
    expect(reference).toContain("fails closed");
    expect(reference).toContain("not semantic quality");
    expect(reference).toContain("trellisSourceSha256");
    expect(reference).toContain("TRELLIS_SOURCE_MISMATCH");
    expect(reference).toContain("TRELLIS_SOURCE_DRIFT");
  });
});
