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
    const detachedCheckout = workflow.indexOf('git checkout --detach "$tag_commit"');
    const dependencyInstall = workflow.indexOf("Install dependencies");

    expect(workflow).toContain(`"${fetchRefspec}"`);
    expect(workflow).not.toContain("main:refs/remotes/origin/main");
    expect(workflow).not.toMatch(
      /git merge-base --is-ancestor[^\n]*origin\/main/,
    );
    expect(workflow).not.toMatch(/validate-fork-release-tag\.mjs[^\n]*--ref/);
    expect(annotationCheck).toBeGreaterThanOrEqual(0);
    expect(annotationFailure).toBeGreaterThan(annotationCheck);
    expect(validatorInvocation).toBeGreaterThan(annotationFailure);
    expect(detachedCheckout).toBeGreaterThan(validatorInvocation);
    expect(dependencyInstall).toBeGreaterThan(validatorInvocation);
  });
});
