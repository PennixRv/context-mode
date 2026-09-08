import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(__dirname, "../../.github/workflows/release.yml");
const ciWorkflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
const bundleWorkflowPath = resolve(__dirname, "../../.github/workflows/bundle.yml");
const tierTwoWorkflowPath = resolve(__dirname, "../../.github/workflows/tier2-e2e-smoke.yml");
const openClawWorkflowPath = resolve(__dirname, "../../.github/workflows/openclaw-e2e.yml");
const packageJsonPath = resolve(__dirname, "../../package.json");

function readWorkflowEventBranches(workflow: string, event: "push" | "pull_request"): string[] {
  const eventBranches = workflow.match(
    new RegExp(`^  ${event}:\\n    branches: \\[([^\\]]+)\\]`, "m"),
  );

  expect(eventBranches, `expected ${event} branch filter`).not.toBeNull();
  return eventBranches![1].split(",").map((branch) => branch.trim());
}

describe("release workflow fork-ref contract", () => {
  test("uses the latest Node and Codex runtimes for release asset verification", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("node-version: latest");
    expect(workflow).not.toContain('node-version: "26.5.0"');
    expect(workflow).toContain("npm install --global @openai/codex@latest");
    expect(workflow).not.toContain("@openai/codex@0.146.0");
    expect(workflow).not.toContain("pinned Codex CLI");
  });

  test("keeps all build and installed-asset workflows current without unsafe native cache reuse", () => {
    const ciWorkflow = readFileSync(ciWorkflowPath, "utf8");
    const bundleWorkflow = readFileSync(bundleWorkflowPath, "utf8");
    const tierTwoWorkflow = readFileSync(tierTwoWorkflowPath, "utf8");
    const openClawWorkflow = readFileSync(openClawWorkflowPath, "utf8");

    for (const workflow of [ciWorkflow, bundleWorkflow, tierTwoWorkflow, openClawWorkflow]) {
      expect(workflow).not.toContain("22.23.2");
      expect(workflow).not.toContain("0.145.0");
    }
    expect(ciWorkflow).toContain("node-version: latest");
    expect(ciWorkflow).toContain("npm install --global @openai/codex@latest");
    expect(bundleWorkflow).toContain("node-version: latest");
    expect(tierTwoWorkflow).toContain("NODE_VERSION: latest");
    expect(openClawWorkflow).toContain("NODE_VERSION: latest");
    expect(openClawWorkflow).toContain("id: node_version");
    expect(openClawWorkflow).toContain("steps.node_version.outputs.value");
  });

  test("runs ordinary development checks for the fork devel branch", () => {
    const workflows = [
      {
        name: "CI",
        workflow: readFileSync(ciWorkflowPath, "utf8"),
        branches: ["main", "next", "devel"],
      },
      {
        name: "bundle drift",
        workflow: readFileSync(bundleWorkflowPath, "utf8"),
        branches: ["main", "devel"],
      },
      {
        name: "OpenClaw E2E",
        workflow: readFileSync(openClawWorkflowPath, "utf8"),
        branches: ["main", "next", "devel"],
      },
    ];

    for (const { name, workflow, branches } of workflows) {
      expect(readWorkflowEventBranches(workflow, "push"), `${name} push branches`).toEqual(branches);
      expect(readWorkflowEventBranches(workflow, "pull_request"), `${name} pull request branches`).toEqual(
        branches,
      );
    }
  });

  test("does not impose a package-level Node release or install gate", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.engines).toBeUndefined();
  });

  test("fetches and validates origin/devel before checking out the tagged release", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const fetchRefspec = "devel:refs/remotes/origin/devel";
    const annotationCheck = workflow.indexOf('git cat-file -t "refs/tags/$tag_name"');
    const annotationFailure = workflow.indexOf("Release tags must be annotated");
    const validatorInvocation = workflow.indexOf(
      'node scripts/validate-fork-release-tag.mjs "$tag_name"',
    );
    const detachedCheckout = workflow.indexOf('git checkout --detach "$release_commit"');
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
    expect(detachedCheckout).toBeGreaterThan(validatorInvocation);
    expect(dependencyInstall).toBeGreaterThan(validatorInvocation);
    expect(dependencyInstall).toBeGreaterThan(detachedCheckout);
    expect(archiveBuild).toBeGreaterThan(dependencyInstall);
  });

  test("creates the GitHub release after the offline asset and tag-manifest checks", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const archiveBuild = workflow.indexOf("Build and verify release assets");
    const releaseCreate = workflow.indexOf("Create GitHub Release");

    expect(releaseCreate).toBeGreaterThan(archiveBuild);
    expect(workflow).not.toContain("scripts/verify-codex-native-release-attestation.mjs");
    expect(workflow).toContain("Codex-Content-Manifest-SHA256");
    expect(workflow).not.toContain("docs/releases/attestations/");
    expect(workflow).not.toContain("run-codex-native-release-preflight.mjs");
  });
});
