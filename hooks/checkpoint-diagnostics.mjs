import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const DIAGNOSTIC_PHASE = "compact_session_start";
const DIAGNOSTIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DIAGNOSTIC_FILE_SUFFIX = ".sessionstart-diagnostics.jsonl";
const DIAGNOSTIC_LOCK_RETRY_COUNT = 256;
const DIAGNOSTIC_LOCK_RETRY_MS = 8;
const DIAGNOSTIC_LOCK_STALE_MS = 60_000;
const CODE_OUTCOME = {
  DELIVERED: "delivered",
  EMPTY_NO_CONFIRMED_CHECKPOINT: "expected_empty",
  DEPENDENCY_UNAVAILABLE: "failed",
  CHECKPOINT_DB_UNAVAILABLE: "failed",
  PAYLOAD_INVALID: "failed",
  PROJECTION_FAILED: "failed",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeRealpath(path) {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}

function gitOutput(projectRoot, args) {
  try {
    return execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_000,
    }).replace(/[\r\n]+$/, "");
  } catch {
    return null;
  }
}

function resolvePathFromGit(projectRoot, path) {
  return safeRealpath(isAbsolute(path) ? path : resolve(projectRoot, path));
}

function diagnosticPath(configDir, projectHash, worktreeHash) {
  return join(resolve(configDir), "context-mode", "checkpoints", `${projectHash}--${worktreeHash}${DIAGNOSTIC_FILE_SUFFIX}`);
}

/**
 * This helper intentionally stands outside checkpoint.bundle.mjs so the hook
 * can still record a fixed dependency failure when that bundle cannot load.
 */
export function resolveCheckpointDiagnosticIdentity(input, configDir) {
  const cwd = nonEmptyString(input?.cwd);
  const resolvedConfigDir = nonEmptyString(configDir);
  if (!cwd || !resolvedConfigDir) return null;

  const inputProjectRoot = safeRealpath(cwd);
  const gitProjectRoot = gitOutput(inputProjectRoot, ["rev-parse", "--show-toplevel"]);
  const canonicalProjectRoot = gitProjectRoot ? safeRealpath(gitProjectRoot) : inputProjectRoot;

  let worktreeIdentity = canonicalProjectRoot;
  if (gitProjectRoot) {
    const commonDir = gitOutput(canonicalProjectRoot, ["rev-parse", "--git-common-dir"]);
    const gitDir = gitOutput(canonicalProjectRoot, ["rev-parse", "--git-dir"]);
    if (commonDir && gitDir) {
      worktreeIdentity = `${resolvePathFromGit(canonicalProjectRoot, commonDir)}\0${resolvePathFromGit(canonicalProjectRoot, gitDir)}`;
    }
  }

  const projectHash = sha256(canonicalProjectRoot);
  const worktreeHash = sha256(worktreeIdentity);
  return {
    projectHash,
    worktreeHash,
    filePath: diagnosticPath(resolvedConfigDir, projectHash, worktreeHash),
  };
}

function isDiagnosticRow(value, projectHash, worktreeHash) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value;
  const keys = Object.keys(row);
  if (keys.length !== 6 || keys.some((key) => ![
    "phase",
    "outcome",
    "code",
    "created_at",
    "project_sha256",
    "worktree_sha256",
  ].includes(key))) return false;
  if (row.phase !== DIAGNOSTIC_PHASE || row.project_sha256 !== projectHash || row.worktree_sha256 !== worktreeHash) return false;
  if (typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return false;
  return typeof row.code === "string" && CODE_OUTCOME[row.code] === row.outcome;
}

function readRetainedRows(filePath, projectHash, worktreeHash, cutoffMs) {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          const row = JSON.parse(line);
          if (!isDiagnosticRow(row, projectHash, worktreeHash)) return [];
          const createdAt = Date.parse(row.created_at);
          return createdAt >= cutoffMs ? [row] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isRunningProcess(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function shouldReclaimDiagnosticLock(lockPath) {
  try {
    const ownerProcessId = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isSafeInteger(ownerProcessId) && ownerProcessId > 0) {
      return !isRunningProcess(ownerProcessId);
    }
    return Date.now() - statSync(lockPath).mtimeMs > DIAGNOSTIC_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireDiagnosticLock(lockPath) {
  for (let attempt = 0; attempt < DIAGNOSTIC_LOCK_RETRY_COUNT; attempt++) {
    try {
      const descriptor = openSync(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      try {
        writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      } finally {
        closeSync(descriptor);
      }
      return true;
    } catch {
      try {
        if (shouldReclaimDiagnosticLock(lockPath)) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // The lock changed between attempts; retry within the bounded budget.
      }
      pause(DIAGNOSTIC_LOCK_RETRY_MS);
    }
  }
  return false;
}

export function recordCheckpointSessionStartDiagnostic(input, configDir, result, options = {}) {
  try {
    const identity = resolveCheckpointDiagnosticIdentity(input, configDir);
    if (!identity || !result || typeof result !== "object") return false;
    const code = result.code;
    if (typeof code !== "string" || CODE_OUTCOME[code] !== result.outcome) return false;

    const now = options.now instanceof Date ? options.now : new Date();
    const createdAt = now.toISOString();
    const nowMs = now.getTime();
    mkdirSync(dirname(identity.filePath), { recursive: true });
    const lockPath = `${identity.filePath}.lock`;
    if (!acquireDiagnosticLock(lockPath)) return false;
    try {
      const rows = readRetainedRows(
        identity.filePath,
        identity.projectHash,
        identity.worktreeHash,
        nowMs - DIAGNOSTIC_RETENTION_MS,
      );
      rows.push({
        phase: DIAGNOSTIC_PHASE,
        outcome: result.outcome,
        code,
        created_at: createdAt,
        project_sha256: identity.projectHash,
        worktree_sha256: identity.worktreeHash,
      });

      const temporaryPath = `${identity.filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporaryPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        chmodSync(temporaryPath, 0o600);
        renameSync(temporaryPath, identity.filePath);
      } finally {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // The temporary file was renamed or is unavailable.
        }
      }
      return true;
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        // The lock may have been reclaimed after a process interruption.
      }
    }
  } catch {
    return false;
  }
}
