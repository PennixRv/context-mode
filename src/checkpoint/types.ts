export type CheckpointState = "pending" | "confirmed" | "claimed" | "expired" | "invalid";

export type CompactionTrigger = "manual" | "auto";

export type CheckpointProjectionMode = "full" | "pruned" | "id_only";

export type RecoveryBriefStatus = "absent" | "invalid" | "available";

export type RecoveryBriefFactPriority = "critical" | "important" | "optional";

export type RecoveryBriefSourceKind = "trellis_task" | "explicit_project_state" | "git";

export interface CheckpointIdentity {
  canonicalProjectRoot: string;
  projectHash: string;
  worktreeHash: string;
  worktreeIdentity: string;
  dbPath: string;
  gitAvailable: boolean;
}

export interface CheckpointSignal {
  sessionId: string;
  turnId: string;
  kind: "prompt_submitted" | "tool_completed";
  toolKind: string | null;
  outcome: "success" | "error" | "unknown";
  pathOrCommandDigest: string | null;
  createdAt: string;
}

export interface ChangedPath {
  path: string;
  status: string;
}

export interface GitEvidence {
  availability: "available" | "unavailable";
  head: string | null;
  branch: string | null;
  statusDigest: string | null;
  changedPaths: ChangedPath[];
  changedPathCount: number;
  omittedChangedPathCount: number;
}

export interface TrellisArtifact {
  path: string;
  sha256: string;
}

export interface TrellisEvidence {
  bridgeStatus: "absent" | "runtime_missing" | "stale" | "invalid" | "active";
  task: "absent" | "active";
  taskId: string | null;
  taskStatus: string | null;
  taskPhase: string | null;
  updatedAt: string | null;
  artifacts: TrellisArtifact[];
  omittedArtifactCount: number;
}

/**
 * Explicit task state maintained by Trellis. This is deliberately separate
 * from CheckpointPayload so the audit payload remains privacy-minimal.
 */
export interface RecoveryBriefFact {
  value: string | "unknown";
  priority: RecoveryBriefFactPriority;
  source_kind: RecoveryBriefSourceKind;
  source_sha256: string;
  valid_at: string;
}

export interface RecoveryBrief {
  schema_version: 1;
  updated_at: string;
  objective: RecoveryBriefFact;
  hard_constraints: RecoveryBriefFact[];
  decisions: RecoveryBriefFact[];
  completed_work: RecoveryBriefFact[];
  open_work: RecoveryBriefFact[];
  latest_blocker: RecoveryBriefFact | null;
  next_action: RecoveryBriefFact | null;
  project_state: RecoveryBriefFact | null;
}

export interface CheckpointPayload {
  schema_version: 1;
  created_at: string;
  session_id: string;
  turn_id: string;
  sequence: number;
  trigger: CompactionTrigger;
  project: {
    canonical_root: string;
    project_sha256: string;
    worktree_sha256: string;
  };
  git: GitEvidence;
  signals: Array<{
    kind: CheckpointSignal["kind"];
    tool_kind: string | null;
    outcome: CheckpointSignal["outcome"];
    digest: string | null;
  }>;
  trellis: TrellisEvidence;
}

export interface CheckpointRow {
  checkpoint_id: string;
  schema_version: number;
  session_id: string;
  turn_id: string;
  sequence: number;
  trigger: CompactionTrigger;
  canonical_project_root: string;
  worktree_identity: string;
  state: CheckpointState;
  payload_json: string;
  payload_sha256: string;
  recovery_json: string | null;
  recovery_sha256: string | null;
  recovery_status: RecoveryBriefStatus | null;
  created_at: string;
  confirmed_at: string | null;
  claimed_at: string | null;
  expires_at: string;
}

export interface CheckpointStateCounts {
  pending: number;
  confirmed: number;
  claimed: number;
  expired: number;
  invalid: number;
}

export interface CheckpointTriggerReliability {
  checkpointCount: number;
  stateCounts: CheckpointStateCounts;
  confirmationRate: number | null;
  claimRate: number | null;
}

export interface CheckpointLatencySummary {
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface CheckpointDeliverySummary {
  full: number;
  pruned: number;
  idOnly: number;
  unknown: number;
  emittedBytesTotal: number;
  emittedBytesAverage: number | null;
}

export interface CheckpointReliabilityReport {
  available: boolean;
  project: {
    canonicalRoot: string;
    projectSha256: string;
    worktreeSha256: string;
  };
  window: {
    startAt: string;
    endAt: string;
  };
  total: CheckpointTriggerReliability;
  byTrigger: Record<CompactionTrigger, CheckpointTriggerReliability>;
  latencyMs: {
    createdToConfirmed: CheckpointLatencySummary;
    confirmedToClaimed: CheckpointLatencySummary;
  };
  delivery: CheckpointDeliverySummary;
  overduePendingCount: number;
  warnings: string[];
}

export interface CheckpointHookInput {
  session_id?: unknown;
  sessionId?: unknown;
  conversation_id?: unknown;
  turn_id?: unknown;
  turnId?: unknown;
  cwd?: unknown;
  trigger?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_response?: unknown;
}
