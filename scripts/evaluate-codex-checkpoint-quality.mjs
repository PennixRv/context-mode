#!/usr/bin/env node
// Isolated, release-candidate evaluation for observable checkpoint facts.
//
// This harness intentionally does not run in ordinary user sessions. It drives
// the same real Codex compaction lifecycle as the delivery attestation, then
// scores a no-tool JSON probe against the exact context projection produced by
// the installed release payload. Reports retain hashes and field outcomes only.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createReport,
  resolveOptions,
  run,
} from "./validate-codex-checkpoint-delivery.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(repositoryRoot, "scripts", "fixtures", "checkpoint-quality");
const DEFAULT_FIXTURE_PATH = join(fixtureRoot, "v1", "observable-facts.json");
const QUALITY_FIELDS = new Set([
  "checkpoint_id",
  "payload_sha256",
  "trigger",
  "project",
  "git",
  "trellis",
  "recovery_brief",
]);
const NOT_OBSERVABLE_FIELDS = new Set([
  "goal",
  "decision",
  "constraint",
  "blocker",
  "next_action",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(parentPath, candidatePath) {
  const pathRelative = relative(parentPath, candidatePath);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function requireRegularFile(path, description) {
  if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error(`${description} must be a materialized regular file`);
  }
}

function readFixture(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`checkpoint quality fixture is invalid JSON: ${message}`);
  }
}

function validateStringList(value, name, allowedValues) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
    throw new Error(`${name} must be a non-empty array of unique strings`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !allowedValues.has(item)) {
      throw new Error(`${name} contains an unsupported field`);
    }
  }
}

export function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw new Error("checkpoint quality fixture must be an object");
  }
  if (fixture.schema_version !== 1) {
    throw new Error("checkpoint quality fixture schema_version must be 1");
  }
  if (typeof fixture.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(fixture.id)) {
    throw new Error("checkpoint quality fixture id is invalid");
  }
  validateStringList(fixture.fields, "checkpoint quality fixture fields", QUALITY_FIELDS);
  validateStringList(
    fixture.not_observable,
    "checkpoint quality fixture not_observable",
    NOT_OBSERVABLE_FIELDS,
  );
  return fixture;
}

export function resolveQualityOptions(environment = process.env) {
  const deliveryOptions = resolveOptions();
  const fixturePath = resolve(
    environment.CONTEXT_MODE_CHECKPOINT_QUALITY_FIXTURE_PATH ?? DEFAULT_FIXTURE_PATH,
  );
  const reportPath = resolve(
    environment.CONTEXT_MODE_CHECKPOINT_QUALITY_REPORT_PATH
      ?? join(deliveryOptions.validationHome, "checkpoint-quality-report.json"),
  );

  if (!isInside(fixtureRoot, fixturePath)) {
    throw new Error("CONTEXT_MODE_CHECKPOINT_QUALITY_FIXTURE_PATH must stay inside scripts/fixtures/checkpoint-quality");
  }
  if (!isInside(deliveryOptions.validationHome, reportPath)) {
    throw new Error("CONTEXT_MODE_CHECKPOINT_QUALITY_REPORT_PATH must stay inside CONTEXT_MODE_VALIDATION_HOME");
  }
  requireRegularFile(fixturePath, "CONTEXT_MODE_CHECKPOINT_QUALITY_FIXTURE_PATH");

  return {
    deliveryOptions,
    fixture: validateFixture(readFixture(fixturePath)),
    fixturePath,
    reportPath,
  };
}

export function parseInjectedContext(additionalContext) {
  if (typeof additionalContext !== "string") {
    throw new Error("installed release did not produce checkpoint context");
  }
  const match = additionalContext.match(/```json\n([\s\S]+)\n```$/);
  if (!match) {
    throw new Error("installed release checkpoint context did not contain JSON");
  }
  return JSON.parse(match[1]);
}

async function projectInstalledCheckpoint(releasePluginRoot, checkpointRow) {
  const runtimePath = join(releasePluginRoot, "hooks", "checkpoint.bundle.mjs");
  requireRegularFile(runtimePath, "installed release checkpoint runtime");
  const checkpointRuntime = await import(pathToFileURL(runtimePath).href);
  const fitContextDelivery = checkpointRuntime.checkpointInternals?.fitContextDelivery;
  if (typeof fitContextDelivery !== "function") {
    throw new Error("installed release checkpoint runtime does not expose the expected projection helper");
  }

  const payload = JSON.parse(checkpointRow.payload_json);
  const delivery = fitContextDelivery(payload, checkpointRow);
  return {
    context: parseInjectedContext(delivery.additionalContext),
    emittedBytes: delivery.emittedBytes,
    projectionMode: delivery.projectionMode,
  };
}

function observedValue(context, field) {
  return Object.hasOwn(context, field) ? context[field] : "unknown";
}

export function buildExpectedResponse(context, fixture) {
  const expected = {};
  for (const field of fixture.fields) {
    expected[field] = observedValue(context, field);
  }
  expected.unknown = Object.fromEntries(
    fixture.not_observable.map((field) => [field, "unknown"]),
  );
  return expected;
}

export function buildProbePrompt(fixture) {
  const fieldList = [...fixture.fields, "unknown"].map((field) => `"${field}"`).join(", ");
  const unknownFields = fixture.not_observable.map((field) => `"${field}":"unknown"`).join(",");
  return [
    "Without using tools, files, or external retrieval, return exactly one minified JSON object and no prose.",
    `Its top-level keys must be exactly ${fieldList}.`,
    "For an observable field missing from the historical confirmed checkpoint context, use the string \"unknown\".",
    `Its \"unknown\" object must be exactly {${unknownFields}}.`,
    "Do not infer or fabricate task goals, decisions, constraints, blockers, or next actions.",
  ].join(" ");
}

function compareValue(expected, actual, field, fieldResults) {
  if (Object.is(expected, actual)) {
    fieldResults.push({ field, status: "passed" });
    return true;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      fieldResults.push({ field, status: "failed" });
      return false;
    }
    return expected.every((value, index) => compareValue(value, actual[index], `${field}[${index}]`, fieldResults));
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
      fieldResults.push({ field, status: "failed" });
      return false;
    }
    return expectedKeys.every((key) => compareValue(expected[key], actual[key], `${field}.${key}`, fieldResults));
  }
  fieldResults.push({ field, status: "failed" });
  return false;
}

export function evaluateProbeResponse(responseText, expected) {
  const fieldResults = [];
  let actual;
  try {
    actual = JSON.parse(responseText);
  } catch {
    return { fieldResults, parsedJson: false, passed: false };
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return { fieldResults, parsedJson: true, passed: false };
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    return { fieldResults, parsedJson: true, passed: false };
  }
  const passed = expectedKeys.every((field) => compareValue(expected[field], actual[field], field, fieldResults));
  return { fieldResults, parsedJson: true, passed };
}

export function createQualityReport(options) {
  return {
    schemaVersion: 1,
    status: "running",
    fixture: {
      id: options.fixture.id,
      sha256: sha256(readFileSync(options.fixturePath)),
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      trigger: options.deliveryOptions.trigger,
      releaseVersion: options.deliveryOptions.releaseVersion,
      releaseSha256: sha256(options.deliveryOptions.releasePluginRoot),
    },
    checkpoint: null,
    probe: null,
    error: null,
  };
}

export function writeQualityReport(reportPath, report) {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}

function createQualityVerification(options, qualityReport) {
  return {
    prompt: buildProbePrompt(options.fixture),
    async verifyResponse({ assistantResponse, checkpointEvidence, itemTypes, unexpectedItemTypes }) {
      const projection = await projectInstalledCheckpoint(
        options.deliveryOptions.releasePluginRoot,
        checkpointEvidence.checkpoint,
      );
      const expected = buildExpectedResponse(projection.context, options.fixture);
      const evaluation = evaluateProbeResponse(assistantResponse, expected);
      const unexpectedItems = unexpectedItemTypes.length > 0;

      qualityReport.checkpoint = {
        checkpointIdSha256: sha256(checkpointEvidence.checkpoint.checkpoint_id),
        payloadSha256: checkpointEvidence.checkpoint.payload_sha256,
        projectionMode: projection.projectionMode,
        emittedBytes: projection.emittedBytes,
      };
      qualityReport.probe = {
        expectedSha256: sha256(JSON.stringify(expected)),
        responseSha256: sha256(assistantResponse),
        responseBytes: Buffer.byteLength(assistantResponse, "utf8"),
        parsedJson: evaluation.parsedJson,
        fieldResults: evaluation.fieldResults,
        observedItemTypes: itemTypes,
        noToolContractSatisfied: !unexpectedItems,
      };

      return {
        attestation: {
          assistantResponseLength: Buffer.byteLength(assistantResponse, "utf8"),
          assistantResponseSha256: sha256(assistantResponse),
          matchesCheckpointId: null,
          observedItemTypes: itemTypes,
          unexpectedItemTypes,
        },
        error: evaluation.passed && !unexpectedItems
          ? null
          : "checkpoint quality probe did not satisfy the no-tool response contract",
      };
    },
  };
}

async function main() {
  const options = resolveQualityOptions();
  const qualityReport = createQualityReport(options);
  const deliveryReport = createReport(options.deliveryOptions);
  writeQualityReport(options.reportPath, qualityReport);

  try {
    await run(
      options.deliveryOptions,
      deliveryReport,
      createQualityVerification(options, qualityReport),
    );
    qualityReport.status = "passed";
  } catch (error) {
    qualityReport.status = "failed";
    qualityReport.error = error instanceof Error ? error.message : String(error);
  }

  writeQualityReport(options.reportPath, qualityReport);
  if (qualityReport.status !== "passed") {
    process.exitCode = 1;
  }
}

const isDirectInvocation =
  process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  await main();
}
