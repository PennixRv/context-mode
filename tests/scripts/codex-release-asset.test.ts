import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const repositoryRoot = resolve(__dirname, "..", "..");
const builderPath = resolve(repositoryRoot, "scripts", "build-codex-marketplace-bundle.mjs");

function buildArchive(outputDirectory: string): string {
  const result = spawnSync(process.execPath, [builderPath, "--output-dir", outputDirectory], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).archive as string;
}

function buildArchiveWithPnpmSeparator(outputDirectory: string): string {
  const result = spawnSync(process.execPath, [builderPath, "--", "--output-dir", outputDirectory], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).archive as string;
}

describe("Codex offline marketplace release asset", () => {
  test("accepts the package-manager argument separator", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-separator-"));
    try {
      expect(existsSync(buildArchiveWithPnpmSeparator(outputDirectory))).toBe(true);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  test("uses a local wrapper and excludes source, tests, config, and native modules", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-asset-"));
    const extractionDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-extract-"));
    try {
      const archive = buildArchive(outputDirectory);
      execFileSync("tar", ["-xzf", archive, "-C", extractionDirectory]);

      const marketplace = JSON.parse(
        readFileSync(join(extractionDirectory, ".agents", "plugins", "marketplace.json"), "utf8"),
      );
      expect(marketplace.plugins[0].source).toEqual({
        source: "local",
        path: "./plugins/context-mode",
      });

      const payloadRoot = join(extractionDirectory, "plugins", "context-mode");
      expect(existsSync(join(payloadRoot, "fetch-worker.bundle.cjs"))).toBe(true);
      for (const forbidden of [".git", ".github", ".claude", "configs", "node_modules", "src", "tests", "build"]) {
        expect(existsSync(join(payloadRoot, forbidden)), forbidden).toBe(false);
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
      rmSync(extractionDirectory, { recursive: true, force: true });
    }
  });

  test("uses a portable USTAR archive with a normalized gzip header", () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-format-"));
    try {
      const archive = readFileSync(buildArchive(outputDirectory));
      const tar = gunzipSync(archive);

      expect(archive.subarray(4, 8).equals(Buffer.alloc(4))).toBe(true);
      expect(archive[9]).toBe(255);
      expect(tar.subarray(257, 263).toString("ascii")).toBe("ustar\0");
      expect(tar.subarray(263, 265).toString("ascii")).toBe("00");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  test("rebuilds byte-for-byte from the same inputs", () => {
    const firstDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-first-"));
    const secondDirectory = mkdtempSync(join(tmpdir(), "context-mode-release-second-"));
    try {
      const firstArchive = buildArchive(firstDirectory);
      const secondArchive = buildArchive(secondDirectory);
      expect(readFileSync(firstArchive).equals(readFileSync(secondArchive))).toBe(true);
    } finally {
      rmSync(firstDirectory, { recursive: true, force: true });
      rmSync(secondDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
