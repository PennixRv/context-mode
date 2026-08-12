import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const EXECUTION_MODE_ENV = "CONTEXT_MODE_EXECUTION_MODE";
export const RESTRICTED_PROJECT_ROOT_ENV = "CONTEXT_MODE_RESTRICTED_PROJECT_ROOT";

export type ExecutionMode = "compatibility" | "restricted";
export type ExecutionAuthoritySource = "server-default" | "server-environment";
export type ProjectRootAuthoritySource =
  | "compatibility-resolver"
  | "restricted-server-environment";
export type ExecutionPolicyErrorCode =
  | "CTX_EXEC_POLICY_INVALID"
  | "CTX_EXEC_PROJECT_ROOT_INVALID"
  | "CTX_EXEC_ISOLATION_UNAVAILABLE"
  | "CTX_EXEC_BACKGROUND_FORBIDDEN"
  | "CTX_EXEC_PATH_OUTSIDE_PROJECT"
  | "CTX_EXEC_PATH_INVALID"
  | "CTX_EXEC_GLOBAL_QUERY_FORBIDDEN"
  | "CTX_EXEC_PERSISTENCE_FORBIDDEN"
  | "CTX_EXEC_LANGUAGE_UNSUPPORTED";

export interface BubblewrapIsolation {
  kind: "bubblewrap";
  executable: string;
  projectRoot: string;
}

export interface ExecutionPolicyDecision {
  ok: boolean;
  mode: ExecutionMode;
  authoritySource: ExecutionAuthoritySource;
  projectRootSource: ProjectRootAuthoritySource;
  projectRoot: string;
  isolation: BubblewrapIsolation | null;
  persistence: "persistent" | "request-only";
  network: "allowed" | "disabled";
  filesystem: "read-write" | "project-read-only";
  background: "allowed" | "forbidden";
  errorCode: ExecutionPolicyErrorCode | null;
}

export interface RestrictedInvocation {
  language?: string;
  background?: boolean;
  cwd?: string;
  filePath?: string;
  queryScope?: "batch" | "global";
}

export interface RestrictedInvocationResult {
  ok: boolean;
  errorCode: ExecutionPolicyErrorCode | null;
  cwd: string | null;
  filePath: string | null;
}

interface ResolveExecutionPolicyOptions {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  probeIsolation?: (projectRoot: string) => BubblewrapIsolation | null;
}

const RESTRICTED_LANGUAGES = new Set(["shell", "javascript", "typescript", "python"]);

export function readExecutionMode(
  env: NodeJS.ProcessEnv = process.env,
): { mode: ExecutionMode | "invalid"; authoritySource: ExecutionAuthoritySource } {
  const configured = env[EXECUTION_MODE_ENV]?.trim().toLowerCase();
  if (configured === undefined || configured === "") {
    return { mode: "compatibility", authoritySource: "server-default" };
  }
  if (configured === "compatibility" || configured === "restricted") {
    return { mode: configured, authoritySource: "server-environment" };
  }
  return { mode: "invalid", authoritySource: "server-environment" };
}

function canonicalDirectory(path: string): string | null {
  try {
    const canonical = realpathSync(path);
    return statSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}

function findExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? "";
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const candidate = resolve(entry, name);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue to the next fixed PATH entry.
    }
  }
  return null;
}

/** Add one host path to a bubblewrap profile without dereferencing merged-/usr links. */
export function appendBubblewrapReadonlyPath(args: string[], hostPath: string): void {
  if (!existsSync(hostPath)) return;
  try {
    if (lstatSync(hostPath).isSymbolicLink()) {
      args.push("--symlink", readlinkSync(hostPath), hostPath);
      return;
    }
  } catch {
    return;
  }
  args.push("--ro-bind", hostPath, hostPath);
}

export function probeBubblewrapIsolation(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): BubblewrapIsolation | null {
  if (process.platform !== "linux") return null;
  const executable = findExecutable("bwrap", env);
  if (!executable) return null;

  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
  ];
  for (const systemPath of ["/usr", "/bin", "/sbin", "/lib", "/lib64"]) {
    appendBubblewrapReadonlyPath(args, systemPath);
  }
  args.push(
    "--proc", "/proc",
    "--dir", "/tmp",
    "--chmod", "0555", "/tmp",
    "--ro-bind", projectRoot, projectRoot,
    "--chdir", projectRoot,
    "--clearenv",
    "--setenv", "PATH", "/usr/bin:/bin",
    "/usr/bin/true",
  );
  const probe = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3_000,
  });
  if (probe.status !== 0 || probe.error) return null;
  return { kind: "bubblewrap", executable, projectRoot };
}

function deniedDecision(
  mode: ExecutionMode,
  authoritySource: ExecutionAuthoritySource,
  projectRoot: string,
  errorCode: ExecutionPolicyErrorCode,
): ExecutionPolicyDecision {
  return {
    ok: false,
    mode,
    authoritySource,
    projectRootSource: "restricted-server-environment",
    projectRoot,
    isolation: null,
    persistence: mode === "restricted" ? "request-only" : "persistent",
    network: mode === "restricted" ? "disabled" : "allowed",
    filesystem: mode === "restricted" ? "project-read-only" : "read-write",
    background: mode === "restricted" ? "forbidden" : "allowed",
    errorCode,
  };
}

export function resolveExecutionPolicy(
  options: ResolveExecutionPolicyOptions,
): ExecutionPolicyDecision {
  const env = options.env ?? process.env;
  const configured = readExecutionMode(env);
  const fallbackRoot = resolve(options.projectRoot);

  if (configured.mode === "invalid") {
    return deniedDecision(
      "restricted",
      configured.authoritySource,
      fallbackRoot,
      "CTX_EXEC_POLICY_INVALID",
    );
  }

  if (configured.mode === "compatibility") {
    return {
      ok: true,
      mode: "compatibility",
      authoritySource: configured.authoritySource,
      projectRootSource: "compatibility-resolver",
      projectRoot: canonicalDirectory(options.projectRoot) ?? fallbackRoot,
      isolation: null,
      persistence: "persistent",
      network: "allowed",
      filesystem: "read-write",
      background: "allowed",
      errorCode: null,
    };
  }

  if (!isAbsolute(options.projectRoot)) {
    return deniedDecision(
      "restricted",
      configured.authoritySource,
      fallbackRoot,
      "CTX_EXEC_PROJECT_ROOT_INVALID",
    );
  }
  const projectRoot = canonicalDirectory(options.projectRoot);
  if (!projectRoot) {
    return deniedDecision(
      "restricted",
      configured.authoritySource,
      fallbackRoot,
      "CTX_EXEC_PROJECT_ROOT_INVALID",
    );
  }
  if ((options.platform ?? process.platform) !== "linux") {
    return deniedDecision(
      "restricted",
      configured.authoritySource,
      projectRoot,
      "CTX_EXEC_ISOLATION_UNAVAILABLE",
    );
  }

  const isolation = (options.probeIsolation ?? ((root) => probeBubblewrapIsolation(root, env)))(projectRoot);
  if (!isolation) {
    return deniedDecision(
      "restricted",
      configured.authoritySource,
      projectRoot,
      "CTX_EXEC_ISOLATION_UNAVAILABLE",
    );
  }

  return {
    ok: true,
    mode: "restricted",
    authoritySource: configured.authoritySource,
    projectRootSource: "restricted-server-environment",
    projectRoot,
    isolation,
    persistence: "request-only",
    network: "disabled",
    filesystem: "project-read-only",
    background: "forbidden",
    errorCode: null,
  };
}

function insideProject(projectRoot: string, candidate: string): boolean {
  const rel = relative(projectRoot, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function nearestExistingParent(path: string): string | null {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  try {
    return realpathSync(current);
  } catch {
    return null;
  }
}

export function resolveProjectContainedPath(
  projectRoot: string,
  candidate: string,
  requireExisting: boolean,
): { ok: boolean; path: string | null; errorCode: ExecutionPolicyErrorCode | null } {
  const lexical = resolve(projectRoot, candidate);
  if (!insideProject(projectRoot, lexical)) {
    return { ok: false, path: null, errorCode: "CTX_EXEC_PATH_OUTSIDE_PROJECT" };
  }

  if (existsSync(lexical)) {
    try {
      const canonical = realpathSync(lexical);
      return insideProject(projectRoot, canonical)
        ? { ok: true, path: canonical, errorCode: null }
        : { ok: false, path: null, errorCode: "CTX_EXEC_PATH_OUTSIDE_PROJECT" };
    } catch {
      return { ok: false, path: null, errorCode: "CTX_EXEC_PATH_INVALID" };
    }
  }

  if (requireExisting) {
    return { ok: false, path: null, errorCode: "CTX_EXEC_PATH_INVALID" };
  }
  const parent = nearestExistingParent(lexical);
  if (!parent || !insideProject(projectRoot, parent)) {
    return { ok: false, path: null, errorCode: "CTX_EXEC_PATH_OUTSIDE_PROJECT" };
  }
  return { ok: true, path: lexical, errorCode: null };
}

export function validateRestrictedInvocation(
  decision: ExecutionPolicyDecision,
  invocation: RestrictedInvocation,
): RestrictedInvocationResult {
  if (!decision.ok) {
    return { ok: false, errorCode: decision.errorCode, cwd: null, filePath: null };
  }
  if (decision.mode === "compatibility") {
    return {
      ok: true,
      errorCode: null,
      cwd: invocation.cwd ? resolve(decision.projectRoot, invocation.cwd) : decision.projectRoot,
      filePath: invocation.filePath ? resolve(decision.projectRoot, invocation.filePath) : null,
    };
  }
  if (invocation.language && !RESTRICTED_LANGUAGES.has(invocation.language)) {
    return { ok: false, errorCode: "CTX_EXEC_LANGUAGE_UNSUPPORTED", cwd: null, filePath: null };
  }
  if (invocation.background) {
    return { ok: false, errorCode: "CTX_EXEC_BACKGROUND_FORBIDDEN", cwd: null, filePath: null };
  }
  if (invocation.queryScope === "global") {
    return { ok: false, errorCode: "CTX_EXEC_GLOBAL_QUERY_FORBIDDEN", cwd: null, filePath: null };
  }

  const cwd = invocation.cwd
    ? resolveProjectContainedPath(decision.projectRoot, invocation.cwd, true)
    : { ok: true, path: decision.projectRoot, errorCode: null };
  if (!cwd.ok) {
    return { ok: false, errorCode: cwd.errorCode, cwd: null, filePath: null };
  }
  const filePath = invocation.filePath
    ? resolveProjectContainedPath(decision.projectRoot, invocation.filePath, true)
    : { ok: true, path: null, errorCode: null };
  if (!filePath.ok) {
    return { ok: false, errorCode: filePath.errorCode, cwd: null, filePath: null };
  }

  return { ok: true, errorCode: null, cwd: cwd.path, filePath: filePath.path };
}

export function formatExecutionPolicyError(code: ExecutionPolicyErrorCode): string {
  const messages: Record<ExecutionPolicyErrorCode, string> = {
    CTX_EXEC_POLICY_INVALID: "server execution policy is invalid",
    CTX_EXEC_PROJECT_ROOT_INVALID: "the project root cannot be verified",
    CTX_EXEC_ISOLATION_UNAVAILABLE: "required process isolation is unavailable",
    CTX_EXEC_BACKGROUND_FORBIDDEN: "background processes are forbidden",
    CTX_EXEC_PATH_OUTSIDE_PROJECT: "the requested path is outside the project boundary",
    CTX_EXEC_PATH_INVALID: "the requested path cannot be verified",
    CTX_EXEC_GLOBAL_QUERY_FORBIDDEN: "global persistent queries are forbidden",
    CTX_EXEC_PERSISTENCE_FORBIDDEN: "persistent indexing cannot be enabled",
    CTX_EXEC_LANGUAGE_UNSUPPORTED: "the language is not supported by restricted execution",
  };
  return `Restricted execution denied [${code}]: ${messages[code]}.`;
}
