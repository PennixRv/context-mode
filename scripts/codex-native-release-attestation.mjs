import { createHash } from "node:crypto";

export const NATIVE_RELEASE_ATTESTATION_SCHEMA_VERSION = 1;
export const NATIVE_RELEASE_DELIVERY_SCOPE = "same-session delivery only";
export const NATIVE_RELEASE_ATTESTATION_DIRECTORY = "docs/releases/attestations";
export const NATIVE_RELEASE_TAG_METADATA_PREFIX = "Codex-Native-Delivery-Attestation:";
export const SUPPORTED_CODEX_CLI_VERSION = "0.146.0";
export const SUPPORTED_NODE_VERSION = "26.5.0";
export const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const TAG_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PROVIDER_TUPLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;
const ATTESTATION_PATH_PATTERN =
  /^docs\/releases\/attestations\/(v[0-9]+\.[0-9]+\.[0-9]+)\.json$/;
const FORBIDDEN_FIELD_PATTERN =
  /auth|credential|secret|token|password|prompt|response|transcript|session|thread|payload|recovery|trellis|journal|tool/i;
const REQUIRED_LIFECYCLE = ["pending", "confirmed", "claimed"];
const TAG_METADATA_FIELDS = [
  "path",
  "raw_sha256",
  "attestation_sha256",
  "tag",
  "version",
  "source_commit",
  "archive_sha256",
  "content_manifest_sha256",
  "node_version",
  "codex_cli_version",
  "provider_tuple",
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function nativeReleaseAttestationPath(tag) {
  requireString(tag, "tag", TAG_PATTERN);
  return `${NATIVE_RELEASE_ATTESTATION_DIRECTORY}/${tag}.json`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(value, keys, description) {
  if (!isRecord(value)) throw new Error(`${description} must be an object`);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${description} has unsupported fields`);
  }
  return value;
}

function requireString(value, description, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${description} is invalid`);
  }
  return value;
}

function requireIsoTimestamp(value, description) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${description} must be an ISO timestamp`);
  }
  if (new Date(value).toISOString() !== value) {
    throw new Error(`${description} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireLifecycle(value, description) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(REQUIRED_LIFECYCLE)) {
    throw new Error(`${description} must be pending, confirmed, claimed`);
  }
  return [...value];
}

function requireTrigger(value, description) {
  const trigger = requireExactKeys(value, [
    "lifecycle",
    "opaque_id_attestation_sha256",
    "status",
    "terminal_state",
  ], description);
  if (trigger.status !== "passed") throw new Error(`${description}.status must be passed`);
  if (trigger.terminal_state !== "claimed") {
    throw new Error(`${description}.terminal_state must be claimed`);
  }
  return {
    status: "passed",
    lifecycle: requireLifecycle(trigger.lifecycle, `${description}.lifecycle`),
    terminal_state: "claimed",
    opaque_id_attestation_sha256: requireString(
      trigger.opaque_id_attestation_sha256,
      `${description}.opaque_id_attestation_sha256`,
      SHA256_PATTERN,
    ),
  };
}

function requireCandidate(value) {
  const candidate = requireExactKeys(value, [
    "archive_sha256",
    "source_commit",
    "content_manifest_sha256",
    "tag",
    "version",
  ], "candidate");
  const tag = requireString(candidate.tag, "candidate.tag", TAG_PATTERN);
  const version = requireString(candidate.version, "candidate.version", VERSION_PATTERN);
  if (tag !== `v${version}`) throw new Error("candidate.tag must match candidate.version");
  return {
    tag,
    version,
    source_commit: requireString(candidate.source_commit, "candidate.source_commit", COMMIT_PATTERN),
    archive_sha256: requireString(candidate.archive_sha256, "candidate.archive_sha256", SHA256_PATTERN),
    content_manifest_sha256: requireString(
      candidate.content_manifest_sha256,
      "candidate.content_manifest_sha256",
      SHA256_PATTERN,
    ),
  };
}

function requireEnvironment(value) {
  const environment = requireExactKeys(value, [
    "codex_cli_version",
    "node_version",
    "provider_tuple",
  ], "environment");
  const providerTuple = validateNativeReleaseProviderTuple(environment.provider_tuple);
  return {
    node_version: requireString(environment.node_version, "environment.node_version", VERSION_PATTERN),
    codex_cli_version: requireString(
      environment.codex_cli_version,
      "environment.codex_cli_version",
      VERSION_PATTERN,
    ),
    provider_tuple: providerTuple,
  };
}

export function validateNativeReleaseProviderTuple(value) {
  const providerTuple = requireString(value, "environment.provider_tuple", PROVIDER_TUPLE_PATTERN);
  if (FORBIDDEN_FIELD_PATTERN.test(providerTuple)) {
    throw new Error("environment.provider_tuple must not contain sensitive identifiers");
  }
  return providerTuple;
}

function attestationPayload(value) {
  return {
    schema_version: value.schema_version,
    scope: value.scope,
    created_at: value.created_at,
    candidate: value.candidate,
    environment: value.environment,
    triggers: value.triggers,
  };
}

export function canonicalAttestationPayload(value) {
  const parsed = parseNativeReleaseAttestation(value);
  return attestationPayload(parsed);
}

export function serializeNativeReleaseAttestation(value) {
  const parsed = parseNativeReleaseAttestation(value);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function validateForbiddenContent(value, path = "attestation") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateForbiddenContent(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_PATTERN.test(key) && key !== "opaque_id_attestation_sha256") {
      throw new Error(`${path}.${key} is forbidden`);
    }
    validateForbiddenContent(nested, `${path}.${key}`);
  }
}

export function createNativeReleaseAttestation(input) {
  const payload = {
    schema_version: NATIVE_RELEASE_ATTESTATION_SCHEMA_VERSION,
    scope: NATIVE_RELEASE_DELIVERY_SCOPE,
    created_at: input.created_at,
    candidate: requireCandidate(input.candidate),
    environment: requireEnvironment(input.environment),
    triggers: (() => {
      const triggers = requireExactKeys(input.triggers, ["automatic", "manual"], "triggers");
      return {
        manual: requireTrigger(triggers.manual, "triggers.manual"),
        automatic: requireTrigger(triggers.automatic, "triggers.automatic"),
      };
    })(),
  };
  return parseNativeReleaseAttestation({
    ...payload,
    attestation_sha256: sha256(JSON.stringify(payload)),
  });
}

export function parseNativeReleaseAttestation(value) {
  validateForbiddenContent(value);
  const attestation = requireExactKeys(value, [
    "attestation_sha256",
    "candidate",
    "created_at",
    "environment",
    "schema_version",
    "scope",
    "triggers",
  ], "attestation");
  if (attestation.schema_version !== NATIVE_RELEASE_ATTESTATION_SCHEMA_VERSION) {
    throw new Error("attestation.schema_version is unsupported");
  }
  if (attestation.scope !== NATIVE_RELEASE_DELIVERY_SCOPE) {
    throw new Error("attestation.scope must remain same-session delivery only");
  }
  const parsed = {
    schema_version: NATIVE_RELEASE_ATTESTATION_SCHEMA_VERSION,
    scope: NATIVE_RELEASE_DELIVERY_SCOPE,
    created_at: requireIsoTimestamp(attestation.created_at, "attestation.created_at"),
    candidate: requireCandidate(attestation.candidate),
    environment: requireEnvironment(attestation.environment),
    triggers: (() => {
      const triggers = requireExactKeys(attestation.triggers, ["automatic", "manual"], "triggers");
      return {
        manual: requireTrigger(triggers.manual, "triggers.manual"),
        automatic: requireTrigger(triggers.automatic, "triggers.automatic"),
      };
    })(),
  };
  const expectedDigest = sha256(JSON.stringify(attestationPayload(parsed)));
  if (attestation.attestation_sha256 !== expectedDigest) {
    throw new Error("attestation.attestation_sha256 does not match its canonical payload");
  }
  return { ...parsed, attestation_sha256: expectedDigest };
}

function parseTagMetadataFields(line) {
  const body = line.slice(NATIVE_RELEASE_TAG_METADATA_PREFIX.length).trim();
  const fields = {};
  for (const token of body.split(/\s+/)) {
    const separator = token.indexOf("=");
    if (separator <= 0 || separator === token.length - 1) {
      throw new Error("native attestation tag metadata must use key=value fields");
    }
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (fields[key] !== undefined) throw new Error(`duplicate native attestation tag field: ${key}`);
    fields[key] = value;
  }
  const actualKeys = Object.keys(fields).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...TAG_METADATA_FIELDS].sort())) {
    throw new Error("native attestation tag metadata has missing or unsupported fields");
  }
  return fields;
}

export function parseNativeReleaseTagMetadata(tagMessage) {
  const lines = String(tagMessage).split(/\r?\n/);
  const nativeLines = lines.filter((line) => /^Codex-Native-Delivery-Attestation(?::|-)/.test(line));
  if (nativeLines.length !== 1 || !nativeLines[0].startsWith(NATIVE_RELEASE_TAG_METADATA_PREFIX)) {
    throw new Error("annotated tag must contain exactly one native attestation metadata line");
  }
  const fields = parseTagMetadataFields(nativeLines[0]);
  const pathMatch = fields.path.match(ATTESTATION_PATH_PATTERN);
  if (!pathMatch) throw new Error("native attestation path must be a direct child of docs/releases/attestations");
  const tag = requireString(fields.tag, "tag metadata tag", TAG_PATTERN);
  const version = requireString(fields.version, "tag metadata version", VERSION_PATTERN);
  if (tag !== `v${version}` || pathMatch[1] !== tag) {
    throw new Error("native attestation tag, version, and path must agree");
  }
  return {
    path: fields.path,
    raw_sha256: requireString(fields.raw_sha256, "tag metadata raw_sha256", SHA256_PATTERN),
    attestation_sha256: requireString(
      fields.attestation_sha256,
      "tag metadata attestation_sha256",
      SHA256_PATTERN,
    ),
    tag,
    version,
    source_commit: requireString(fields.source_commit, "tag metadata source_commit", COMMIT_PATTERN),
    archive_sha256: requireString(fields.archive_sha256, "tag metadata archive_sha256", SHA256_PATTERN),
    content_manifest_sha256: requireString(
      fields.content_manifest_sha256,
      "tag metadata content_manifest_sha256",
      SHA256_PATTERN,
    ),
    node_version: requireString(fields.node_version, "tag metadata node_version", VERSION_PATTERN),
    codex_cli_version: requireString(
      fields.codex_cli_version,
      "tag metadata codex_cli_version",
      VERSION_PATTERN,
    ),
    provider_tuple: (() => {
      const providerTuple = requireString(fields.provider_tuple, "tag metadata provider_tuple", PROVIDER_TUPLE_PATTERN);
      if (FORBIDDEN_FIELD_PATTERN.test(providerTuple)) {
        throw new Error("tag metadata provider_tuple must not contain sensitive identifiers");
      }
      return providerTuple;
    })(),
  };
}

export function formatNativeReleaseTagMetadata(attestation, rawSha256) {
  const parsed = parseNativeReleaseAttestation(attestation);
  const rawDigest = requireString(rawSha256, "raw_sha256", SHA256_PATTERN);
  return [
    NATIVE_RELEASE_TAG_METADATA_PREFIX,
    `path=${nativeReleaseAttestationPath(parsed.candidate.tag)}`,
    `raw_sha256=${rawDigest}`,
    `attestation_sha256=${parsed.attestation_sha256}`,
    `tag=${parsed.candidate.tag}`,
    `version=${parsed.candidate.version}`,
    `source_commit=${parsed.candidate.source_commit}`,
    `archive_sha256=${parsed.candidate.archive_sha256}`,
    `content_manifest_sha256=${parsed.candidate.content_manifest_sha256}`,
    `node_version=${parsed.environment.node_version}`,
    `codex_cli_version=${parsed.environment.codex_cli_version}`,
    `provider_tuple=${parsed.environment.provider_tuple}`,
  ].join(" ");
}

export function validateNativeReleaseAttestationBinding(attestationValue, options) {
  const attestation = parseNativeReleaseAttestation(attestationValue);
  const tagMetadata = parseNativeReleaseTagMetadata(options.tag_message);
  const expected = {
    tag: requireString(options.tag, "tag", TAG_PATTERN),
    sourceCommit: requireString(options.source_commit, "source_commit", COMMIT_PATTERN),
    evidenceCommit: requireString(options.evidence_commit, "evidence_commit", COMMIT_PATTERN),
    archiveSha256: requireString(options.archive_sha256, "archive_sha256", SHA256_PATTERN),
    contentManifestSha256: requireString(
      options.content_manifest_sha256,
      "content_manifest_sha256",
      SHA256_PATTERN,
    ),
    attestationFileSha256: requireString(
      options.attestation_file_sha256,
      "attestation_file_sha256",
      SHA256_PATTERN,
    ),
    attestationPath: options.attestation_path ?? nativeReleaseAttestationPath(options.tag),
  };
  if (expected.attestationPath !== tagMetadata.path) {
    throw new Error("native attestation tag path does not match the tracked evidence path");
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const createdAt = Date.parse(attestation.created_at);
  if (createdAt > now.getTime() + 5 * 60 * 1_000 || now.getTime() - createdAt > MAX_ATTESTATION_AGE_MS) {
    throw new Error("native release attestation is stale or has an invalid creation time");
  }
  if (tagMetadata.raw_sha256 !== expected.attestationFileSha256) {
    throw new Error("annotated tag raw attestation SHA-256 does not match the tracked attestation file");
  }
  if (tagMetadata.attestation_sha256 !== attestation.attestation_sha256) {
    throw new Error("annotated tag canonical attestation digest does not match the attestation payload");
  }
  if (expected.sourceCommit === expected.evidenceCommit) {
    throw new Error("native release source and evidence commits must be distinct");
  }
  if (attestation.candidate.tag !== expected.tag || attestation.candidate.source_commit !== expected.sourceCommit) {
    throw new Error("native release attestation candidate tag or source commit does not match the release tag");
  }
  if (attestation.candidate.archive_sha256 !== expected.archiveSha256) {
    throw new Error("native release attestation archive SHA-256 does not match the rebuilt release asset");
  }
  if (attestation.candidate.content_manifest_sha256 !== expected.contentManifestSha256) {
    throw new Error("native release attestation content-manifest SHA-256 does not match the rebuilt release asset");
  }
  if (attestation.environment.node_version !== SUPPORTED_NODE_VERSION) {
    throw new Error("native release attestation Node version is not the supported tuple");
  }
  if (attestation.environment.codex_cli_version !== SUPPORTED_CODEX_CLI_VERSION) {
    throw new Error("native release attestation Codex CLI version is not the supported tuple");
  }
  for (const [field, value] of [
    ["tag", attestation.candidate.tag],
    ["version", attestation.candidate.version],
    ["source_commit", attestation.candidate.source_commit],
    ["archive_sha256", attestation.candidate.archive_sha256],
    ["content_manifest_sha256", attestation.candidate.content_manifest_sha256],
    ["node_version", attestation.environment.node_version],
    ["codex_cli_version", attestation.environment.codex_cli_version],
    ["provider_tuple", attestation.environment.provider_tuple],
  ]) {
    if (tagMetadata[field] !== value) throw new Error(`annotated tag ${field} does not match the attestation`);
  }
  return attestation;
}
