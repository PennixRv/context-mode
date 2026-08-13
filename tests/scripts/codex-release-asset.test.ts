import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const repositoryRoot = resolve(__dirname, "..", "..");
const builderPath = resolve(repositoryRoot, "scripts", "build-codex-marketplace-bundle.mjs");
const verifierPath = resolve(repositoryRoot, "scripts", "verify-codex-release-asset.mjs");
const codexMcpEnvVars = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "CONTEXT_MODE_CODE_ECHO_MAX",
  "CONTEXT_MODE_COMMAND_ECHO_MAX",
  "CONTEXT_MODE_TITLE_PREVIEW_MAX",
  "CONTEXT_MODE_SEARCHABLE_TERMS_MAX",
  "CONTEXT_MODE_RESULT_PREVIEW_MAX",
];

function buildArchive(
  outputDirectory: string,
  options: {
    sourceRoot?: string;
    sourceDateEpoch?: string;
  } = {},
): string {
  const sourceRoot = options.sourceRoot ?? repositoryRoot;
  const result = spawnSync(process.execPath, [
    resolve(sourceRoot, "scripts", "build-codex-marketplace-bundle.mjs"),
    "--output-dir",
    outputDirectory,
  ], {
    cwd: sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.sourceDateEpoch === undefined
        ? {}
        : { SOURCE_DATE_EPOCH: options.sourceDateEpoch }),
    },
    timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).archive as string;
}

function copyReleaseSource(destinationDirectory: string): void {
  cpSync(repositoryRoot, destinationDirectory, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = relative(repositoryRoot, sourcePath).split(sep).join("/");
      return relativePath === "" || ![
        ".git",
        ".trellis",
        "node_modules",
        "release",
      ].some((excludedPath) => (
        relativePath === excludedPath || relativePath.startsWith(`${excludedPath}/`)
      ));
    },
  });
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

function extractArchive(archivePath: string, extractionDirectory: string): void {
  const temporaryDirectory = tmpdir();
  // GNU tar on Windows parses a C:\\ path as a remote archive specifier. Both
  // temporary paths are under the system temp root, so pass paths relative to it.
  execFileSync(
    "tar",
    [
      "-xzf",
      relative(temporaryDirectory, archivePath).split(sep).join("/"),
      "-C",
      relative(temporaryDirectory, extractionDirectory).split(sep).join("/"),
    ],
    { cwd: temporaryDirectory },
  );
}

describe("Codex offline marketplace release asset", () => {
  test("extracts npm package archives from relative paths for Windows tar", () => {
    const builderSource = readFileSync(builderPath, "utf8");
    const functionStart = builderSource.indexOf("function createPublishablePackageRoot");
    const functionEnd = builderSource.indexOf("function listFiles", functionStart);
    const functionSource = builderSource.slice(functionStart, functionEnd);

    // GNU tar on Windows interprets an absolute C:\\ path as a remote archive
    // specifier. The builder must execute in the temp root and pass only paths
    // relative to it when unpacking npm's generated archive.
    expect(functionSource).toContain("cwd: temporaryRoot");
    expect(functionSource).toContain("relative(temporaryRoot, join(packageDirectory, archives[0]))");
    expect(functionSource).toContain("relative(temporaryRoot, extractionRoot)");
  });

  test("stages downloaded assets before tar extraction on Windows", () => {
    const verifierSource = readFileSync(verifierPath, "utf8");

    // The downloaded release archive may live at C:\\... on Windows. The
    // verifier stages it beneath its temporary root, then passes tar a stable
    // relative path so GNU tar does not parse the drive prefix as a host name.
    expect(verifierSource).toContain('copyFileSync(archivePath, stagedArchivePath)');
    expect(verifierSource).toContain('["-xzf", "release-asset.tar.gz", "-C", "marketplace"]');
    expect(verifierSource).toContain("cwd: temporaryRoot");
  });

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
      extractArchive(archive, extractionDirectory);

      const marketplace = JSON.parse(
        readFileSync(join(extractionDirectory, ".agents", "plugins", "marketplace.json"), "utf8"),
      );
      expect(marketplace.plugins[0].source).toEqual({
        source: "local",
        path: "./plugins/context-mode",
      });

      const payloadRoot = join(extractionDirectory, "plugins", "context-mode");
      expect(existsSync(join(payloadRoot, "fetch-worker.bundle.cjs"))).toBe(true);
      expect(existsSync(join(payloadRoot, "hooks", "checkpoint-diagnostics.mjs"))).toBe(true);
      expect(existsSync(join(payloadRoot, "hooks", "recovery-brief-capability.bundle.mjs"))).toBe(true);

      const sourceMcpPath = join(repositoryRoot, ".codex-plugin", "mcp.json");
      const payloadMcpPath = join(payloadRoot, ".codex-plugin", "mcp.json");
      const sourceMcp = readFileSync(sourceMcpPath, "utf8");
      const payloadMcp = readFileSync(payloadMcpPath, "utf8");
      const payloadEntry = JSON.parse(payloadMcp).mcpServers["context-mode"];
      expect(payloadMcp).toBe(sourceMcp);
      expect(payloadEntry.env_vars).toEqual(codexMcpEnvVars);
      expect(payloadEntry.env).toEqual({ CONTEXT_MODE_PLATFORM: "codex" });

      const contentManifest = JSON.parse(
        readFileSync(join(extractionDirectory, "CONTENT-MANIFEST.json"), "utf8"),
      );
      const relativeMcpPath = "plugins/context-mode/.codex-plugin/mcp.json";
      const mcpManifestEntry = contentManifest.entries.find(
        (entry: { path: string }) => entry.path === relativeMcpPath,
      );
      expect(mcpManifestEntry).toEqual({
        path: relativeMcpPath,
        sha256: createHash("sha256").update(payloadMcp).digest("hex"),
        size: Buffer.byteLength(payloadMcp),
      });

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
      const builderSource = readFileSync(builderPath, "utf8");

      expect(archive.subarray(4, 8).equals(Buffer.alloc(4))).toBe(true);
      expect(archive[8]).toBe(0);
      expect(archive[9]).toBe(255);
      expect(tar.subarray(257, 263).toString("ascii")).toBe("ustar\0");
      expect(tar.subarray(263, 265).toString("ascii")).toBe("00");
      expect(builderSource).toContain("function createDeterministicGzip");
      expect(builderSource).not.toContain("gzipSync");
      expect(builderSource).not.toContain("SOURCE_DATE_EPOCH");
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

  test("rebuilds byte-for-byte across isolated source timestamps and environment", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-release-reproducible-"));
    const firstSourceRoot = join(temporaryRoot, "first-source");
    const secondSourceRoot = join(temporaryRoot, "second-source");
    const firstOutputDirectory = join(temporaryRoot, "first-output");
    const secondOutputDirectory = join(temporaryRoot, "second-output");
    try {
      copyReleaseSource(firstSourceRoot);
      copyReleaseSource(secondSourceRoot);
      for (const relativePath of [
        "package.json",
        "README.md",
        "server.bundle.mjs",
        "hooks/checkpoint.bundle.mjs",
        "hooks/recovery-brief-capability.bundle.mjs",
      ]) {
        utimesSync(join(firstSourceRoot, relativePath), new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));
        utimesSync(join(secondSourceRoot, relativePath), new Date("2040-01-01T00:00:00.000Z"), new Date("2040-01-01T00:00:00.000Z"));
      }

      const firstArchive = buildArchive(firstOutputDirectory, {
        sourceRoot: firstSourceRoot,
        sourceDateEpoch: "0",
      });
      const secondArchive = buildArchive(secondOutputDirectory, {
        sourceRoot: secondSourceRoot,
        sourceDateEpoch: "2208988800",
      });

      expect(readFileSync(firstArchive).equals(readFileSync(secondArchive))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
