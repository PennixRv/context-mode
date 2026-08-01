#!/usr/bin/env node

// Operator-only preflight. It deliberately runs with a fresh CODEX_HOME and
// emits only the content-free attestation; CI uses the separate check-only
// verifier and never invokes this provider-authorized command.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SUPPORTED_CODEX_CLI_VERSION,
  SUPPORTED_NODE_VERSION,
  createNativeReleaseAttestation,
  formatNativeReleaseTagMetadata,
  nativeReleaseAttestationPath,
  serializeNativeReleaseAttestation,
  validateNativeReleaseProviderTuple,
} from "./codex-native-release-attestation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (!value.startsWith("--")) throw new Error(`unsupported argument: ${value}`);
    const key = value.slice(2).replace(/-/g, "_");
    const argumentValue = argv[++index];
    if (!argumentValue || argumentValue.startsWith("--")) throw new Error(`${value} requires a value`);
    if (options[key] !== undefined) throw new Error(`${value} may be specified only once`);
    options[key] = argumentValue;
  }
  for (const key of ["tag", "provider_tuple", "output"]) {
    if (!options[key]) throw new Error(`--${key.replace(/_/g, "-")} is required`);
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function createProject(root) {
  mkdirSync(root, { recursive: true });
  run("git", ["init", "--quiet", root]);
}

export function createDisposableEnvironment(validationHome, sourceEnvironment = process.env) {
  const environment = { ...sourceEnvironment, CODEX_HOME: validationHome };
  for (const key of [
    "CODEX_CONFIG",
    "CONTEXT_MODE_DIR",
    "CONTEXT_MODE_PROJECT_PATH",
    "CONTEXT_MODE_RELEASE_PLUGIN_ROOT",
    "CONTEXT_MODE_REPORT_PATH",
    "CONTEXT_MODE_VALIDATION_HOME",
    "CONTEXT_MODE_CHECKPOINT_TRIGGER",
  ]) {
    delete environment[key];
  }
  return environment;
}

export function assertCleanSourceTree(runGit = run) {
  const status = runGit("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim() !== "") {
    throw new Error("native preflight requires a clean source tree at the attested source commit");
  }
}

export function resolvePreflightOutput(repository, tag, output) {
  const expectedOutput = resolve(repository, nativeReleaseAttestationPath(tag));
  const resolvedOutput = resolve(repository, output);
  if (resolvedOutput !== expectedOutput) {
    throw new Error("native preflight output must use the direct-child release attestation path for the tag");
  }
  const relativeParent = relative(repository, dirname(resolvedOutput));
  let current = repository;
  for (const segment of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("native preflight output path must not traverse a symbolic link");
    }
  }
  return resolvedOutput;
}

function extractArchive(archive, root) {
  mkdirSync(root, { recursive: true });
  run("tar", ["-xzf", archive, "-C", root]);
}

function readTriggerEvidence(reportPath, trigger) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (report.status !== "passed" || report.trigger !== trigger) {
    throw new Error(`${trigger} native delivery did not pass`);
  }
  if (report.checkpoint?.state !== "claimed") {
    throw new Error(`${trigger} native delivery did not reach claimed`);
  }
  const reasons = report.checkpoint.transitionReasons;
  if (JSON.stringify(reasons) !== JSON.stringify([
    "created",
    "postcompact_succeeded",
    "sessionstart_context_emitted",
  ])) {
    throw new Error(`${trigger} native delivery lifecycle was incomplete`);
  }
  const attestation = report.attestation;
  if (!attestation || attestation.matchesCheckpointId !== true || typeof attestation.assistantResponseSha256 !== "string") {
    throw new Error(`${trigger} native delivery opaque-ID attestation was missing`);
  }
  return {
    status: "passed",
    lifecycle: ["pending", "confirmed", "claimed"],
    terminal_state: "claimed",
    opaque_id_attestation_sha256: attestation.assistantResponseSha256,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const tag = options.tag;
  validateNativeReleaseProviderTuple(options.provider_tuple);
  const output = resolvePreflightOutput(repositoryRoot, tag, options.output);
  if (process.versions.node !== SUPPORTED_NODE_VERSION) {
    throw new Error(`native preflight requires Node ${SUPPORTED_NODE_VERSION}`);
  }
  const sourceCommit = options.source_commit ?? run("git", ["rev-parse", "HEAD"]).trim();
  const headCommit = run("git", ["rev-parse", "HEAD"]).trim();
  if (headCommit !== sourceCommit) {
    throw new Error("native preflight must run from the exact source commit; source-tree drift is not allowed");
  }
  assertCleanSourceTree();
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  if (`v${packageJson.version}` !== tag) throw new Error("tag does not match package version");

  const temporaryRoot = mkdtempSync(join(tmpdir(), "context-mode-native-preflight-"));
  const archiveDirectory = join(temporaryRoot, "archive");
  const marketplaceRoot = join(temporaryRoot, "marketplace");
  const validationHome = join(temporaryRoot, "codex-home");
  const projectRoot = join(temporaryRoot, "project");
  try {
    mkdirSync(archiveDirectory, { recursive: true });
    mkdirSync(validationHome, { recursive: true });
    createProject(projectRoot);
    const archiveOutput = JSON.parse(run(process.execPath, [
      join(repositoryRoot, "scripts/build-codex-marketplace-bundle.mjs"),
      "--output-dir",
      archiveDirectory,
    ]));
    const archive = archiveOutput.archive;
    run(process.execPath, [join(repositoryRoot, "scripts/verify-codex-release-asset.mjs"), archive]);
    extractArchive(archive, marketplaceRoot);
    const manifestPath = join(marketplaceRoot, "CONTENT-MANIFEST.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    const codexEnv = createDisposableEnvironment(validationHome);
    if (!run("codex", ["--version"], { env: codexEnv }).includes(SUPPORTED_CODEX_CLI_VERSION)) {
      throw new Error(`native preflight requires Codex CLI ${SUPPORTED_CODEX_CLI_VERSION}`);
    }
    run("codex", ["plugin", "marketplace", "add", marketplaceRoot], { env: codexEnv });
    run("codex", ["plugin", "add", "context-mode@context-mode-offline"], { env: codexEnv });
    const pluginRoot = join(
      validationHome,
      "plugins",
      "cache",
      "context-mode-offline",
      "context-mode",
      manifest.version,
    );
    if (!existsSync(pluginRoot)) throw new Error("offline plugin was not installed");

    const triggers = {};
    for (const trigger of ["manual", "auto"]) {
      const reportPath = join(validationHome, `native-${trigger}.json`);
      try {
        run(process.execPath, [join(repositoryRoot, "scripts/validate-codex-checkpoint-delivery.mjs")], {
          env: {
            ...codexEnv,
            CONTEXT_MODE_VALIDATION_HOME: validationHome,
            CONTEXT_MODE_PROJECT_PATH: projectRoot,
            CONTEXT_MODE_RELEASE_PLUGIN_ROOT: pluginRoot,
            CONTEXT_MODE_CHECKPOINT_TRIGGER: trigger,
            CONTEXT_MODE_REPORT_PATH: reportPath,
          },
        });
        triggers[trigger === "auto" ? "automatic" : "manual"] = readTriggerEvidence(reportPath, trigger);
      } finally {
        rmSync(reportPath, { force: true });
      }
    }

    const attestation = createNativeReleaseAttestation({
      created_at: new Date().toISOString(),
      candidate: {
        tag,
        version: packageJson.version,
        source_commit: sourceCommit,
        archive_sha256: sha256File(archive),
        content_manifest_sha256: sha256File(manifestPath),
      },
      environment: {
        node_version: SUPPORTED_NODE_VERSION,
        codex_cli_version: SUPPORTED_CODEX_CLI_VERSION,
        provider_tuple: options.provider_tuple,
      },
      triggers,
    });
    mkdirSync(dirname(output), { recursive: true });
    const attestationText = serializeNativeReleaseAttestation(attestation);
    writeFileSync(output, attestationText, { mode: 0o600, flag: "wx" });
    const rawSha256 = sha256File(output);
    console.log(JSON.stringify({
      attestation: output,
      archive: basename(archive),
      attestationSha256: attestation.attestation_sha256,
      rawSha256,
      tagMetadata: formatNativeReleaseTagMetadata(attestation, rawSha256),
      contentManifestSha256: attestation.candidate.content_manifest_sha256,
      scope: attestation.scope,
    }, null, 2));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) main();
