#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  nativeReleaseAttestationPath,
  parseNativeReleaseTagMetadata,
  sha256,
  validateNativeReleaseAttestationBinding,
} from "./codex-native-release-attestation.mjs";

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
  for (const key of [
    "archive",
    "attestation",
    "content_manifest",
    "evidence_commit",
    "repository_root",
    "source_commit",
    "tag",
    "tag_message",
  ]) {
    if (!options[key]) throw new Error(`--${key.replace(/_/g, "-")} is required`);
  }
  return options;
}

function readJsonText(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${description} is invalid JSON`);
  }
}

function requireCommit(value, optionName) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${optionName} must be a 40-character lowercase Git commit ID`);
  }
  return value;
}

function isInside(parentPath, candidatePath) {
  const pathRelative = relative(parentPath, candidatePath);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function runGit(repositoryRoot, args, description, encoding = "utf8") {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(description);
  }
}

function requireEvidenceCommit(repositoryRoot, sourceCommit, evidenceCommit, relativeAttestationPath) {
  if (!existsSync(resolve(repositoryRoot, ".git"))) {
    throw new Error("--repository-root must be a Git worktree when checking tracked attestation evidence");
  }
  const parents = runGit(
    repositoryRoot,
    ["show", "-s", "--format=%P", evidenceCommit],
    "native release evidence commit cannot be resolved",
  ).trim().split(/\s+/).filter(Boolean);
  if (parents.length !== 1 || parents[0] !== sourceCommit) {
    throw new Error("native release evidence commit must be a direct child of the source commit");
  }
  const changes = runGit(
    repositoryRoot,
    ["diff-tree", "--no-commit-id", "--name-status", "-r", sourceCommit, evidenceCommit],
    "native release evidence commit diff cannot be inspected",
  ).trim();
  if (changes !== `A\t${relativeAttestationPath}`) {
    throw new Error("native release evidence commit must add only the release attestation");
  }
  const treeEntry = runGit(
    repositoryRoot,
    ["ls-tree", evidenceCommit, "--", relativeAttestationPath],
    "native release attestation tree entry cannot be inspected",
  ).trim();
  if (!/^100644 blob [a-f0-9]{40}\t/.test(treeEntry)) {
    throw new Error("native release attestation must be a regular tracked file");
  }
  return runGit(
    repositoryRoot,
    ["show", `${evidenceCommit}:${relativeAttestationPath}`],
    "native release attestation is not tracked by the evidence commit",
    null,
  );
}

function readAttestation(options, tagMetadata) {
  const repositoryRoot = resolve(options.repository_root ?? process.cwd());
  const attestationPath = resolve(repositoryRoot, options.attestation);
  if (!isInside(repositoryRoot, attestationPath)) {
    throw new Error("native release attestation must stay below --repository-root");
  }
  const relativeAttestationPath = relative(repositoryRoot, attestationPath).split(sep).join("/");
  const expectedPath = nativeReleaseAttestationPath(options.tag);
  if (relativeAttestationPath !== expectedPath || relativeAttestationPath !== tagMetadata.path) {
    throw new Error("native release attestation must use the direct-child tracked evidence path for the release tag");
  }
  const trackedBytes = requireEvidenceCommit(
    repositoryRoot,
    options.source_commit,
    options.evidence_commit,
    relativeAttestationPath,
  );
  return { bytes: trackedBytes, text: trackedBytes.toString("utf8"), path: relativeAttestationPath };
}

export function verifyNativeReleaseAttestation(options) {
  const sourceCommit = requireCommit(options.source_commit, "--source-commit");
  const evidenceCommit = requireCommit(options.evidence_commit, "--evidence-commit");
  const tagMessage = readFileSync(resolve(options.tag_message), "utf8");
  const tagMetadata = parseNativeReleaseTagMetadata(tagMessage);
  const attestation = readAttestation({
    ...options,
    source_commit: sourceCommit,
    evidence_commit: evidenceCommit,
  }, tagMetadata);
  return validateNativeReleaseAttestationBinding(
    readJsonText(attestation.text, "native release attestation"),
    {
      tag: options.tag,
      source_commit: sourceCommit,
      evidence_commit: evidenceCommit,
      archive_sha256: sha256(readFileSync(resolve(options.archive))),
      content_manifest_sha256: sha256(readFileSync(resolve(options.content_manifest))),
      attestation_file_sha256: sha256(attestation.bytes),
      attestation_path: attestation.path,
      tag_message: tagMessage,
      now: options.now instanceof Date ? options.now : new Date(),
    },
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const attestation = verifyNativeReleaseAttestation(options);
  console.log(JSON.stringify({
    tag: attestation.candidate.tag,
    sourceCommit: attestation.candidate.source_commit,
    evidenceCommit: options.evidence_commit,
    archiveSha256: attestation.candidate.archive_sha256,
    contentManifestSha256: attestation.candidate.content_manifest_sha256,
    scope: attestation.scope,
    triggers: ["manual", "automatic"],
  }, null, 2));
}

const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) main();
