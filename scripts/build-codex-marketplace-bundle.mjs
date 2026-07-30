#!/usr/bin/env node
/**
 * Build a deterministic, unpackable Codex marketplace archive.
 *
 * The normal repository marketplace uses a git self-clone and must remain a
 * repository root. This builder creates the separate offline layout Codex
 * expects for `source: local`: a wrapper manifest plus plugins/context-mode.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = resolve(repositoryRoot, "release");
const packageJsonPath = resolve(repositoryRoot, "package.json");
const excludedPathSegments = new Set([
  ".git",
  ".github",
  ".claude",
  "node_modules",
  "src",
  "tests",
  "web",
]);
const forbiddenPathPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)credentials?(?:\.|$)/i,
  /(^|\/)secrets?(?:\.|$)/i,
  /(^|\/)auth(?:\.|$)/i,
  /\.node$/i,
];
const codexPayloadEntries = [
  ".codex-plugin",
  "hooks",
  "skills",
  "scripts/plugin-cache-integrity.mjs",
  "start.mjs",
  "server.bundle.mjs",
  "cli.bundle.mjs",
  "fetch-worker.bundle.cjs",
  "package.json",
  "README.md",
  "LICENSE",
];

function normalizePath(path) {
  return path.split(sep).join("/");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv) {
  const options = { outputDirectory: releaseDirectory };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--output-dir") {
      const outputDirectory = argv[++index];
      if (!outputDirectory) throw new Error("--output-dir requires a directory");
      options.outputDirectory = resolve(outputDirectory);
      continue;
    }
    if (value === "--help") {
      console.log("Usage: node scripts/build-codex-marketplace-bundle.mjs [--output-dir <directory>]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${value}`);
  }
  return options;
}

function readPackage() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

function assertBuildInputs(packageJson) {
  const requiredPaths = [
    "start.mjs",
    "server.bundle.mjs",
    "cli.bundle.mjs",
    "fetch-worker.bundle.cjs",
    ".codex-plugin/plugin.json",
    ".codex-plugin/mcp.json",
    ".codex-plugin/hooks.json",
    "hooks/checkpoint.bundle.mjs",
  ];
  for (const relativePath of requiredPaths) {
    const absolutePath = resolve(repositoryRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`release input is missing: ${relativePath}; run pnpm run build first`);
    }
  }
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    throw new Error("package.json files[] is required for release payload construction");
  }
}

function shouldExclude(relativePath) {
  const segments = normalizePath(relativePath).split("/");
  if (segments.some((segment) => excludedPathSegments.has(segment))) return true;
  return forbiddenPathPatterns.some((pattern) => pattern.test(normalizePath(relativePath)));
}

function copyEntry(sourceRoot, destinationRoot, entry) {
  const sourcePath = resolve(sourceRoot, entry);
  if (!existsSync(sourcePath)) {
    throw new Error(`package files[] entry is missing: ${entry}`);
  }
  if (shouldExclude(entry)) {
    throw new Error(`package files[] entry is forbidden in the Codex release payload: ${entry}`);
  }

  const destinationPath = resolve(destinationRoot, entry);
  const sourceStat = lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`symlinked release input is not allowed: ${entry}`);
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, {
    recursive: sourceStat.isDirectory(),
    dereference: false,
    force: true,
    filter: (copiedPath) => {
      const relativePath = normalizePath(relative(sourceRoot, copiedPath));
      return relativePath === "" || !shouldExclude(relativePath);
    },
  });
}

function createPublishablePackageRoot(temporaryRoot) {
  const packageDirectory = join(temporaryRoot, "npm-package");
  mkdirSync(packageDirectory, { recursive: true });
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packageDirectory],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  const archives = readdirSync(packageDirectory).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`expected one npm package archive, found ${archives.length}`);
  }
  const extractionRoot = join(temporaryRoot, "npm-package-extracted");
  mkdirSync(extractionRoot, { recursive: true });
  execFileSync("tar", ["-xzf", join(packageDirectory, archives[0]), "-C", extractionRoot], {
    stdio: "pipe",
  });
  const packageRoot = join(extractionRoot, "package");
  if (!existsSync(packageRoot)) {
    throw new Error("npm package archive did not contain the package/ root");
  }
  return packageRoot;
}

function listFiles(root, currentPath = root) {
  const files = [];
  for (const name of readdirSync(currentPath).sort()) {
    const absolutePath = join(currentPath, name);
    const relativePath = normalizePath(relative(root, absolutePath));
    const entryStat = lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`release staging unexpectedly contains a symlink: ${relativePath}`);
    }
    if (entryStat.isDirectory()) {
      files.push(...listFiles(root, absolutePath));
    } else if (entryStat.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`release staging contains a non-regular file: ${relativePath}`);
    }
  }
  return files;
}

function validatePayload(payloadRoot) {
  for (const relativePath of listFiles(payloadRoot)) {
    if (shouldExclude(relativePath)) {
      throw new Error(`forbidden path reached Codex release payload: ${relativePath}`);
    }
  }

  const packageJson = JSON.parse(readFileSync(join(payloadRoot, "package.json"), "utf8"));
  if (packageJson.version === undefined) {
    throw new Error("payload package.json is missing its version");
  }
  if (existsSync(join(payloadRoot, "node_modules"))) {
    throw new Error("Codex release payload must not contain node_modules");
  }
  if (existsSync(join(payloadRoot, "bun.lock"))) {
    throw new Error("Codex release payload must not contain bun.lock");
  }
  if (!existsSync(join(payloadRoot, "fetch-worker.bundle.cjs"))) {
    throw new Error("Codex release payload must contain fetch-worker.bundle.cjs");
  }
}

function writeMarketplaceManifest(stagingRoot) {
  const marketplacePath = join(stagingRoot, ".agents", "plugins", "marketplace.json");
  mkdirSync(dirname(marketplacePath), { recursive: true });
  writeFileSync(
    marketplacePath,
    `${JSON.stringify({
      name: "context-mode-offline",
      interface: { displayName: "context-mode offline" },
      plugins: [
        {
          name: "context-mode",
          source: {
            source: "local",
            path: "./plugins/context-mode",
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function writeContentManifest(stagingRoot, version) {
  const entries = listFiles(stagingRoot)
    .filter((relativePath) => relativePath !== "CONTENT-MANIFEST.json")
    .map((relativePath) => {
      const absolutePath = join(stagingRoot, relativePath);
      return {
        path: relativePath,
        sha256: sha256(absolutePath),
        size: statSync(absolutePath).size,
      };
    });
  const payload = {
    schemaVersion: 1,
    package: "context-mode",
    version,
    entries,
  };
  const manifestPath = join(stagingRoot, "CONTENT-MANIFEST.json");
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    contentManifestPath: manifestPath,
    contentManifestSha256: sha256(manifestPath),
  };
}

function writeTarString(header, offset, length, value) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length) {
    throw new Error(`USTAR field exceeds ${length} bytes: ${value}`);
  }
  encoded.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length > length - 1) {
    throw new Error(`USTAR numeric field exceeds ${length} bytes: ${value}`);
  }
  writeTarString(header, offset, length, `${encoded}\0`);
}

function writeTarPath(header, relativePath) {
  if (Buffer.byteLength(relativePath, "utf8") <= 100) {
    writeTarString(header, 0, 100, relativePath);
    return;
  }

  const segments = relativePath.split("/");
  for (let index = 1; index < segments.length; index++) {
    const prefix = segments.slice(0, index).join("/");
    const name = segments.slice(index).join("/");
    if (Buffer.byteLength(prefix, "utf8") <= 155 && Buffer.byteLength(name, "utf8") <= 100) {
      writeTarString(header, 0, 100, name);
      writeTarString(header, 345, 155, prefix);
      return;
    }
  }

  throw new Error(`USTAR path is too long: ${relativePath}`);
}

function createTarHeader(relativePath, type, size, mtime) {
  const header = Buffer.alloc(512, 0);
  writeTarPath(header, relativePath);
  writeTarOctal(header, 100, 8, type === "directory" ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function createArchive(stagingRoot, archivePath) {
  const sourceDateEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "0", 10);
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
  }

  const filePaths = listFiles(stagingRoot);
  const directoryPaths = new Set();
  for (const relativePath of filePaths) {
    const segments = relativePath.split("/");
    for (let index = 1; index < segments.length; index++) {
      directoryPaths.add(`${segments.slice(0, index).join("/")}/`);
    }
  }

  const archiveParts = [];
  for (const relativePath of [...directoryPaths].sort()) {
    archiveParts.push(createTarHeader(relativePath, "directory", 0, sourceDateEpoch));
  }
  for (const relativePath of filePaths) {
    const content = readFileSync(join(stagingRoot, relativePath));
    const remainder = content.length % 512;
    archiveParts.push(createTarHeader(relativePath, "file", content.length, sourceDateEpoch));
    archiveParts.push(content);
    if (remainder !== 0) archiveParts.push(Buffer.alloc(512 - remainder));
  }
  archiveParts.push(Buffer.alloc(1024));

  const compressed = gzipSync(Buffer.concat(archiveParts), { level: 9, mtime: 0 });
  compressed[9] = 255;
  writeFileSync(archivePath, compressed);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = readPackage();
  assertBuildInputs(packageJson);

  const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-codex-release-"));
  const stagingRoot = join(temporaryRoot, "context-mode-codex-marketplace");
  const payloadRoot = join(stagingRoot, "plugins", "context-mode");
  const archiveName = `context-mode-codex-marketplace-v${packageJson.version}.tar.gz`;
  const outputArchivePath = join(options.outputDirectory, archiveName);

  try {
    mkdirSync(payloadRoot, { recursive: true });
    const publishablePackageRoot = createPublishablePackageRoot(temporaryRoot);
    for (const entry of codexPayloadEntries) {
      copyEntry(publishablePackageRoot, payloadRoot, entry);
    }

    validatePayload(payloadRoot);
    writeMarketplaceManifest(stagingRoot);
    const manifest = writeContentManifest(stagingRoot, packageJson.version);
    mkdirSync(options.outputDirectory, { recursive: true });
    const temporaryArchivePath = join(temporaryRoot, archiveName);
    createArchive(stagingRoot, temporaryArchivePath);
    renameSync(temporaryArchivePath, outputArchivePath);

    const checksumPath = `${outputArchivePath}.sha256`;
    writeFileSync(
      checksumPath,
      `${sha256(outputArchivePath)}  ${basename(outputArchivePath)}\n` +
        `${manifest.contentManifestSha256}  CONTENT-MANIFEST.json\n`,
      "utf8",
    );

    console.log(JSON.stringify({
      archive: outputArchivePath,
      archiveSha256: sha256(outputArchivePath),
      checksum: checksumPath,
      contentManifestSha256: manifest.contentManifestSha256,
      version: packageJson.version,
    }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
