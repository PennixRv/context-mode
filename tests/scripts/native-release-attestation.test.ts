import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  createDisposableEnvironment,
  resolvePreflightOutput,
} from "../../scripts/run-codex-native-release-preflight.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ARCHIVE_SHA256 = "a".repeat(64);
const MANIFEST_SHA256 = "b".repeat(64);
const OPAQUE_SHA256 = "c".repeat(64);
const TAG = "v1.0.176";
const CREATED_AT = "2026-08-01T00:00:00.000Z";

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
      provider_tuple: "codex-0.145.0-local",
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
      provider_tuple: "codex-0.145.0-local",
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
      OPENAI_API_KEY: "operator-controlled-provider-authorization",
    });
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
