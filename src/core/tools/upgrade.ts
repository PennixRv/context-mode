// Pennix Lifecycle is the sole installation owner. The user command remains discoverable.
import { z } from "zod/v4";
import { UPGRADE_MODES } from "../contracts/constants.ts";
import type { CtxUpgradeInput, ProjectContext, ToolContext, ToolReply } from "../contracts/types.ts";
import type { HostFileWriter } from "../ops/host-write.ts";
import { unknownField } from "./search.ts";

export type { CtxUpgradeInput } from "../contracts/types.ts";

export const ctxUpgradeSchema = z.object({
  mode: z.enum(UPGRADE_MODES).optional(),
  confirmDelete: z.boolean().optional(),
}, { error: unknownField }).strict();

export interface UpgradeDeps {
  project: Pick<ProjectContext, "projectKey" | "worktree" | "agent">;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  write?: HostFileWriter;
}

export async function runUpgrade(_input: CtxUpgradeInput, _deps?: UpgradeDeps): Promise<ToolReply> {
  return {
    text: "Pennix Lifecycle manages installation, updates and removal. Use pennix-component-lifecycle for the native owner plan; this tool changed no files.",
    isError: false,
    sandboxBytes: 0,
  };
}

async function handler(input: CtxUpgradeInput, _ctx: ToolContext): Promise<ToolReply> {
  return runUpgrade(input);
}

export const ctxUpgrade = Object.freeze({
  name: "ctx_upgrade",
  description: "",
  schema: ctxUpgradeSchema,
  readOnly: false,
  alwaysLoad: false,
  handler,
});
