import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

const runnerPath = resolve(__dirname, "..", "..", "scripts", "run-pnpm.mjs");

describe("run-pnpm", () => {
  test("resolves npm-cli.js in the POSIX Node distribution layout", async () => {
    const { resolveNpmCliPath } = await import(runnerPath);
    expect(resolveNpmCliPath("/opt/node/bin/node", "linux")).toBe(
      "/opt/node/lib/node_modules/npm/bin/npm-cli.js",
    );
  });

  test("resolves npm-cli.js in the Windows Node distribution layout", async () => {
    const { resolveNpmCliPath } = await import(runnerPath);
    expect(resolveNpmCliPath("C:\\hostedtoolcache\\node.exe", "win32")).toBe(
      "C:\\hostedtoolcache\\node_modules\\npm\\bin\\npm-cli.js",
    );
  });
});
