#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

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

function main() {
  const archivePath = resolve(process.argv[2] ?? "");
  if (!archivePath || !existsSync(archivePath)) {
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
    execFileSync("tar", ["-xzf", archivePath, "-C", extractionRoot], {
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
        CODEX_HOME: codexHome,
        CONTEXT_MODE_PLATFORM: "codex",
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
      manifestEntries: manifest.entries.length,
    }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
