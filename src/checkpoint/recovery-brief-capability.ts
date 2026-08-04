/**
 * Codex-only RecoveryBrief identity capability.
 *
 * The hook and MCP server share this contract through the generated hook
 * bundle. The capability is deliberately opaque: all project/session meaning
 * stays in the private record and is never returned by a tool or diagnostic.
 */
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const RECOVERY_BRIEF_CAPABILITY_FIELD = "__context_mode_recovery_brief_capability";
export const CODEX_RECOVERY_BRIEF_TOOL_NAMES = [
  "mcp__context_mode__ctx_recovery_brief_status",
  "mcp__context_mode__ctx_recovery_brief_update",
] as const;
export const CODEX_RECOVERY_BRIEF_TOOL_MATCHER =
  "^(mcp__context_mode__ctx_recovery_brief_status|mcp__context_mode__ctx_recovery_brief_update)$";
export const RECOVERY_BRIEF_CAPABILITY_TTL_MS = 30_000;

const CAPABILITY_SCHEMA_VERSION = 1;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID_MAX_LENGTH = 512;
const RECORD_FIELDS = [
  "schema_version",
  "token",
  "canonical_project_root",
  "project_root_sha256",
  "session_id",
  "created_at",
  "expires_at",
] as const;

type CapabilityRecord = {
  schema_version: number;
  token: string;
  canonical_project_root: string;
  project_root_sha256: string;
  session_id: string;
  created_at: string;
  expires_at: string;
};

export type RecoveryBriefCapabilityIdentity = {
  projectDir: string;
  sessionId: string;
};

export type RecoveryBriefCapabilityReadiness = {
  ready: boolean;
  platform: string;
};

type CapabilityIo = {
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  storageDir?: string;
  canonicalizeProjectRoot?: (cwd: string) => string;
  expectedProjectRoot?: string;
  expectedSessionId?: string;
};

function currentUid(): number | undefined {
  try {
    return typeof process.getuid === "function" ? process.getuid() : undefined;
  } catch {
    return undefined;
  }
}

function isPrivateMode(mode: number, expected: number): boolean {
  // Node reports the file type in the upper bits. Only owner read/write for a
  // record and owner read/write/execute for its directory are permitted.
  return (mode & 0o777) === expected && (mode & 0o077) === 0;
}

function isOwnedByCurrentUser(stat: { uid?: number }): boolean {
  const uid = currentUid();
  return uid === undefined || stat.uid === undefined || stat.uid === uid;
}

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || !isPrivateMode(stat.mode, 0o700) || !isOwnedByCurrentUser(stat)) {
    throw new Error("unsafe capability storage");
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath === ""
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

/**
 * Validate each existing component before mkdirSync can traverse it. A private
 * leaf beneath a symlinked CONTEXT_MODE_DIR/CODEX_HOME ancestor is still an
 * attacker-controlled destination, so leaf-only lstat validation is not
 * sufficient here.
 */
function assertNoSymlinkedDirectoryAncestors(path: string): void {
  const absolutePath = resolve(path);
  const parsed = parse(absolutePath);
  let currentPath = parsed.root;
  const segments = absolutePath.slice(parsed.root.length).split(sep).filter(Boolean);

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    let stat;
    try {
      stat = lstatSync(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("unsafe capability storage ancestry");
    }
  }
}

function assertPrivateCapabilityStorage(path: string): string {
  const rawPath = resolve(path);
  assertNoSymlinkedDirectoryAncestors(rawPath);
  assertPrivateDirectory(rawPath);
  const canonicalPath = realpathSync(rawPath);
  // The two containment checks make an alias escape impossible even if a
  // platform normalizes the raw spelling differently from realpath().
  if (!isPathInside(rawPath, canonicalPath) || !isPathInside(canonicalPath, rawPath)) {
    throw new Error("unsafe capability storage ancestry");
  }
  return canonicalPath;
}

function assertPrivateRecord(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || !isPrivateMode(stat.mode, 0o600) || !isOwnedByCurrentUser(stat)) {
    throw new Error("unsafe capability record");
  }
}

function defaultCapabilityStorageDir(): string {
  const override = process.env.CONTEXT_MODE_DIR?.trim();
  if (override) {
    if (!isAbsolute(override)) throw new Error("invalid capability storage override");
    return join(resolve(override), "recovery-brief-capabilities");
  }
  const codexHome = process.env.CODEX_HOME?.trim();
  const configDir = codexHome
    ? (codexHome.startsWith("~")
      ? resolve(homedir(), codexHome.replace(/^~[/\\]?/, ""))
      : resolve(codexHome))
    : join(homedir(), ".codex");
  return join(configDir, "context-mode", "recovery-brief-capabilities");
}

function capabilityStorageDir(io: CapabilityIo = {}): string {
  return resolve(io.storageDir ?? defaultCapabilityStorageDir());
}

function ensureCapabilityStorageDir(io: CapabilityIo = {}): string {
  const dir = capabilityStorageDir(io);
  try {
    assertNoSymlinkedDirectoryAncestors(dir);
    const existed = existsSync(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // A newly-created directory may be narrowed by umask. Existing directories
    // are never repaired here: unsafe permissions fail closed.
    if (!existed) chmodSync(dir, 0o700);
    return assertPrivateCapabilityStorage(dir);
  } catch {
    throw new Error("capability storage unavailable");
  }
}

function defaultCanonicalizeProjectRoot(cwd: string): string {
  if (typeof cwd !== "string" || cwd.trim().length === 0 || !isAbsolute(cwd)) {
    throw new Error("invalid hook cwd");
  }
  const canonical = realpathSync(cwd);
  const stat = lstatSync(canonical);
  if (!stat.isDirectory()) throw new Error("hook cwd is not a directory");
  return canonical;
}

function projectRootSha256(canonicalProjectRoot: string): string {
  return createHash("sha256").update(canonicalProjectRoot).digest("hex");
}

function randomToken(io: CapabilityIo): string {
  const bytes = (io.randomBytes ?? nodeRandomBytes)(TOKEN_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== TOKEN_BYTES) {
    throw new Error("invalid capability token source");
  }
  const token = bytes.toString("base64url");
  if (!TOKEN_PATTERN.test(token)) throw new Error("invalid capability token");
  return token;
}

function writeCapabilityRecord(path: string, record: CapabilityRecord): void {
  writeFileSync(path, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  assertPrivateRecord(path);
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= SESSION_ID_MAX_LENGTH
    && !/[\u0000\r\n]/.test(value);
}

function parseRecord(value: unknown): CapabilityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== RECORD_FIELDS.length || RECORD_FIELDS.some((field) => !keys.includes(field))) return null;
  if (record.schema_version !== CAPABILITY_SCHEMA_VERSION
    || typeof record.token !== "string"
    || !TOKEN_PATTERN.test(record.token)
    || typeof record.canonical_project_root !== "string"
    || !isAbsolute(record.canonical_project_root)
    || typeof record.project_root_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.project_root_sha256)
    || !validSessionId(record.session_id)
    || typeof record.created_at !== "string"
    || typeof record.expires_at !== "string") {
    return null;
  }
  if (!Number.isFinite(Date.parse(record.created_at)) || !Number.isFinite(Date.parse(record.expires_at))) return null;
  return record as CapabilityRecord;
}

function readPrivateRecord(path: string): unknown {
  assertPrivateRecord(path);
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    const mode = stat.mode & 0o777;
    if (!stat.isFile() || !isPrivateMode(mode, 0o600) || !isOwnedByCurrentUser(stat)) {
      throw new Error("unsafe capability record");
    }
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

function cleanupExpiredCapabilities(dir: string, now: number): void {
  try {
    for (const name of readdirSync(dir)) {
      if (!TOKEN_PATTERN.test(name)) continue;
      const path = join(dir, name);
      try {
        assertPrivateRecord(path);
        const record = parseRecord(JSON.parse(readFileSync(path, "utf8")));
        if (record && Date.parse(record.expires_at) <= now) unlinkSync(path);
      } catch {
        // Cleanup is best effort and never changes the normal call result.
      }
    }
  } catch {
    // Cleanup is best effort and never changes the normal call result.
  }
}

/** Issue a private, short-lived capability for one exact Codex MCP call. */
export function issueRecoveryBriefCapability(
  input: { cwd?: unknown; sessionId?: unknown },
  io: CapabilityIo = {},
): string | null {
  try {
    if (!validSessionId(input.sessionId)) return null;
    const canonicalize = io.canonicalizeProjectRoot ?? defaultCanonicalizeProjectRoot;
    const canonicalProjectRoot = canonicalize(input.cwd as string);
    if (!isAbsolute(canonicalProjectRoot)) return null;
    const now = io.now?.() ?? Date.now();
    if (!Number.isFinite(now)) return null;
    const token = randomToken(io);
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + RECOVERY_BRIEF_CAPABILITY_TTL_MS).toISOString();
    const record: CapabilityRecord = {
      schema_version: CAPABILITY_SCHEMA_VERSION,
      token,
      canonical_project_root: canonicalProjectRoot,
      project_root_sha256: projectRootSha256(canonicalProjectRoot),
      session_id: input.sessionId,
      created_at: createdAt,
      expires_at: expiresAt,
    };
    const dir = ensureCapabilityStorageDir(io);
    cleanupExpiredCapabilities(dir, now);
    const path = join(dir, token);
    writeCapabilityRecord(path, record);
    return token;
  } catch {
    return null;
  }
}

/**
 * Atomically consume a capability. The pending filename is renamed before
 * parsing, so a replay or concurrent consumer cannot reach provider code.
 */
export function consumeRecoveryBriefCapability(
  capability: unknown,
  io: CapabilityIo = {},
): RecoveryBriefCapabilityIdentity | null {
  if (typeof capability !== "string" || !TOKEN_PATTERN.test(capability)) return null;
  let consumedPath: string | undefined;
  try {
    const dir = assertPrivateCapabilityStorage(capabilityStorageDir(io));
    const pendingPath = join(dir, capability);
    assertPrivateRecord(pendingPath);
    const nonce = randomToken(io).slice(0, 16);
    consumedPath = join(dir, `${capability}.consumed-${nonce}`);
    renameSync(pendingPath, consumedPath);
    const record = parseRecord(readPrivateRecord(consumedPath));
    if (!record || record.token !== capability) return null;
    const now = io.now?.() ?? Date.now();
    const createdAt = Date.parse(record.created_at);
    const expiresAt = Date.parse(record.expires_at);
    if (!Number.isFinite(now)
      || !Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || createdAt > now
      || expiresAt <= now
      || expiresAt <= createdAt
      || expiresAt - createdAt > RECOVERY_BRIEF_CAPABILITY_TTL_MS) return null;
    const canonicalRoot = realpathSync(record.canonical_project_root);
    if (canonicalRoot !== record.canonical_project_root
      || !isAbsolute(canonicalRoot)
      || projectRootSha256(canonicalRoot) !== record.project_root_sha256
      || !lstatSync(canonicalRoot).isDirectory()) return null;
    if (io.expectedSessionId !== undefined && record.session_id !== io.expectedSessionId) return null;
    if (io.expectedProjectRoot !== undefined) {
      const canonicalExpected = (io.canonicalizeProjectRoot ?? defaultCanonicalizeProjectRoot)(io.expectedProjectRoot);
      if (canonicalExpected !== canonicalRoot) return null;
    }
    return { projectDir: canonicalRoot, sessionId: record.session_id };
  } catch {
    return null;
  } finally {
    if (consumedPath) {
      try { unlinkSync(consumedPath); } catch { /* one-use cleanup is best effort */ }
    }
  }
}

/** Content-free readiness check used by Codex diagnostics. */
export function getRecoveryBriefCapabilityReadiness(io: CapabilityIo = {}): RecoveryBriefCapabilityReadiness {
  try {
    ensureCapabilityStorageDir(io);
    return { ready: true, platform: process.platform };
  } catch {
    return { ready: false, platform: process.platform };
  }
}

export function isCodexRecoveryBriefToolName(toolName: unknown): toolName is typeof CODEX_RECOVERY_BRIEF_TOOL_NAMES[number] {
  return typeof toolName === "string"
    && (toolName === CODEX_RECOVERY_BRIEF_TOOL_NAMES[0] || toolName === CODEX_RECOVERY_BRIEF_TOOL_NAMES[1]);
}
