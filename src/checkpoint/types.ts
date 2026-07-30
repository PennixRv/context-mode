export type CheckpointState = "pending" | "confirmed" | "claimed" | "expired" | "invalid";

export type CompactionTrigger = "manual" | "auto";

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
  created_at: string;
  confirmed_at: string | null;
  claimed_at: string | null;
  expires_at: string;
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
