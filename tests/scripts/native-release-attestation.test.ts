import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  NATIVE_RELEASE_DELIVERY_SCOPE,
  SUPPORTED_CODEX_CLI_VERSION,
  SUPPORTED_NODE_VERSION,
  createNativeReleaseAttestation,
  formatNativeReleaseTagMetadata,
  parseNativeReleaseAttestation,
  parseNativeReleaseTagMetadata,
  serializeNativeReleaseAttestation,
  sha256,
  validateNativeReleaseAttestationBinding,
} from "../../scripts/codex-native-release-attestation.mjs";
import { verifyNativeReleaseAttestation } from "../../scripts/verify-codex-native-release-attestation.mjs";
import {
  assertCleanSourceTree,
  assertProviderEnvironmentAuthorization,
  createDisposableEnvironment,
  createNonProviderEnvironment,
  loadProviderProjection,
  parsePreflightArguments,
  resolvePreflightOutput,
  writeDisposableProviderAuth,
  writeDisposableProviderConfig,
} from "../../scripts/run-codex-native-release-preflight.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ARCHIVE_SHA256 = "a".repeat(64);
const MANIFEST_SHA256 = "b".repeat(64);
const OPAQUE_SHA256 = "c".repeat(64);
const TAG = "v1.0.176";
const CREATED_AT = "2026-08-01T00:00:00.000Z";
const PROVIDER_TUPLE = "codex-0.146.0-local";

function makeAttestation(sourceCommit = COMMIT) {
  return createNativeReleaseAttestation({
    created_at: CREATED_AT,
    candidate: {
      tag: TAG,
      version: "1.0.176",
      source_commit: sourceCommit,
      archive_sha256: ARCHIVE_SHA256,
      content_manifest_sha256: MANIFEST_SHA256,
    },
    environment: {
      node_version: SUPPORTED_NODE_VERSION,
      codex_cli_version: SUPPORTED_CODEX_CLI_VERSION,
      provider_tuple: PROVIDER_TUPLE,
    },
    triggers: {
      manual: {
        status: "passed",
        lifecycle: ["pending", "confirmed", "claimed"],
        terminal_state: "claimed",
        opaque_id_attestation_sha256: OPAQUE_SHA256,
      },
      automatic: {
        status: "passed",
        lifecycle: ["pending", "confirmed", "claimed"],
        terminal_state: "claimed",
        opaque_id_attestation_sha256: OPAQUE_SHA256,
      },
    },
  });
}

function tagMessage(attestation: ReturnType<typeof makeAttestation>, rawSha256: string) {
  return [
    "Release v1.0.176",
    "Codex-Content-Manifest-SHA256: " + MANIFEST_SHA256,
    formatNativeReleaseTagMetadata(attestation, rawSha256),
    "",
  ].join("\n");
}

describe("native release attestation schema", () => {
  test("pins the native release gate to the current runtime tuple", () => {
    expect(SUPPORTED_NODE_VERSION).toBe("26.5.0");
    expect(SUPPORTED_CODEX_CLI_VERSION).toBe("0.146.0");
  });

  test("keeps the canonical payload digest distinct from the raw tracked-file digest", () => {
    const attestation = makeAttestation();
    const text = serializeNativeReleaseAttestation(attestation);

    expect(attestation.scope).toBe(NATIVE_RELEASE_DELIVERY_SCOPE);
    expect(attestation.attestation_sha256).toBe(
      sha256(JSON.stringify({
        schema_version: attestation.schema_version,
        scope: attestation.scope,
        created_at: attestation.created_at,
        candidate: attestation.candidate,
        environment: attestation.environment,
        triggers: attestation.triggers,
      })),
    );
    expect(attestation.attestation_sha256).not.toBe(sha256(text));
    expect(parseNativeReleaseAttestation(JSON.parse(text))).toEqual(attestation);
  });

  test("parses exactly one direct-child tag metadata line with all immutable bindings", () => {
    const attestation = makeAttestation();
    const text = serializeNativeReleaseAttestation(attestation);
    const rawSha256 = sha256(text);
    const metadata = parseNativeReleaseTagMetadata(tagMessage(attestation, rawSha256));

    expect(metadata).toEqual({
      path: "docs/releases/attestations/v1.0.176.json",
      raw_sha256: rawSha256,
      attestation_sha256: attestation.attestation_sha256,
      tag: TAG,
      version: "1.0.176",
      source_commit: COMMIT,
      archive_sha256: ARCHIVE_SHA256,
      content_manifest_sha256: MANIFEST_SHA256,
      node_version: SUPPORTED_NODE_VERSION,
      codex_cli_version: SUPPORTED_CODEX_CLI_VERSION,
      provider_tuple: PROVIDER_TUPLE,
    });
  });

  test("accepts a valid release binding", () => {
    const attestation = makeAttestation();
    const text = serializeNativeReleaseAttestation(attestation);
    expect(validateNativeReleaseAttestationBinding(attestation, {
      tag: TAG,
      source_commit: COMMIT,
      evidence_commit: "1".repeat(40),
      archive_sha256: ARCHIVE_SHA256,
      content_manifest_sha256: MANIFEST_SHA256,
      attestation_file_sha256: sha256(text),
      attestation_path: "docs/releases/attestations/v1.0.176.json",
      tag_message: tagMessage(attestation, sha256(text)),
      now: new Date("2026-08-01T12:00:00.000Z"),
    })).toEqual(attestation);
  });

  test.each([
    ["raw file digest", (attestation: ReturnType<typeof makeAttestation>, text: string) => ({
      tagMessage: tagMessage(attestation, attestation.attestation_sha256),
      fileSha256: sha256(text),
    })],
    ["archive digest", (attestation: ReturnType<typeof makeAttestation>, text: string) => ({
      tagMessage: tagMessage(attestation, sha256(text)),
      fileSha256: sha256(text),
      archiveSha256: "d".repeat(64),
    })],
    ["manifest digest", (attestation: ReturnType<typeof makeAttestation>, text: string) => ({
      tagMessage: tagMessage(attestation, sha256(text)),
      fileSha256: sha256(text),
      manifestSha256: "e".repeat(64),
    })],
  ])("rejects a mismatched %s binding", (_description, makeOptions) => {
    const attestation = makeAttestation();
    const text = serializeNativeReleaseAttestation(attestation);
    const values = makeOptions(attestation, text);
    expect(() => validateNativeReleaseAttestationBinding(attestation, {
      tag: TAG,
      source_commit: COMMIT,
      evidence_commit: "1".repeat(40),
      archive_sha256: values.archiveSha256 ?? ARCHIVE_SHA256,
      content_manifest_sha256: values.manifestSha256 ?? MANIFEST_SHA256,
      attestation_file_sha256: values.fileSha256,
      attestation_path: "docs/releases/attestations/v1.0.176.json",
      tag_message: values.tagMessage,
      now: new Date("2026-08-01T12:00:00.000Z"),
    })).toThrow();
  });

  test("rejects stale, duplicate, malformed, and forbidden evidence", () => {
    const attestation = makeAttestation();
    const text = serializeNativeReleaseAttestation(attestation);
    const rawSha256 = sha256(text);
    const validMessage = tagMessage(attestation, rawSha256);

    expect(() => validateNativeReleaseAttestationBinding(attestation, {
      tag: TAG,
      source_commit: COMMIT,
      evidence_commit: "1".repeat(40),
      archive_sha256: ARCHIVE_SHA256,
      content_manifest_sha256: MANIFEST_SHA256,
      attestation_file_sha256: rawSha256,
      attestation_path: "docs/releases/attestations/v1.0.176.json",
      tag_message: validMessage,
      now: new Date("2026-08-03T00:00:00.000Z"),
    })).toThrow(/stale/);
    expect(() => parseNativeReleaseTagMetadata(`${validMessage}\n${validMessage.split("\n")[2]}`)).toThrow(/exactly one/);
    expect(() => parseNativeReleaseTagMetadata(validMessage.replace("raw_sha256=", "raw_sha256=" + "bad "))).toThrow();
    expect(() => parseNativeReleaseAttestation({ ...attestation, task_payload: "forbidden" })).toThrow(/forbidden/);
  });
});

describe("native release workflow guards", () => {
  test("the compact restore wrapper initializes the Codex platform before shared imports", () => {
    const source = readFileSync(resolve(__dirname, "../../hooks/codex/checkpoint-sessionstart.mjs"), "utf8");
    const platformImport = source.indexOf('import "./platform.mjs";');
    const sharedImport = source.indexOf('import("../');
    expect(platformImport).toBeGreaterThanOrEqual(0);
    expect(sharedImport).toBeGreaterThan(platformImport);
  });

  test("isolates the disposable profile and removes inherited context-mode paths", () => {
    const environment = createDisposableEnvironment("/tmp/disposable-codex-home", {
      PATH: "/usr/bin",
      CODEX_HOME: "/normal/codex-home",
      CODEX_CONFIG: "/normal/codex-config.toml",
      CONTEXT_MODE_DIR: "/normal/context-mode",
      CONTEXT_MODE_PROJECT_PATH: "/normal/project",
      CONTEXT_MODE_RELEASE_PLUGIN_ROOT: "/normal/plugin",
      CONTEXT_MODE_REPORT_PATH: "/normal/report.json",
      CONTEXT_MODE_VALIDATION_HOME: "/normal/validation",
      CONTEXT_MODE_CHECKPOINT_TRIGGER: "auto",
      OPENAI_API_KEY: "operator-controlled-provider-authorization",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/tmp/disposable-codex-home",
    });
  });

  test("scrubs provider authorization from non-runtime child environments", () => {
    expect(createNonProviderEnvironment({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "operator-controlled-provider-authorization",
      CODEX_HOME: "/normal/codex-home",
    })).toEqual({
      PATH: "/usr/bin",
      CODEX_HOME: "/normal/codex-home",
    });
  });

  test("accepts only the minimal provider projection and materializes a disposable config", () => {
    const root = mkdtempSync(join(tmpdir(), "native-release-provider-projection-"));
    try {
      const repositoryRoot = join(root, "repository");
      const projectionPath = join(root, "provider-projection.json");
      const validationHome = join(root, "codex-home");
      const projection = {
        model_provider: "local-openai",
        provider: {
          name: "Local OpenAI",
          base_url: "https://provider.example.invalid/v1",
          wire_api: "responses",
          requires_openai_auth: true,
        },
      };
      mkdirSync(repositoryRoot);
      mkdirSync(validationHome);
      writeFileSync(projectionPath, JSON.stringify(projection));
      chmodSync(projectionPath, 0o600);

      expect(loadProviderProjection(projectionPath, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: join(root, "normal-home") },
      })).toEqual(projection);
      const configPath = writeDisposableProviderConfig(validationHome, projection);
      expect(readFileSync(configPath, "utf8")).toBe([
        'model_provider = "local-openai"',
        "",
        "[model_providers.local-openai]",
        'name = "Local OpenAI"',
        'base_url = "https://provider.example.invalid/v1"',
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"));
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(validationHome)).toEqual(["config.toml"]);
      expect(() => writeDisposableProviderAuth(validationHome, {})).toThrow(/OPENAI_API_KEY/);

      const authPath = writeDisposableProviderAuth(validationHome, {
        OPENAI_API_KEY: "operator-controlled-provider-authorization",
      });
      expect(readFileSync(authPath, "utf8")).toBe(`${JSON.stringify({
        OPENAI_API_KEY: "operator-controlled-provider-authorization",
      })}\n`);
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(validationHome)).toEqual(["auth.json", "config.toml"]);
      expect(() => writeDisposableProviderAuth(validationHome, {
        OPENAI_API_KEY: "operator-controlled-provider-authorization",
      })).toThrow(/only generated provider config/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe provider projections before configuration is generated", () => {
    const root = mkdtempSync(join(tmpdir(), "native-release-provider-rejections-"));
    try {
      const repositoryRoot = join(root, "repository");
      const projectionPath = join(root, "provider-projection.json");
      const normalHome = join(root, "normal-home");
      const defaultProjection = {
        model_provider: "local-openai",
        provider: {
          name: "Local OpenAI",
          base_url: "https://provider.example.invalid/v1",
          wire_api: "responses",
          requires_openai_auth: true,
        },
      };
      const writeProjection = (value: unknown) => {
        writeFileSync(projectionPath, JSON.stringify(value));
        chmodSync(projectionPath, 0o600);
      };
      mkdirSync(repositoryRoot);

      for (const invalidProjection of [
        { ...defaultProjection, unexpected: true },
        { ...defaultProjection, provider: { ...defaultProjection.provider, extra: "state" } },
        { ...defaultProjection, model_provider: "Unsafe Provider" },
        { ...defaultProjection, provider: { ...defaultProjection.provider, name: "unsafe\nprovider" } },
        { ...defaultProjection, provider: { ...defaultProjection.provider, base_url: "http://provider.example.invalid/v1" } },
        { ...defaultProjection, provider: { ...defaultProjection.provider, base_url: "https://token@provider.example.invalid/v1" } },
        { ...defaultProjection, provider: { ...defaultProjection.provider, base_url: 'https://provider.example.invalid/"unsafe' } },
        { ...defaultProjection, provider: { ...defaultProjection.provider, wire_api: "unknown" } },
        { ...defaultProjection, provider: { ...defaultProjection.provider, requires_openai_auth: false } },
      ]) {
        writeProjection(invalidProjection);
        expect(() => loadProviderProjection(projectionPath, {
          repository: repositoryRoot,
          sourceEnvironment: { HOME: normalHome },
        })).toThrow(/provider projection/);
      }

      writeProjection(defaultProjection);
      expect(() => loadProviderProjection(projectionPath, {
        repository: root,
        sourceEnvironment: { HOME: normalHome },
      })).toThrow(/outside the repository/);

      const normalProjection = join(normalHome, ".codex", "provider-projection.json");
      mkdirSync(dirname(normalProjection), { recursive: true });
      writeFileSync(normalProjection, JSON.stringify(defaultProjection));
      chmodSync(normalProjection, 0o600);
      expect(() => loadProviderProjection(normalProjection, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: normalHome },
      })).toThrow(/normal Codex profile/);

      const configuredProfile = join(root, "configured-profile");
      const configuredProjection = join(configuredProfile, "provider-projection.json");
      mkdirSync(configuredProfile);
      writeFileSync(configuredProjection, JSON.stringify(defaultProjection));
      chmodSync(configuredProjection, 0o600);
      expect(() => loadProviderProjection(configuredProjection, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: normalHome, CODEX_HOME: configuredProfile },
      })).toThrow(/normal Codex profile/);

      const normalHomeTarget = join(root, "normal-home-target");
      const normalHomeLink = join(root, "normal-home-link");
      const targetProjection = join(normalHomeTarget, ".codex", "provider-projection.json");
      mkdirSync(dirname(targetProjection), { recursive: true });
      symlinkSync(normalHomeTarget, normalHomeLink);
      writeFileSync(targetProjection, JSON.stringify(defaultProjection));
      chmodSync(targetProjection, 0o600);
      expect(realpathSync(normalHomeLink)).toBe(normalHomeTarget);
      expect(() => loadProviderProjection(targetProjection, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: normalHomeLink },
      })).toThrow(/normal Codex profile/);

      const linkPath = join(root, "provider-projection-link.json");
      symlinkSync(projectionPath, linkPath);
      expect(() => loadProviderProjection(linkPath, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: normalHome },
      })).toThrow(/symbolic link/);

      const insecureProjection = join(root, "insecure-provider-projection.json");
      writeFileSync(insecureProjection, JSON.stringify(defaultProjection));
      expect(() => loadProviderProjection(insecureProjection, {
        repository: repositoryRoot,
        sourceEnvironment: { HOME: normalHome },
      })).toThrow(/mode 0600/);

      const validationHome = join(root, "codex-home");
      mkdirSync(validationHome);
      writeFileSync(join(validationHome, "auth.json"), "must-not-be-used");
      expect(() => writeDisposableProviderConfig(validationHome, defaultProjection)).toThrow(/must not contain profile state/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires provider authorization only from the inherited environment", () => {
    expect(() => assertProviderEnvironmentAuthorization({})).toThrow(/OPENAI_API_KEY/);
    expect(() => assertProviderEnvironmentAuthorization({ OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
    expect(() => assertProviderEnvironmentAuthorization({ OPENAI_API_KEY: "operator-controlled-provider-authorization" })).not.toThrow();
  });

  test("accepts a projection option but rejects an auth-file option", () => {
    expect(parsePreflightArguments([
      "--tag", TAG,
      "--provider-tuple", PROVIDER_TUPLE,
      "--provider-projection", "/tmp/provider-projection.json",
      "--output", "docs/releases/attestations/v1.0.176.json",
    ])).toMatchObject({ provider_projection: "/tmp/provider-projection.json" });
    expect(() => parsePreflightArguments([
      "--tag", TAG,
      "--provider-tuple", PROVIDER_TUPLE,
      "--output", "docs/releases/attestations/v1.0.176.json",
    ])).toThrow(/provider-projection/);
    expect(() => parsePreflightArguments([
      "--tag", TAG,
      "--provider-tuple", PROVIDER_TUPLE,
      "--auth-file", "/tmp/auth.json",
      "--output", "docs/releases/attestations/v1.0.176.json",
    ])).toThrow(/unsupported argument/);
  });

  test("requires an exact clean source tree", () => {
    expect(() => assertCleanSourceTree(() => " M source.ts\n")).toThrow(/clean source tree/);
    expect(() => assertCleanSourceTree(() => "?? generated.json\n")).toThrow(/clean source tree/);
    expect(() => assertCleanSourceTree(() => "")).not.toThrow();
  });

  test("restricts output to the tag-specific direct-child path without symlink traversal", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "native-release-output-"));
    try {
      expect(resolvePreflightOutput(
        repositoryRoot,
        TAG,
        "docs/releases/attestations/v1.0.176.json",
      )).toBe(join(repositoryRoot, "docs/releases/attestations/v1.0.176.json"));
      expect(() => resolvePreflightOutput(repositoryRoot, TAG, "outside.json")).toThrow(/direct-child/);

      mkdirSync(join(repositoryRoot, "docs", "releases"), { recursive: true });
      const symlinkTarget = join(repositoryRoot, "attestation-target");
      mkdirSync(symlinkTarget);
      symlinkSync(symlinkTarget, join(repositoryRoot, "docs", "releases", "attestations"));
      expect(() => resolvePreflightOutput(
        repositoryRoot,
        TAG,
        "docs/releases/attestations/v1.0.176.json",
      )).toThrow(/symbolic link/);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});

function git(repositoryRoot: string, args: string[]) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function createEvidenceRepository(extraEvidencePath?: string) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "native-release-evidence-"));
  git(repositoryRoot, ["init", "--quiet"]);
  git(repositoryRoot, ["config", "user.name", "Native Release Test"]);
  git(repositoryRoot, ["config", "user.email", "native-release@example.invalid"]);
  writeFileSync(join(repositoryRoot, "source.txt"), "source\n");
  git(repositoryRoot, ["add", "source.txt"]);
  git(repositoryRoot, ["commit", "--quiet", "-m", "source"]);
  const sourceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const attestation = makeAttestation(sourceCommit);
  const attestationPath = join(repositoryRoot, "docs/releases/attestations/v1.0.176.json");
  mkdirSync(dirname(attestationPath), { recursive: true });
  const attestationText = serializeNativeReleaseAttestation(attestation);
  writeFileSync(attestationPath, attestationText);
  git(repositoryRoot, ["add", "docs/releases/attestations/v1.0.176.json"]);
  if (extraEvidencePath) {
    writeFileSync(join(repositoryRoot, extraEvidencePath), "unrelated\n");
    git(repositoryRoot, ["add", extraEvidencePath]);
  }
  git(repositoryRoot, ["commit", "--quiet", "-m", "release evidence"]);
  const archivePath = join(repositoryRoot, "archive.tar.gz");
  const manifestPath = join(repositoryRoot, "CONTENT-MANIFEST.json");
  const tagMessagePath = join(repositoryRoot, "tag-message.txt");
  writeFileSync(archivePath, "archive");
  writeFileSync(manifestPath, "manifest");
  const boundAttestation = createNativeReleaseAttestation({
    ...attestation,
    candidate: {
      ...attestation.candidate,
      archive_sha256: sha256("archive"),
      content_manifest_sha256: sha256("manifest"),
    },
  });
  const boundText = serializeNativeReleaseAttestation(boundAttestation);
  writeFileSync(attestationPath, boundText);
  git(repositoryRoot, ["add", "docs/releases/attestations/v1.0.176.json"]);
  git(repositoryRoot, ["commit", "--quiet", "--amend", "--no-edit"]);
  const finalEvidenceCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  writeFileSync(tagMessagePath, tagMessage(boundAttestation, sha256(boundText)));
  return {
    repositoryRoot,
    sourceCommit,
    evidenceCommit: finalEvidenceCommit,
    archivePath,
    manifestPath,
    tagMessagePath,
    attestation: boundAttestation,
  };
}

describe("native release evidence commit provenance", () => {
  test("accepts an evidence commit that adds only the attestation as a direct child", () => {
    const fixture = createEvidenceRepository();
    try {
      expect(verifyNativeReleaseAttestation({
        archive: fixture.archivePath,
        attestation: "docs/releases/attestations/v1.0.176.json",
        content_manifest: fixture.manifestPath,
        evidence_commit: fixture.evidenceCommit,
        repository_root: fixture.repositoryRoot,
        source_commit: fixture.sourceCommit,
        tag: TAG,
        tag_message: fixture.tagMessagePath,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })).toEqual(fixture.attestation);
    } finally {
      rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });

  test("rejects evidence whose declared source is not its sole parent", () => {
    const fixture = createEvidenceRepository();
    try {
      expect(() => verifyNativeReleaseAttestation({
        archive: fixture.archivePath,
        attestation: "docs/releases/attestations/v1.0.176.json",
        content_manifest: fixture.manifestPath,
        evidence_commit: fixture.evidenceCommit,
        repository_root: fixture.repositoryRoot,
        source_commit: fixture.evidenceCommit,
        tag: TAG,
        tag_message: fixture.tagMessagePath,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })).toThrow(/direct child/);
    } finally {
      rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });

  test("rejects malformed source and evidence commit identifiers before Git lookup", () => {
    const fixture = createEvidenceRepository();
    try {
      expect(() => verifyNativeReleaseAttestation({
        archive: fixture.archivePath,
        attestation: "docs/releases/attestations/v1.0.176.json",
        content_manifest: fixture.manifestPath,
        evidence_commit: fixture.evidenceCommit,
        repository_root: fixture.repositoryRoot,
        source_commit: "HEAD",
        tag: TAG,
        tag_message: fixture.tagMessagePath,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })).toThrow(/40-character lowercase Git commit ID/);
      expect(() => verifyNativeReleaseAttestation({
        archive: fixture.archivePath,
        attestation: "docs/releases/attestations/v1.0.176.json",
        content_manifest: fixture.manifestPath,
        evidence_commit: "A".repeat(40),
        repository_root: fixture.repositoryRoot,
        source_commit: fixture.sourceCommit,
        tag: TAG,
        tag_message: fixture.tagMessagePath,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })).toThrow(/40-character lowercase Git commit ID/);
    } finally {
      rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });

  test("rejects an evidence commit that changes anything besides the attestation", () => {
    const fixture = createEvidenceRepository("unrelated.txt");
    try {
      expect(() => verifyNativeReleaseAttestation({
        archive: fixture.archivePath,
        attestation: "docs/releases/attestations/v1.0.176.json",
        content_manifest: fixture.manifestPath,
        evidence_commit: fixture.evidenceCommit,
        repository_root: fixture.repositoryRoot,
        source_commit: fixture.sourceCommit,
        tag: TAG,
        tag_message: fixture.tagMessagePath,
        now: new Date("2026-08-01T12:00:00.000Z"),
      })).toThrow(/add only/);
    } finally {
      rmSync(fixture.repositoryRoot, { recursive: true, force: true });
    }
  });
});
