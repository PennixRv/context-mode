import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isRecoveryBriefIndexPath } from "../../src/store.js";

const repositoryRoot = resolve(__dirname, "..", "..");
const serverSource = readFileSync(resolve(repositoryRoot, "src", "server.ts"), "utf8");
const workflowPath = resolve(repositoryRoot, ".trellis", "workflow.md");
const providerSkillPath = resolve(repositoryRoot, "skills", "ctx-recovery-brief", "SKILL.md");
const providerReferencePath = resolve(
  repositoryRoot,
  "skills",
  "ctx-recovery-brief",
  "references",
  "recovery-brief-v1.md",
);
const syncSkillPath = resolve(
  repositoryRoot,
  ".agents",
  "skills",
  "trellis-recovery-brief-sync",
  "SKILL.md",
);
const packagePath = resolve(repositoryRoot, "package.json");
const codexPluginPath = resolve(repositoryRoot, ".codex-plugin", "plugin.json");

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

  it("ships a low-level provider skill and a Trellis coordinator skill", () => {
    expect(existsSync(providerSkillPath)).toBe(true);
    expect(existsSync(providerReferencePath)).toBe(true);
    expect(existsSync(syncSkillPath)).toBe(true);
    const skill = readFileSync(providerSkillPath, "utf8");
    const reference = readFileSync(providerReferencePath, "utf8");
    const syncSkill = readFileSync(syncSkillPath, "utf8");
    const contextModeSkill = readFileSync(resolve(repositoryRoot, "skills", "context-mode", "SKILL.md"), "utf8");
    const workflow = readFileSync(workflowPath, "utf8");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { files: string[] };
    const codexPlugin = JSON.parse(readFileSync(codexPluginPath, "utf8")) as { skills: string };

    expect(skill).toContain("name: ctx-recovery-brief");
    expect(skill).toContain("Low-level controlled RecoveryBrief provider protocol");
    expect(skill).toContain("trellisSourceSha256");
    expect(skill).toContain("Do not invoke this skill merely because a compact lifecycle ran");
    expect(skill).not.toContain("compaction preparation");
    expect(skill).toContain("references/recovery-brief-v1.md");
    expect(syncSkill).toContain("name: trellis-recovery-brief-sync");
    expect(syncSkill).toContain("Only the main coordinator may run this synchronization protocol");
    expect(syncSkill).toContain("Immediately after an approved `task.py start`");
    expect(syncSkill).toContain("After `trellis-check` confirms a material semantic change");
    expect(syncSkill).toContain("Before an explicit handoff, pause preparation, finish, or archive");
    expect(syncSkill).toContain("Do not invoke this skill for ordinary edits");
    for (const excludedTrigger of [
      /regular compact\s+events/,
      /`PreCompact`/,
      /`PostCompact`/,
      /`SessionStart\(compact\)`/,
      /checkpoint\s+`claimed`/,
      /ordinary resumed session/,
    ]) {
      expect(syncSkill).toMatch(excludedTrigger);
    }
    expect(syncSkill).toContain("SessionStart(compact)");
    expect(syncSkill).toContain("`claimed`");
    for (const excludedSource of [
      "transcript",
      "FTS result",
      "raw tool I/O",
      "full artifact body",
      "task-body copies",
    ]) {
      expect(syncSkill).toContain(excludedSource);
    }
    expect(contextModeSkill).toContain("trellis-recovery-brief-sync");
    expect(contextModeSkill).toContain("compact events");
    expect(contextModeSkill).toContain("resumed sessions");
    expect(contextModeSkill).toContain("not RecoveryBrief write triggers");
    expect(workflow).toContain("### RecoveryBrief Synchronization");
    expect(workflow).toContain("Workers report evidence but never write a RecoveryBrief.");
    expect(workflow).toContain("Do not synchronize for ordinary edits");
    for (const excludedTrigger of [
      "compaction",
      "PreCompact",
      "PostCompact",
      "SessionStart(compact)",
      "claimed checkpoints",
      "ordinary resume",
    ]) {
      expect(workflow).toContain(excludedTrigger);
    }
    expect(packageJson.files).toContain("skills");
    expect(codexPlugin.skills).toBe("./skills/");
    expect(reference).toContain("fails closed");
    expect(reference).toContain("not semantic quality");
    expect(reference).toContain("trellisSourceSha256");
    expect(reference).toContain("TRELLIS_SOURCE_MISMATCH");
    expect(reference).toContain("TRELLIS_SOURCE_DRIFT");
  });
});
