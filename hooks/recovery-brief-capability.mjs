/**
 * Bundle-only loader for the Codex RecoveryBrief identity capability.
 * The published archive deliberately excludes build/, so start.mjs must flag
 * a missing generated bundle as a partial install before this hook is used.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(moduleDir, "recovery-brief-capability.bundle.mjs");
const capabilityModule = await import(pathToFileURL(bundlePath).href);

export const {
  CODEX_RECOVERY_BRIEF_TOOL_MATCHER,
  RECOVERY_BRIEF_CAPABILITY_FIELD,
  consumeRecoveryBriefCapability,
  getRecoveryBriefCapabilityReadiness,
  isCodexRecoveryBriefToolName,
  issueRecoveryBriefCapability,
} = capabilityModule;
