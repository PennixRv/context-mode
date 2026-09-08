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
    expect(status).toContain("withRecoveryBriefAttribution");
    expect(status).toContain("[RECOVERY_BRIEF_CAPABILITY_FIELD]: z.unknown().optional()");
    expect(status).not.toContain("session_id");
    expect(update).toContain('z.literal("absent")');
    expect(update).toContain("brief: recoveryBriefV1Schema");
    expect(update).not.toContain("brief: z.unknown()");
    expect(update).toContain("updateRecoveryBriefProvider");
    expect(update).toContain("withRecoveryBriefAttribution");
    expect(update).toContain("[RECOVERY_BRIEF_CAPABILITY_FIELD]: z.unknown().optional()");
    expect(update).toContain("Never echoes the submitted Brief");
    expect(update).toContain('"hard_constraints": []');
    expect(update).toContain(`"source_sha256": "${"a".repeat(64)}"`);
    expect(update).not.toContain("JSON.stringify(brief");
    expect(init).toContain("compactTypedResult(result, !result.ok)");
    expect(status).toContain("compactTypedResult(status, status.errorCode");
    expect(update).toContain("compactTypedResult(result, !result.ok)");
    expect(init).not.toContain("JSON.stringify(result, null, 2)");
    expect(status).not.toContain("JSON.stringify(status, null, 2)");
    expect(update).not.toContain("JSON.stringify(result, null, 2)");
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

  it("ships only the low-level provider skill; the project workflow owns semantic gates", () => {
    expect(existsSync(providerSkillPath)).toBe(true);
    expect(existsSync(providerReferencePath)).toBe(true);
    expect(existsSync(resolve(
      repositoryRoot,
      ".agents",
      "skills",
      "trellis-recovery-brief-sync",
      "SKILL.md",
    ))).toBe(false);
    const skill = readFileSync(providerSkillPath, "utf8");
    const reference = readFileSync(providerReferencePath, "utf8");
    const contextModeSkill = readFileSync(resolve(repositoryRoot, "skills", "context-mode", "SKILL.md"), "utf8");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { files: string[] };
    const codexPlugin = JSON.parse(readFileSync(codexPluginPath, "utf8")) as { skills: string };

    expect(skill).toContain("name: ctx-recovery-brief");
    expect(skill).toContain("Low-level controlled RecoveryBrief provider protocol");
    expect(skill).toContain("trellisSourceSha256");
    expect(skill).toContain("Do not invoke this skill merely because a compact lifecycle ran");
    expect(skill).not.toContain("compaction preparation");
    expect(skill).toContain("references/recovery-brief-v1.md");
    expect(contextModeSkill).toContain("project workflow owns the approved");
    expect(contextModeSkill).toContain("compact events");
    expect(contextModeSkill).toContain("resumed");
    expect(contextModeSkill).toContain("not RecoveryBrief write triggers");
    expect(packageJson.files).toContain("skills");
    expect(codexPlugin.skills).toBe("./skills/");
    expect(reference).toContain("fails closed");
    expect(reference).toContain("not semantic quality");
    expect(reference).toContain("trellisSourceSha256");
    expect(reference).toContain("TRELLIS_SOURCE_MISMATCH");
    expect(reference).toContain("TRELLIS_SOURCE_DRIFT");
  });
});
