import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function canonicalizeTempDirectory(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return resolve(directory);
  }
}

/**
 * Resolve the host OS temp directory without trusting a caller-supplied
 * TMPDIR. Sandboxed children inherit a private TMPDIR, but host-side fixtures
 * that must remain indexable need a path outside that hidden sandbox tree.
 */
export function resolveHostTempDirectory(): string {
  if (process.platform === "win32") {
    return canonicalizeTempDirectory(process.env.TEMP ?? process.env.TMP ?? tmpdir());
  }

  const environment = { ...process.env };
  delete environment.TMPDIR;

  try {
    const result = execFileSync(
      process.platform === "darwin" ? "getconf" : "mktemp",
      process.platform === "darwin" ? ["DARWIN_USER_TEMP_DIR"] : ["-u", "-d"],
      { env: environment, encoding: "utf-8" },
    ).trim();
    const directory = process.platform === "darwin" ? result : resolve(result, "..");
    if (directory && directory !== process.cwd()) return canonicalizeTempDirectory(directory);
  } catch {
    // Fall through to the conventional POSIX temp directory.
  }

  return canonicalizeTempDirectory("/tmp");
}

export const HOST_TEMP_DIRECTORY = resolveHostTempDirectory();
