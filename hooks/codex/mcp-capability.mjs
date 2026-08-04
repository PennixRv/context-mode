/**
 * Codex session-local proof for native HTTP redirection.
 *
 * Codex PreToolUse does not expose the current model tool table. A bare,
 * owned ctx_execute event is therefore the only local evidence that a session
 * can receive a redirect to ctx_execute. The marker contains no tool input,
 * prompt, project, or provider data.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const CODEX_MCP_CAPABILITY_TTL_MS = 30_000;

const CAPABILITY_SCHEMA_VERSION = 1;
const SESSION_ID_MAX_LENGTH = 512;
const CAPABILITY_DIRECTORY_MODE = 0o700;
const CAPABILITY_RECORD_MODE = 0o600;
const CODEX_CTX_EXECUTE_TOOL_NAMES = new Set([
  "ctx_execute",
  "mcp__context_mode__ctx_execute",
  "mcp__plugin_context-mode_context-mode__ctx_execute",
]);

/** Exact Codex tool names owned by context-mode that prove ctx_execute exists. */
export function isCodexCtxExecuteToolName(toolName) {
  return typeof toolName === "string" && CODEX_CTX_EXECUTE_TOOL_NAMES.has(toolName);
}

function isValidSessionId(sessionId) {
  return typeof sessionId === "string"
    && sessionId.length > 0
    && sessionId.length <= SESSION_ID_MAX_LENGTH
    && !/[\u0000\r\n]/.test(sessionId);
}

function defaultCapabilityStorageDir() {
  const codexHome = process.env.CODEX_HOME?.trim();
  const configDir = codexHome
    ? (codexHome.startsWith("~")
      ? resolve(homedir(), codexHome.replace(/^~[/\\]?/, ""))
      : resolve(codexHome))
    : join(homedir(), ".codex");
  return join(configDir, "context-mode", "codex-mcp-capabilities");
}

function capabilityStorageDir(options = {}) {
  return resolve(options.storageDir ?? defaultCapabilityStorageDir());
}

function markerPathForSession(sessionId, options = {}) {
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  return join(capabilityStorageDir(options), sessionHash);
}

function currentUid() {
  try {
    return typeof process.getuid === "function" ? process.getuid() : undefined;
  } catch {
    return undefined;
  }
}

function hasPrivateMode(mode, expectedMode) {
  return (mode & 0o777) === expectedMode && (mode & 0o077) === 0;
}

function isOwnedByCurrentUser(stat) {
  const uid = currentUid();
  return uid === undefined || stat.uid === undefined || stat.uid === uid;
}

function assertNoSymlinkedDirectoryAncestors(path) {
  const absolutePath = resolve(path);
  const parsedPath = parse(absolutePath);
  let currentPath = parsedPath.root;
  const segments = absolutePath.slice(parsedPath.root.length).split(sep).filter(Boolean);

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    let stat;
    try {
      stat = lstatSync(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("unsafe capability storage ancestry");
    }
  }
}

function isPathInside(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath === ""
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

function assertPrivateCapabilityStorage(path) {
  const rawPath = resolve(path);
  assertNoSymlinkedDirectoryAncestors(rawPath);
  const stat = lstatSync(rawPath);
  if (!stat.isDirectory()
    || !hasPrivateMode(stat.mode, CAPABILITY_DIRECTORY_MODE)
    || !isOwnedByCurrentUser(stat)) {
    throw new Error("unsafe capability storage");
  }
  const canonicalPath = realpathSync(rawPath);
  if (!isPathInside(rawPath, canonicalPath) || !isPathInside(canonicalPath, rawPath)) {
    throw new Error("unsafe capability storage ancestry");
  }
  return canonicalPath;
}

function assertPrivateCapabilityRecord(path) {
  const stat = lstatSync(path);
  if (!stat.isFile()
    || !hasPrivateMode(stat.mode, CAPABILITY_RECORD_MODE)
    || !isOwnedByCurrentUser(stat)) {
    throw new Error("unsafe capability record");
  }
}

function ensureCapabilityStorageDir(options = {}) {
  const dir = capabilityStorageDir(options);
  assertNoSymlinkedDirectoryAncestors(dir);
  const existed = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: CAPABILITY_DIRECTORY_MODE });
  if (!existed) chmodSync(dir, CAPABILITY_DIRECTORY_MODE);
  return assertPrivateCapabilityStorage(dir);
}

function parseCapabilityRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  const keys = Object.keys(record);
  if (keys.length !== 3
    || !keys.includes("schema_version")
    || !keys.includes("created_at")
    || !keys.includes("expires_at")) return null;
  if (record.schema_version !== CAPABILITY_SCHEMA_VERSION
    || typeof record.created_at !== "number"
    || typeof record.expires_at !== "number"
    || !Number.isFinite(record.created_at)
    || !Number.isFinite(record.expires_at)
    || record.expires_at <= record.created_at
    || record.expires_at - record.created_at > CODEX_MCP_CAPABILITY_TTL_MS) return null;
  return record;
}

function removeMarker(path) {
  try {
    assertPrivateCapabilityRecord(path);
    unlinkSync(path);
  } catch {}
}

function writeCapabilityRecord(path, record) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(16).toString("hex")}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: CAPABILITY_RECORD_MODE,
    });
    assertPrivateCapabilityRecord(temporaryPath);
    renameSync(temporaryPath, path);
    assertPrivateCapabilityRecord(path);
  } finally {
    try { unlinkSync(temporaryPath); } catch {}
  }
}

function readPrivateCapabilityRecord(path) {
  assertPrivateCapabilityRecord(path);
  const descriptor = openSync(path, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()
      || !hasPrivateMode(stat.mode, CAPABILITY_RECORD_MODE)
      || !isOwnedByCurrentUser(stat)) {
      throw new Error("unsafe capability record");
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Persist a bounded proof after Codex reports its bare, owned ctx_execute tool.
 * Failure stays false so the adapter preserves the user's native command.
 */
export function recordCodexMcpCapability(sessionId, options = {}) {
  if (!isValidSessionId(sessionId)) return false;
  const now = options.now?.() ?? Date.now();
  if (!Number.isFinite(now)) return false;

  try {
    ensureCapabilityStorageDir(options);
    const markerPath = markerPathForSession(sessionId, options);
    writeCapabilityRecord(markerPath, {
      schema_version: CAPABILITY_SCHEMA_VERSION,
      created_at: now,
      expires_at: now + CODEX_MCP_CAPABILITY_TTL_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return whether this exact session has a current ctx_execute capability proof.
 * This does not inspect Codex configuration, provider state, transcripts, or
 * MCP sentinels. The caller combines it with process readiness separately.
 */
export function hasCodexMcpCapability(sessionId, options = {}) {
  if (!isValidSessionId(sessionId)) return false;
  const now = options.now?.() ?? Date.now();
  if (!Number.isFinite(now)) return false;

  try {
    const storageDir = assertPrivateCapabilityStorage(capabilityStorageDir(options));
    const markerPath = join(storageDir, createHash("sha256").update(sessionId).digest("hex"));
    const record = parseCapabilityRecord(readPrivateCapabilityRecord(markerPath));
    if (!record || record.created_at > now || record.expires_at <= now) {
      removeMarker(markerPath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getCodexMcpCapabilityMarkerPath(sessionId, options = {}) {
  if (!isValidSessionId(sessionId)) return null;
  return markerPathForSession(sessionId, options);
}
