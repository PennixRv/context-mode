import { beforeEach, describe, expect, it } from "vitest";

import {
  isTestExecutionCommand,
  resetGuidanceThrottle,
  routePreToolUse,
} from "../../hooks/core/routing.mjs";
import { runBatchCommands } from "../../src/server.js";

const SESSION = "issue-070-test-routing";

describe("Issue 070 test-command classification", () => {
  beforeEach(() => resetGuidanceThrottle(SESSION));

  it.each([
    "pnpm test",
    "pnpm run test -- --runInBand",
    "npm test -- --watch=false",
    "npm run test:unit",
    "yarn test src/unit.test.ts",
    "yarn run test:e2e",
    "vitest run",
    "npx vitest --run",
    "pnpm exec jest --runInBand",
    "npm exec vitest run",
    "npm exec -- vitest run",
    "yarn exec jest --runInBand",
    "./node_modules/.bin/jest src",
    "pytest -q",
    "python -m pytest tests/unit",
    "python3 -m tox -e py312",
    "tox -e lint",
    "./gradlew test --info",
    "./gradlew :api:test",
    "gradle integrationTest",
    "mvn test -q",
    "./mvnw verify",
    "sbt test",
    "sbt 'testOnly example.UnitSpec'",
    "go test ./...",
    "/usr/local/go/bin/go test ./pkg/...",
    "cargo test --workspace",
    "env CI=1 pnpm test",
    "env -u NODE_OPTIONS CI=1 pnpm test",
    "CI=1 NODE_OPTIONS=--trace-warnings npm test",
    "npm --prefix packages/api test",
    "pnpm --dir packages/api test",
    "yarn --cwd packages/web test",
    "corepack pnpm test",
    "sudo -u build pytest -q",
    "sudo -s pytest -q",
    "time -p pytest -q",
    "timeout --signal TERM 30s cargo test",
    "timeout -s TERM -k 5s 30s go test ./...",
    "bash -lc 'pytest -q'",
    "command pytest -q",
    "exec cargo test",
    "cd packages/api && pnpm test",
    "printf ready; go test ./...",
    "for suite in unit; do pnpm test --filter $suite; done",
    "if [ -f package.json ]; then npm test; fi",
    "{ pnpm test; }",
    "(pytest -q)",
    "run_tests() { cargo test --workspace; }",
  ])("recognizes %s", (command) => {
    expect(isTestExecutionCommand(command)).toBe(true);
  });

  it.each([
    "echo test",
    "printf 'npm test'",
    "rg test src",
    "find tests -type f",
    "cat test-results.json",
    "npm view test-package",
    "npm install test-runner",
    "pnpm add vitest",
    "yarn why jest",
    "go env GOROOT",
    "cargo install cargo-nextest",
    "git test",
    "contest --help",
    "pytest-report.txt",
    "export CI=1 pytest -q",
    "echo { pnpm test",
  ])("rejects non-test execution %s", (command) => {
    expect(isTestExecutionCommand(command)).toBe(false);
  });

  it.each([
    "pnpm test",
    "npx vitest run",
    "python -m pytest tests/unit",
    "tox -e py312",
    "./gradlew test",
    "./mvnw verify",
    "sbt test",
    "go test ./...",
    "cargo test --workspace",
  ])("routes first and repeated test executions without throttle bypass: %s", (command) => {
    const first = routePreToolUse(
      "Bash",
      { command },
      "/project",
      "codex",
      SESSION,
    );
    const repeated = routePreToolUse(
      "Bash",
      { command },
      "/project",
      "codex",
      SESSION,
    );

    expect(first).toMatchObject({ action: "context" });
    expect(repeated).toMatchObject({ action: "context" });
    expect(first?.additionalContext).toContain("ctx_execute");
    expect(repeated?.additionalContext).toBe(first?.additionalContext);
  });

  it.each([
    ["Bash", { command: "pnpm test" }],
    ["exec_command", { cmd: "pytest -q" }],
    ["run_shell_command", { command: "go test ./..." }],
    ["Shell", { command: "cargo test --workspace" }],
  ])("routes host tool shape %s", (toolName, input) => {
    expect(routePreToolUse(toolName, input, "/project", "codex", SESSION)).toMatchObject({
      action: "context",
    });
  });

  it("preserves direct-call controls and unrelated structured protocols", () => {
    expect(routePreToolUse("Bash", { command: "git status --short" }, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("Bash", { command: "touch test-output.txt" }, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("Bash", { command: "kill 12345" }, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("Bash", { command: "systemctl restart context-mode" }, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("wait-next", {}, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("mcp__codegraph__explore", {}, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("mcp__fast_context__search", {}, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("mcp__openviking__search", {}, "/project", "codex", SESSION)).toBeNull();
    expect(routePreToolUse("mcp__unknown__bounded", {}, "/project", "codex", SESSION)).toBeNull();
  });

  it("preserves execution outcomes after a routed test command", async () => {
    const result = await runBatchCommands(
      [
        { label: "pass", command: "pnpm test" },
        { label: "fail", command: "npm test -- --runInBand" },
        { label: "syntax", command: "go test ./..." },
        { label: "timeout", command: "pytest -q" },
        { label: "capped", command: "cargo test --workspace" },
      ],
      { timeout: 1_000, concurrency: 4, nodeOptsPrefix: "" },
      {
        execute: async ({ code }) => {
          if (code.trim() === "npm test -- --runInBand") {
            return { stdout: "assertion output", stderr: "failed", exitCode: 1 };
          }
          if (code.trim() === "go test ./...") {
            return { stdout: "", stderr: "shell syntax error", exitCode: 2 };
          }
          if (code.trim() === "pytest -q") {
            return { stdout: "partial test output", stderr: "timed out", exitCode: 124, timedOut: true };
          }
          if (code.trim() === "cargo test --workspace") {
            return { stdout: "partial test output", stderr: "[output capped at 1MB - process killed]", exitCode: 137 };
          }
          return { stdout: "all tests passed", exitCode: 0 };
        },
      },
    );

    expect(result.statuses).toEqual(["completed", "failed", "failed", "timed_out", "failed"]);
    expect(result.exitCodes).toEqual([0, 1, 2, 124, 137]);
    expect(result.timedOut).toBe(true);
    expect(result.searchableBodies).toEqual(["all tests passed", "", "", "", ""]);
    expect(result.outputs[1]).toContain("failed");
    expect(result.outputs[2]).toContain("shell syntax error");
    expect(result.outputs[3]).toContain("timed out after 1000ms");
    expect(result.outputs[4]).toContain("output capped");
  });
});
