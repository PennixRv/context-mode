import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(__dirname, "..", "..");
const validatorPath = resolve(
  repositoryRoot,
  "scripts",
  "validate-fork-release-tag.mjs",
);

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), "context-mode-release-ref-"));
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "Release Workflow Test"]);
  git(repository, ["config", "user.email", "release-workflow@example.test"]);
  writeFileSync(join(repository, "fixture.txt"), "release fixture\n");
  git(repository, ["add", "fixture.txt"]);
  git(repository, ["commit", "--quiet", "-m", "initial fixture commit"]);
  return repository;
}

function runValidator(repository: string, tagName: string) {
  return spawnSync(process.execPath, [validatorPath, tagName], {
    cwd: repository,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("validate-fork-release-tag", () => {
  test("accepts an annotated tag reachable from origin/devel", () => {
    const repository = createRepository();
    try {
      git(repository, ["update-ref", "refs/remotes/origin/devel", "HEAD"]);
      git(repository, ["tag", "--annotate", "--message", "release", "v1.2.3"]);

      const result = runValidator(repository, "v1.2.3");

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("origin/devel");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  test("rejects an annotated tag outside origin/devel", () => {
    const repository = createRepository();
    try {
      const develCommit = git(repository, ["rev-parse", "HEAD"]);
      git(repository, ["update-ref", "refs/remotes/origin/devel", develCommit]);
      const tree = git(repository, ["rev-parse", "HEAD^{tree}"]);
      const unrelatedCommit = git(repository, [
        "commit-tree",
        tree,
        "-m",
        "unrelated fixture commit",
      ]);
      git(repository, [
        "tag",
        "--annotate",
        "--message",
        "release",
        "v1.2.4",
        unrelatedCommit,
      ]);

      const result = runValidator(repository, "v1.2.4");

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "not reachable from fork release ref origin/devel",
      );
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  test("rejects a tag when origin/devel is missing", () => {
    const repository = createRepository();
    try {
      git(repository, ["tag", "--annotate", "--message", "release", "v1.2.5"]);

      const result = runValidator(repository, "v1.2.5");

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("origin/devel");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
