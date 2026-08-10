import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  formatExecutionPolicyError,
  readExecutionMode,
  resolveExecutionPolicy,
  resolveProjectContainedPath,
  validateRestrictedInvocation,
  type ExecutionPolicyDecision,
} from "../src/execution-policy.js";

describe("server-controlled execution policy", () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let outsideRoot: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "ctx-policy-"));
    mkdirSync(join(fixtureRoot, "project", "src"), { recursive: true });
    mkdirSync(join(fixtureRoot, "project-prefix-sibling"), { recursive: true });
    mkdirSync(join(fixtureRoot, "outside"), { recursive: true });
    projectRoot = realpathSync(join(fixtureRoot, "project"));
    outsideRoot = realpathSync(join(fixtureRoot, "outside"));
    writeFileSync(join(projectRoot, "src", "input.txt"), "project data\n");
    writeFileSync(join(outsideRoot, "secret.txt"), "outside data\n");
    symlinkSync(join(outsideRoot, "secret.txt"), join(projectRoot, "escape-file"));
    symlinkSync(outsideRoot, join(projectRoot, "escape-dir"));
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function restrictedDecision(): ExecutionPolicyDecision {
    return resolveExecutionPolicy({
      projectRoot,
      env: { CONTEXT_MODE_EXECUTION_MODE: "restricted" },
      platform: "linux",
      probeIsolation: (root) => ({
        kind: "bubblewrap",
        executable: "/usr/bin/bwrap",
        projectRoot: root,
      }),
    });
  }

  test("defaults to explicit compatibility authority and ordinary side effects", () => {
    expect(readExecutionMode({})).toEqual({
      mode: "compatibility",
      authoritySource: "server-default",
    });
    const decision = resolveExecutionPolicy({ projectRoot, env: {} });
    expect(decision).toMatchObject({
      ok: true,
      mode: "compatibility",
      authoritySource: "server-default",
      projectRootSource: "compatibility-resolver",
      persistence: "persistent",
      network: "allowed",
      filesystem: "read-write",
      background: "allowed",
    });
  });

  test("only the server environment selects restricted authority", () => {
    const decision = restrictedDecision();
    expect(decision).toMatchObject({
      ok: true,
      mode: "restricted",
      authoritySource: "server-environment",
      projectRootSource: "restricted-server-environment",
      persistence: "request-only",
      network: "disabled",
      filesystem: "project-read-only",
      background: "forbidden",
    });
    expect(decision.isolation?.projectRoot).toBe(projectRoot);
  });

  test("invalid policy and unavailable isolation fail closed with stable codes", () => {
    expect(resolveExecutionPolicy({
      projectRoot,
      env: { CONTEXT_MODE_EXECUTION_MODE: "caller-read-only" },
    })).toMatchObject({
      ok: false,
      mode: "restricted",
      errorCode: "CTX_EXEC_POLICY_INVALID",
    });

    expect(resolveExecutionPolicy({
      projectRoot,
      env: { CONTEXT_MODE_EXECUTION_MODE: "restricted" },
      platform: "darwin",
    })).toMatchObject({
      ok: false,
      errorCode: "CTX_EXEC_ISOLATION_UNAVAILABLE",
    });

    expect(resolveExecutionPolicy({
      projectRoot,
      env: { CONTEXT_MODE_EXECUTION_MODE: "restricted" },
      platform: "linux",
      probeIsolation: () => null,
    })).toMatchObject({
      ok: false,
      errorCode: "CTX_EXEC_ISOLATION_UNAVAILABLE",
    });
  });

  test("an unverifiable project root is rejected before isolation probing", () => {
    let probed = false;
    const decision = resolveExecutionPolicy({
      projectRoot: join(fixtureRoot, "missing-project"),
      env: { CONTEXT_MODE_EXECUTION_MODE: "restricted" },
      platform: "linux",
      probeIsolation: () => {
        probed = true;
        return null;
      },
    });
    expect(decision.errorCode).toBe("CTX_EXEC_PROJECT_ROOT_INVALID");
    expect(probed).toBe(false);

    expect(resolveExecutionPolicy({
      projectRoot: "relative-project",
      env: { CONTEXT_MODE_EXECUTION_MODE: "restricted" },
      platform: "linux",
      probeIsolation: () => {
        throw new Error("relative roots must not reach the backend probe");
      },
    }).errorCode).toBe("CTX_EXEC_PROJECT_ROOT_INVALID");
  });

  test("canonical containment accepts project paths and rejects every escape form", () => {
    expect(resolveProjectContainedPath(projectRoot, "src/input.txt", true)).toMatchObject({
      ok: true,
      path: join(projectRoot, "src", "input.txt"),
    });
    expect(resolveProjectContainedPath(projectRoot, "src/missing.txt", false)).toMatchObject({
      ok: true,
      path: join(projectRoot, "src", "missing.txt"),
    });

    for (const candidate of [
      join(outsideRoot, "secret.txt"),
      "../outside/secret.txt",
      join(fixtureRoot, "project-prefix-sibling"),
      "escape-file",
      "escape-dir/missing.txt",
    ]) {
      expect(resolveProjectContainedPath(projectRoot, candidate, false)).toMatchObject({
        ok: false,
        errorCode: "CTX_EXEC_PATH_OUTSIDE_PROJECT",
      });
    }

    expect(resolveProjectContainedPath(projectRoot, "src/missing.txt", true)).toMatchObject({
      ok: false,
      errorCode: "CTX_EXEC_PATH_INVALID",
    });
  });

  test("restricted invocation validation rejects caller-requested widening", () => {
    const decision = restrictedDecision();
    expect(validateRestrictedInvocation(decision, {
      language: "ruby",
    }).errorCode).toBe("CTX_EXEC_LANGUAGE_UNSUPPORTED");
    expect(validateRestrictedInvocation(decision, {
      language: "shell",
      background: true,
    }).errorCode).toBe("CTX_EXEC_BACKGROUND_FORBIDDEN");
    expect(validateRestrictedInvocation(decision, {
      language: "shell",
      queryScope: "global",
    }).errorCode).toBe("CTX_EXEC_GLOBAL_QUERY_FORBIDDEN");
    expect(validateRestrictedInvocation(decision, {
      language: "javascript",
      cwd: "src",
      filePath: "src/input.txt",
    })).toEqual({
      ok: true,
      errorCode: null,
      cwd: join(projectRoot, "src"),
      filePath: join(projectRoot, "src", "input.txt"),
    });
    expect(validateRestrictedInvocation(decision, {
      language: "typescript",
    }).ok).toBe(true);
  });

  test("denials disclose a code and bounded reason, not a requested path", () => {
    const text = formatExecutionPolicyError("CTX_EXEC_PATH_OUTSIDE_PROJECT");
    expect(text).toBe(
      "Restricted execution denied [CTX_EXEC_PATH_OUTSIDE_PROJECT]: the requested path is outside the project boundary.",
    );
    expect(text).not.toContain(outsideRoot);
  });
});
