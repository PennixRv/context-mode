import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashProjectDirCanonical,
  resolveContentStorePath,
} from "../../src/session/db.js";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) {
    const p = cleanup.pop();
    if (p && existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

function makeContentDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ctx-content-"));
  cleanup.push(d);
  return d;
}

describe("resolveContentStorePath", () => {
  it("fresh install — no legacy, no canonical: returns canonical path (file not yet created)", () => {
    const projectDir = "/tmp/Some/Project";
    const contentDir = makeContentDir();
    const path = resolveContentStorePath({ projectDir, contentDir });
    expect(path.startsWith(contentDir)).toBe(true);
    expect(path).toBe(join(contentDir, `${hashProjectDirCanonical(projectDir)}.db`));
    expect(path.endsWith(".db")).toBe(true);
    expect(existsSync(path)).toBe(false); // caller opens it via ContentStore
  });

  it.skipIf(process.platform === "linux")(
    "Mac/Win: casing variants of same projectDir resolve to identical content store path",
    () => {
      const contentDir = makeContentDir();
      const upper = resolveContentStorePath({ projectDir: "/Users/Mert/X", contentDir });
      const lower = resolveContentStorePath({ projectDir: "/users/mert/x", contentDir });
      expect(upper).toBe(lower);
    },
  );

  it("different projects stay in separate FTS5 files (no cross-migration)", () => {
    const contentDir = makeContentDir();
    const p1 = resolveContentStorePath({ projectDir: "/x/proj-1", contentDir });
    const p2 = resolveContentStorePath({ projectDir: "/x/proj-2", contentDir });
    expect(p1).not.toBe(p2);
  });

});
