import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _resetWorktreeSuffixCacheForTests,
  hashProjectDirCanonical,
  resolveSessionDbPath,
} from "../../src/session/db.js";

const cleanup: string[] = [];
afterEach(() => {
  _resetWorktreeSuffixCacheForTests();
  while (cleanup.length) {
    const p = cleanup.pop();
    if (p && existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

function makeRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), `ctx-${prefix}-`));
  cleanup.push(repo);
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repo, stdio: "ignore" });
  writeFileSync(join(repo, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repo, stdio: "ignore" });
  return repo;
}

function makeSessionsDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ctx-sess-"));
  cleanup.push(d);
  return d;
}

describe("hashProjectDirCanonical", () => {
  it.skipIf(process.platform === "linux")(
    "Mac/Win: casing variants of same path produce identical hash",
    () => {
      const upper = "/Users/Mert/proj";
      const lower = "/users/mert/proj";
      expect(hashProjectDirCanonical(upper)).toBe(hashProjectDirCanonical(lower));
    },
  );

  it("different paths still produce different hashes (no collapsing)", () => {
    expect(hashProjectDirCanonical("/x/proj-1")).not.toBe(hashProjectDirCanonical("/x/proj-2"));
  });

  it.skipIf(process.platform !== "linux")(
    "Linux: case-sensitive — variants produce different hashes",
    () => {
      expect(hashProjectDirCanonical("/Users/Mert/proj"))
        .not.toBe(hashProjectDirCanonical("/users/mert/proj"));
    },
  );

});

describe("resolveSessionDbPath", () => {
  it("fresh install — no legacy, no canonical: returns canonical path (file not yet created)", () => {
    const repo = makeRepo("fresh");
    const sessionsDir = makeSessionsDir();
    const path = resolveSessionDbPath({ projectDir: repo, sessionsDir });
    expect(path.startsWith(sessionsDir)).toBe(true);
    expect(path.endsWith(".db")).toBe(true);
    expect(existsSync(path)).toBe(false); // not created yet — caller opens it
  });

  it("different worktrees stay in separate DB files (no cross-migration)", () => {
    const wt1 = makeRepo("wt1");
    const wt2 = makeRepo("wt2");
    const sessionsDir = makeSessionsDir();

    const path1 = resolveSessionDbPath({ projectDir: wt1, sessionsDir });
    const path2 = resolveSessionDbPath({ projectDir: wt2, sessionsDir });

    expect(path1).not.toBe(path2);
  });

  it("idempotent — calling twice does not throw and returns same path", () => {
    const repo = makeRepo("idem");
    const sessionsDir = makeSessionsDir();
    const first = resolveSessionDbPath({ projectDir: repo, sessionsDir });
    _resetWorktreeSuffixCacheForTests();
    const second = resolveSessionDbPath({ projectDir: repo, sessionsDir });
    expect(second).toBe(first);
  });

});
