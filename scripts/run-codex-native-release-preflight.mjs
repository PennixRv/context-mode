#!/usr/bin/env node

// Operator-only preflight. It deliberately runs with a fresh CODEX_HOME and
// emits only the content-free attestation; CI uses the separate check-only
// verifier and never invokes this provider-authorized command.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
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
const PROVIDER_PROJECTION_KEYS = ["model_provider", "provider"];
const PROVIDER_CONFIGURATION_KEYS = ["name", "base_url", "wire_api", "requires_openai_auth"];
const SUPPORTED_PROVIDER_WIRE_APIS = new Set(["chat", "completions", "responses"]);
const PROVIDER_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const PREFLIGHT_OPTION_KEYS = new Set(["tag", "provider_tuple", "output", "source_commit", "provider_projection"]);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function createNonProviderEnvironment(sourceEnvironment = process.env) {
  const environment = { ...sourceEnvironment };
  delete environment.OPENAI_API_KEY;
  return environment;
}

export function parsePreflightArguments(argv) {
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (!value.startsWith("--")) throw new Error(`unsupported argument: ${value}`);
    const key = value.slice(2).replace(/-/g, "_");
    if (!PREFLIGHT_OPTION_KEYS.has(key)) throw new Error(`unsupported argument: ${value}`);
    const argumentValue = argv[++index];
    if (!argumentValue || argumentValue.startsWith("--")) throw new Error(`${value} requires a value`);
    if (options[key] !== undefined) throw new Error(`${value} may be specified only once`);
    options[key] = argumentValue;
  }
  for (const key of ["tag", "provider_tuple", "provider_projection", "output"]) {
    if (!options[key]) throw new Error(`--${key.replace(/_/g, "-")} is required`);
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: createNonProviderEnvironment(),
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
    "OPENAI_API_KEY",
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

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys.slice().sort()[index]);
}

function isPathInside(path, parent) {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

function assertNoSymbolicLinkTraversal(path, label) {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  let current = root;
  for (const segment of relative(root, absolutePath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} must not traverse a symbolic link`);
    }
  }
}

function providerProjectionProfilePaths(sourceEnvironment) {
  const home = resolve(sourceEnvironment.HOME || homedir());
  const paths = [join(home, ".codex")];
  if (sourceEnvironment.CODEX_HOME) paths.push(resolve(sourceEnvironment.CODEX_HOME));
  if (sourceEnvironment.CODEX_CONFIG) paths.push(resolve(sourceEnvironment.CODEX_CONFIG));
  return [...new Set(paths.flatMap((profilePath) => {
    const aliases = [profilePath];
    try {
      aliases.push(realpathSync(profilePath));
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
        throw new Error("normal Codex profile path could not be validated");
      }
      // A missing normal-profile path has no state to protect yet.
    }
    return aliases;
  }))];
}

function assertSafeProviderProjectionPath(projectionPath, {
  repository = repositoryRoot,
  sourceEnvironment = process.env,
} = {}) {
  const resolvedProjection = resolve(projectionPath);
  const resolvedRepository = resolve(repository);
  if (isPathInside(resolvedProjection, resolvedRepository)) {
    throw new Error("provider projection must be outside the repository");
  }
  if (providerProjectionProfilePaths(sourceEnvironment).some((profilePath) => isPathInside(resolvedProjection, profilePath))) {
    throw new Error("provider projection must not use a normal Codex profile path");
  }
  assertNoSymbolicLinkTraversal(resolvedProjection, "provider projection");
  if (!existsSync(resolvedProjection)) throw new Error("provider projection must exist");
  const stats = lstatSync(resolvedProjection);
  if (!stats.isFile()) throw new Error("provider projection must be a regular file");
  if ((stats.mode & 0o7777) !== 0o600) throw new Error("provider projection must have mode 0600");
  return resolvedProjection;
}

function assertSafeProviderString(value, pattern, label) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`provider projection has an invalid ${label}`);
  }
}

function assertSafeProviderUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f"\\]/.test(value)
  ) {
    throw new Error("provider projection has an invalid base_url");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("provider projection has an invalid base_url");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("provider projection has an invalid base_url");
  }
}

export function validateProviderProjection(projection) {
  if (!hasExactKeys(projection, PROVIDER_PROJECTION_KEYS)) {
    throw new Error("provider projection must contain only model_provider and provider");
  }
  if (!hasExactKeys(projection.provider, PROVIDER_CONFIGURATION_KEYS)) {
    throw new Error("provider projection must contain only the supported provider fields");
  }
  assertSafeProviderString(projection.model_provider, PROVIDER_IDENTIFIER_PATTERN, "model_provider");
  assertSafeProviderString(projection.provider.name, PROVIDER_NAME_PATTERN, "provider name");
  assertSafeProviderUrl(projection.provider.base_url);
  if (!SUPPORTED_PROVIDER_WIRE_APIS.has(projection.provider.wire_api)) {
    throw new Error("provider projection has an unsupported wire_api");
  }
  if (projection.provider.requires_openai_auth !== true) {
    throw new Error("provider projection must require OpenAI environment authorization");
  }
  return {
    model_provider: projection.model_provider,
    provider: {
      name: projection.provider.name,
      base_url: projection.provider.base_url,
      wire_api: projection.provider.wire_api,
      requires_openai_auth: true,
    },
  };
}

export function loadProviderProjection(projectionPath, options = {}) {
  const resolvedProjection = assertSafeProviderProjectionPath(projectionPath, options);
  let projection;
  try {
    projection = JSON.parse(readFileSync(resolvedProjection, "utf8"));
  } catch {
    throw new Error("provider projection must contain valid JSON");
  }
  return validateProviderProjection(projection);
}

export function writeDisposableProviderConfig(validationHome, projection) {
  const validatedProjection = validateProviderProjection(projection);
  const resolvedHome = resolve(validationHome);
  assertNoSymbolicLinkTraversal(resolvedHome, "disposable CODEX_HOME");
  if (!existsSync(resolvedHome) || !lstatSync(resolvedHome).isDirectory()) {
    throw new Error("disposable CODEX_HOME must be a directory");
  }
  if (readdirSync(resolvedHome).length !== 0) {
    throw new Error("disposable CODEX_HOME must not contain profile state before provider configuration");
  }
  const configPath = join(resolvedHome, "config.toml");
  const config = [
    `model_provider = "${validatedProjection.model_provider}"`,
    "",
    `[model_providers.${validatedProjection.model_provider}]`,
    `name = "${validatedProjection.provider.name}"`,
    `base_url = "${validatedProjection.provider.base_url}"`,
    `wire_api = "${validatedProjection.provider.wire_api}"`,
    "requires_openai_auth = true",
    "",
  ].join("\n");
  writeFileSync(configPath, config, { encoding: "utf8", mode: 0o600, flag: "wx" });
  // Ensure an unusual process umask cannot weaken the disposable config mode.
  chmodSync(configPath, 0o600);
  return configPath;
}

export function writeDisposableProviderAuth(validationHome, sourceEnvironment = process.env) {
  assertProviderEnvironmentAuthorization(sourceEnvironment);
  const resolvedHome = resolve(validationHome);
  assertNoSymbolicLinkTraversal(resolvedHome, "disposable CODEX_HOME");
  if (!existsSync(resolvedHome) || !lstatSync(resolvedHome).isDirectory()) {
    throw new Error("disposable CODEX_HOME must be a directory");
  }
  const entries = readdirSync(resolvedHome);
  if (entries.length !== 1 || entries[0] !== "config.toml") {
    throw new Error("disposable CODEX_HOME must contain only generated provider config before auth projection");
  }
  const configPath = join(resolvedHome, "config.toml");
  if (!lstatSync(configPath).isFile() || (lstatSync(configPath).mode & 0o777) !== 0o600) {
    throw new Error("disposable CODEX_HOME provider config must be a regular mode-0600 file");
  }
  const authPath = join(resolvedHome, "auth.json");
  writeFileSync(authPath, `${JSON.stringify({ OPENAI_API_KEY: sourceEnvironment.OPENAI_API_KEY })}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(authPath, 0o600);
  if (!lstatSync(authPath).isFile() || (lstatSync(authPath).mode & 0o777) !== 0o600) {
    throw new Error("disposable CODEX_HOME provider auth must be a regular mode-0600 file");
  }
  return authPath;
}

export function assertProviderEnvironmentAuthorization(sourceEnvironment = process.env) {
  if (typeof sourceEnvironment.OPENAI_API_KEY !== "string" || sourceEnvironment.OPENAI_API_KEY.length === 0) {
    throw new Error("provider projection requires OPENAI_API_KEY in the process environment");
  }
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
  const options = parsePreflightArguments(process.argv.slice(2));
  const tag = options.tag;
  validateNativeReleaseProviderTuple(options.provider_tuple);
  const output = resolvePreflightOutput(repositoryRoot, tag, options.output);
  const providerProjection = loadProviderProjection(options.provider_projection);
  assertProviderEnvironmentAuthorization();
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
    if (providerProjection) {
      writeDisposableProviderConfig(validationHome, providerProjection);
      writeDisposableProviderAuth(validationHome);
    }
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

    const validatorEnvironment = {
      ...codexEnv,
      CONTEXT_MODE_VALIDATION_HOME: validationHome,
      CONTEXT_MODE_PROJECT_PATH: projectRoot,
      CONTEXT_MODE_RELEASE_PLUGIN_ROOT: pluginRoot,
    };
    run(process.execPath, [join(repositoryRoot, "scripts/validate-codex-checkpoint-delivery.mjs")], {
      env: {
        ...validatorEnvironment,
        CONTEXT_MODE_CHECKPOINT_TRIGGER: "manual",
        CONTEXT_MODE_PROVISION_HOOK_TRUST: "1",
      },
    });

    const triggers = {};
    for (const trigger of ["manual", "auto"]) {
      const reportPath = join(validationHome, `native-${trigger}.json`);
      try {
        run(process.execPath, [join(repositoryRoot, "scripts/validate-codex-checkpoint-delivery.mjs")], {
          env: {
            ...validatorEnvironment,
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
