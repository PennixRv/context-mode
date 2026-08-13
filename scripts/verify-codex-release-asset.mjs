#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function readContextModeMcpEntry(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const entry = manifest.mcpServers?.["context-mode"];
  if (!entry) throw new Error(`context-mode MCP entry is missing: ${path}`);
  return entry;
}

function assertCodexMcpEnvironment(entry, description) {
  if (JSON.stringify(entry.env_vars) !== JSON.stringify(codexMcpEnvVars)) {
    throw new Error(`${description} does not declare the exact Codex MCP env_vars allowlist`);
  }
  if (
    JSON.stringify(entry.env) !==
    JSON.stringify({ CONTEXT_MODE_PLATFORM: "codex" })
  ) {
    throw new Error(`${description} does not retain the fixed Codex platform environment`);
  }
}

function parseArchivePath(argv) {
  const values = argv.filter((value) => value !== "--");
  if (values.length !== 1) {
    throw new Error("Usage: node scripts/verify-codex-release-asset.mjs <archive.tar.gz>");
  }
  return resolve(values[0]);
}

function main() {
  const archivePath = parseArchivePath(process.argv.slice(2));
  if (!existsSync(archivePath)) {
    throw new Error("Usage: node scripts/verify-codex-release-asset.mjs <archive.tar.gz>");
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-codex-asset-test-"));
  const extractionRoot = join(temporaryRoot, "marketplace");
  const codexHome = join(temporaryRoot, "codex-home");
  const projectRoot = join(temporaryRoot, "project");
  try {
    mkdirSync(extractionRoot, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    // GNU tar on Windows treats a C:\\ archive path as a remote archive
    // specifier. Stage the input beneath the temporary root and use only
    // relative paths for the extraction command.
    const stagedArchivePath = join(temporaryRoot, "release-asset.tar.gz");
    copyFileSync(archivePath, stagedArchivePath);
    execFileSync("tar", ["-xzf", "release-asset.tar.gz", "-C", "marketplace"], {
      cwd: temporaryRoot,
      stdio: "pipe",
    });

    const contentManifestPath = join(extractionRoot, "CONTENT-MANIFEST.json");
    const manifest = JSON.parse(readFileSync(contentManifestPath, "utf8"));
    for (const entry of manifest.entries) {
      const path = join(extractionRoot, entry.path);
      if (!existsSync(path) || sha256(path) !== entry.sha256 || statSync(path).size !== entry.size) {
        throw new Error(`content manifest mismatch: ${entry.path}`);
      }
    }

    const wrapperManifest = JSON.parse(readFileSync(join(extractionRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
    const source = wrapperManifest.plugins?.[0]?.source;
    if (source?.source !== "local" || source?.path !== "./plugins/context-mode") {
      throw new Error("offline marketplace wrapper does not use the required local plugin source");
    }

    const sourceMcpEntry = readContextModeMcpEntry(
      join(repositoryRoot, ".codex-plugin", "mcp.json"),
    );
    const payloadMcpEntry = readContextModeMcpEntry(
      join(extractionRoot, "plugins", "context-mode", ".codex-plugin", "mcp.json"),
    );
    assertCodexMcpEnvironment(sourceMcpEntry, "source Codex MCP manifest");
    assertCodexMcpEnvironment(payloadMcpEntry, "marketplace Codex MCP manifest");

    run("codex", ["plugin", "marketplace", "add", extractionRoot], {
      cwd: projectRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    run("codex", ["plugin", "add", "context-mode@context-mode-offline"], {
      cwd: projectRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    const plugins = run("codex", ["plugin", "list"], {
      cwd: projectRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    if (!plugins.includes("context-mode")) {
      throw new Error(`Codex did not list context-mode after offline installation:\n${plugins}`);
    }

    const pluginRoot = join(
      codexHome,
      "plugins",
      "cache",
      "context-mode-offline",
      "context-mode",
      manifest.version,
    );
    const installedMcpEntry = readContextModeMcpEntry(
      join(pluginRoot, ".codex-plugin", "mcp.json"),
    );
    assertCodexMcpEnvironment(installedMcpEntry, "installed Codex MCP manifest");

    const normalizedServers = JSON.parse(run("codex", ["mcp", "list", "--json"], {
      cwd: projectRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
    }));
    const normalizedServer = normalizedServers.find((server) => server.name === "context-mode");
    if (!normalizedServer || normalizedServer.transport?.type !== "stdio") {
      throw new Error("Codex did not normalize the installed context-mode stdio MCP server");
    }
    assertCodexMcpEnvironment(
      normalizedServer.transport,
      "normalized Codex MCP transport",
    );

    const forwardedEnvironment = Object.fromEntries(
      installedMcpEntry.env_vars
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    );
    const mcpProbe = spawnSync(process.execPath, ["./start.mjs"], {
      cwd: pluginRoot,
      input: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "context-mode-release-smoke", version: "1.0" },
        },
      }) + "\n",
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        ...forwardedEnvironment,
        ...installedMcpEntry.env,
        CODEX_HOME: codexHome,
        CONTEXT_MODE_DIR: join(temporaryRoot, "context-mode-state"),
      },
    });
    if (mcpProbe.status !== 0 || !mcpProbe.stdout.includes('"serverInfo"')) {
      throw new Error(`offline MCP boot probe failed:\n${mcpProbe.stdout}\n${mcpProbe.stderr}`);
    }
    if (existsSync(join(pluginRoot, "node_modules"))) {
      throw new Error("offline MCP boot created a node_modules directory");
    }

    console.log(JSON.stringify({
      archive: basename(archivePath),
      archiveSha256: sha256(archivePath),
      installed: "context-mode@context-mode-offline",
      mcpInitialized: true,
      envVars: codexMcpEnvVars,
      manifestEntries: manifest.entries.length,
    }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
