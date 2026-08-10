import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Resolve the host OS temp directory without trusting a caller-supplied
 * TMPDIR. Sandboxed children inherit a private TMPDIR, but host-side fixtures
 * that must remain indexable need a path outside that hidden sandbox tree.
 */
export function resolveHostTempDirectory(): string {
  if (process.platform === "win32") {
    return process.env.TEMP ?? process.env.TMP ?? tmpdir();
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
    if (directory && directory !== process.cwd()) return directory;
  } catch {
    // Fall through to the conventional POSIX temp directory.
  }

  return "/tmp";
}

export const HOST_TEMP_DIRECTORY = resolveHostTempDirectory();
