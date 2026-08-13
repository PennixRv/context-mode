import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export type CodexCliWorkingDirectorySource = "CODEX_HOME" | "HOME" | "homedir";

export interface CodexCliWorkingDirectory {
  cwd: string;
  source: CodexCliWorkingDirectorySource;
}

function absoluteDirectoryCandidate(value: string | undefined, home: string): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (candidate === "~") return home;
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    return resolve(home, candidate.slice(2));
  }
  return isAbsolute(candidate) ? candidate : null;
}

function isUsableDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a stable cwd for nested Codex CLI probes without consulting
 * process.cwd(), which may refer to a deleted Plugin backup directory.
 */
export function resolveCodexCliWorkingDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  systemHome: string = homedir(),
): CodexCliWorkingDirectory | null {
  const candidates: Array<[CodexCliWorkingDirectorySource, string | null]> = [
    ["CODEX_HOME", absoluteDirectoryCandidate(environment.CODEX_HOME, systemHome)],
    ["HOME", absoluteDirectoryCandidate(environment.HOME, systemHome)],
    ["homedir", absoluteDirectoryCandidate(systemHome, systemHome)],
  ];
  const seen = new Set<string>();
  for (const [source, candidate] of candidates) {
    if (!candidate) continue;
    const normalized = resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (isUsableDirectory(normalized)) return { cwd: normalized, source };
  }
  return null;
}

export function resolveCodexConfigDir(): string {
  const envVal = process.env.CODEX_HOME;
  if (envVal) {
    if (envVal.startsWith("~")) {
      return resolve(homedir(), envVal.replace(/^~[/\\]?/, ""));
    }
    return resolve(envVal);
  }
  return resolve(homedir(), ".codex");
}
