import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(__dirname, "../../.github/workflows/release.yml");

describe("release workflow fork-ref contract", () => {
  test("fetches and validates origin/devel before checkout and package work", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const fetchRefspec = "devel:refs/remotes/origin/devel";
    const annotationCheck = workflow.indexOf('git cat-file -t "refs/tags/$tag_name"');
    const annotationFailure = workflow.indexOf("Release tags must be annotated");
    const validatorInvocation = workflow.indexOf(
      'node scripts/validate-fork-release-tag.mjs "$tag_name"',
    );
    const directChildCheck = workflow.indexOf('parents -n 1 "$evidence_commit"');
    const evidenceDiffCheck = workflow.indexOf('name-status -r "$source_commit" "$evidence_commit"');
    const detachedCheckout = workflow.indexOf('git checkout --detach "$evidence_commit"');
    const dependencyInstall = workflow.indexOf("Install dependencies");
    const archiveBuild = workflow.indexOf("Build and verify release assets");

    expect(workflow).toContain(`"${fetchRefspec}"`);
    expect(workflow).not.toContain("main:refs/remotes/origin/main");
    expect(workflow).not.toMatch(
      /git merge-base --is-ancestor[^\n]*origin\/main/,
    );
    expect(workflow).not.toMatch(/validate-fork-release-tag\.mjs[^\n]*--ref/);
    expect(annotationCheck).toBeGreaterThanOrEqual(0);
    expect(annotationFailure).toBeGreaterThan(annotationCheck);
    expect(validatorInvocation).toBeGreaterThan(annotationFailure);
    expect(directChildCheck).toBeGreaterThan(validatorInvocation);
    expect(evidenceDiffCheck).toBeGreaterThan(directChildCheck);
    expect(detachedCheckout).toBeGreaterThan(validatorInvocation);
    expect(detachedCheckout).toBeGreaterThan(evidenceDiffCheck);
    expect(dependencyInstall).toBeGreaterThan(validatorInvocation);
    expect(dependencyInstall).toBeGreaterThan(detachedCheckout);
    expect(archiveBuild).toBeGreaterThan(dependencyInstall);
  });

  test("checks the tracked native attestation before creating a GitHub release", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const archiveBuild = workflow.indexOf("Build and verify release assets");
    const nativeCheck = workflow.indexOf("Verify immutable native compact attestation");
    const releaseCreate = workflow.indexOf("Create GitHub Release");

    expect(nativeCheck).toBeGreaterThan(archiveBuild);
    expect(releaseCreate).toBeGreaterThan(nativeCheck);
    expect(workflow).toContain("scripts/verify-codex-native-release-attestation.mjs");
    expect(workflow).toContain("--repository-root \"$GITHUB_WORKSPACE\"");
    expect(workflow).toContain('--source-commit "${{ steps.release_tag.outputs.source_commit }}"');
    expect(workflow).toContain('--evidence-commit "${{ steps.release_tag.outputs.evidence_commit }}"');
    expect(workflow).not.toContain('git checkout --detach "$source_commit"');
    expect(workflow).toContain("docs/releases/attestations/${{ steps.release_tag.outputs.tag_name }}.json");
    expect(workflow).not.toContain("run-codex-native-release-preflight.mjs");
  });
});
