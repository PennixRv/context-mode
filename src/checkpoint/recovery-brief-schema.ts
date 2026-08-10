import { z } from "zod";

import {
  RECOVERY_BRIEF_LIMITS,
  RECOVERY_BRIEF_SLOT_PRIORITIES,
  RECOVERY_BRIEF_SOURCE_KINDS,
  type RecoveryBrief,
  type RecoveryBriefSlot,
} from "./types.js";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const factValueSchema = z.string()
  .min(1)
  .max(RECOVERY_BRIEF_LIMITS.factValueBytes)
  .regex(/^(?!\s*$)[^\u0000-\u001f\u007f]+$/u)
  .describe(`Non-empty text without control characters; maximum ${RECOVERY_BRIEF_LIMITS.factValueBytes} UTF-8 bytes`);

const timestampSchema = z.string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .describe("Canonical UTC ISO-8601 timestamp");

function recoveryBriefFactSchema(slot: RecoveryBriefSlot) {
  return z.object({
    value: factValueSchema,
    priority: z.literal(RECOVERY_BRIEF_SLOT_PRIORITIES[slot]),
    source_kind: z.enum(RECOVERY_BRIEF_SOURCE_KINDS),
    source_sha256: z.string().regex(SHA256_PATTERN),
    valid_at: timestampSchema,
  }).strict();
}

export const recoveryBriefV1Schema = z.object({
  schema_version: z.literal(1),
  updated_at: timestampSchema,
  objective: recoveryBriefFactSchema("objective"),
  hard_constraints: z.array(recoveryBriefFactSchema("hard_constraints"))
    .max(RECOVERY_BRIEF_LIMITS.factsPerList),
  decisions: z.array(recoveryBriefFactSchema("decisions"))
    .max(RECOVERY_BRIEF_LIMITS.factsPerList),
  completed_work: z.array(recoveryBriefFactSchema("completed_work"))
    .max(RECOVERY_BRIEF_LIMITS.factsPerList),
  open_work: z.array(recoveryBriefFactSchema("open_work"))
    .max(RECOVERY_BRIEF_LIMITS.factsPerList),
  latest_blocker: recoveryBriefFactSchema("latest_blocker").nullable(),
  next_action: recoveryBriefFactSchema("next_action").nullable(),
  project_state: recoveryBriefFactSchema("project_state").nullable(),
}).strict() satisfies z.ZodType<RecoveryBrief>;
