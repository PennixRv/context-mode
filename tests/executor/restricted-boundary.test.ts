import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  probeBubblewrapIsolation,
  type BubblewrapIsolation,
} from "../../src/execution-policy.js";
import { detectRuntimes, type RuntimeMap } from "../../src/runtime.js";

const capabilityRoot = mkdtempSync(join(tmpdir(), "ctx-bwrap-capability-"));
const detectedIsolation = process.platform === "linux"
  ? probeBubblewrapIsolation(capabilityRoot)
  : null;
rmSync(capabilityRoot, { recursive: true, force: true });

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function processLines(marker: string): string[] {
  const result = spawnSync("ps", ["-eo", "args="], { encoding: "utf8" });
  return (result.stdout ?? "").split("\n").filter((line) => line.includes(marker));
}

describe.runIf(detectedIsolation)("real restricted subprocess boundary", () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let outsideRoot: string;
  let hostTmp: string;
  let isolation: BubblewrapIsolation;
  let runtimes: RuntimeMap;
  let Executor: typeof import("../../src/executor.js").PolyglotExecutor;
  let executor: InstanceType<typeof Executor>;

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "ctx-restricted-boundary-"));
    projectRoot = join(fixtureRoot, "project");
    outsideRoot = join(fixtureRoot, "outside");
    hostTmp = join(fixtureRoot, "host-tmp");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    mkdirSync(hostTmp, { recursive: true });
    writeFileSync(join(projectRoot, "input.txt"), "project-visible\n");
    writeFileSync(join(outsideRoot, "secret.txt"), "outside-secret\n");
    symlinkSync(join(outsideRoot, "secret.txt"), join(projectRoot, "escape-link"));

    isolation = probeBubblewrapIsolation(projectRoot)!;
    expect(isolation).not.toBeNull();
    runtimes = detectRuntimes();

    const previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = hostTmp;
    vi.resetModules();
    ({ PolyglotExecutor: Executor } = await import("../../src/executor.js"));
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;

    executor = new Executor({ projectRoot, runtimes });
  });

  afterAll(() => {
    executor?.cleanupBackgrounded();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test("shell reads project data while all file escapes and writes stay blocked", async () => {
    const projectWrite = join(projectRoot, "project-write.txt");
    const outsideFile = join(outsideRoot, "secret.txt");
    const outsideWrite = join(outsideRoot, "outside-write.txt");
    const tmpWrite = `/tmp/ctx-restricted-write-${process.pid}`;
    const childWrite = join(projectRoot, "child-write.txt");
    const renamedInput = join(projectRoot, "renamed-input.txt");
    const encodedOutside = Array.from(outsideFile)
      .map((character) => `\\${character.codePointAt(0)!.toString(8).padStart(3, "0")}`)
      .join("");
    const code = [
      "printf 'read='",
      "cat input.txt",
      `if printf x > ${shellQuote(projectWrite)} 2>/dev/null; then echo project_write=allowed; else echo project_write=blocked; fi`,
      "if printf changed > input.txt 2>/dev/null; then echo project_overwrite=allowed; else echo project_overwrite=blocked; fi",
      `if mv input.txt ${shellQuote(renamedInput)} 2>/dev/null; then echo project_rename=allowed; else echo project_rename=blocked; fi`,
      "if rm input.txt 2>/dev/null; then echo project_delete=allowed; else echo project_delete=blocked; fi",
      `if cat ${shellQuote(outsideFile)} >/dev/null 2>&1; then echo outside_read=allowed; else echo outside_read=blocked; fi`,
      "if cat ../outside/secret.txt >/dev/null 2>&1; then echo traversal_read=allowed; else echo traversal_read=blocked; fi",
      `if (cd ${shellQuote(outsideRoot)}) >/dev/null 2>&1; then echo internal_cd=allowed; else echo internal_cd=blocked; fi`,
      `indirect_path=$(printf '${encodedOutside}')`,
      "if cat \"$indirect_path\" >/dev/null 2>&1; then echo indirect_read=allowed; else echo indirect_read=blocked; fi",
      "if cat escape-link >/dev/null 2>&1; then echo symlink_read=allowed; else echo symlink_read=blocked; fi",
      `if printf x > ${shellQuote(outsideWrite)} 2>/dev/null; then echo outside_write=allowed; else echo outside_write=blocked; fi`,
      `if printf x > ${shellQuote(tmpWrite)} 2>/dev/null; then echo tmp_write=allowed; else echo tmp_write=blocked; fi`,
      `if sh -c ${shellQuote(`printf x > ${shellQuote(childWrite)}`)} 2>/dev/null; then echo child_write=allowed; else echo child_write=blocked; fi`,
      "printf 'path=%s\n' \"$PATH\"",
    ].join("\n");

    const result = await executor.execute({
      language: "shell",
      code,
      isolation,
      timeout: 10_000,
    });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout).toContain("read=project-visible");
    expect(result.stdout).toContain("project_write=blocked");
    expect(result.stdout).toContain("project_overwrite=blocked");
    expect(result.stdout).toContain("project_rename=blocked");
    expect(result.stdout).toContain("project_delete=blocked");
    expect(result.stdout).toContain("outside_read=blocked");
    expect(result.stdout).toContain("traversal_read=blocked");
    expect(result.stdout).toContain("internal_cd=blocked");
    expect(result.stdout).toContain("indirect_read=blocked");
    expect(result.stdout).toContain("symlink_read=blocked");
    expect(result.stdout).toContain("outside_write=blocked");
    expect(result.stdout).toContain("tmp_write=blocked");
    expect(result.stdout).toContain("child_write=blocked");
    expect(result.stdout).toContain(
      `path=${projectRoot}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin`,
    );
    expect(result.stdout).not.toContain(process.env.HOME ?? "__no_home__");
    expect(readFileSync(join(projectRoot, "input.txt"), "utf8")).toBe("project-visible\n");
    expect(() => readFileSync(projectWrite)).toThrow();
    expect(() => readFileSync(renamedInput)).toThrow();
    expect(() => readFileSync(outsideWrite)).toThrow();
    expect(() => readFileSync(tmpWrite)).toThrow();
    expect(() => readFileSync(childWrite)).toThrow();
  });

  test.runIf(Boolean(detectRuntimes().javascript))(
    "JavaScript and executeFile can read project content without host temp scripts",
    async () => {
      const direct = await executor.execute({
        language: "javascript",
        code: "const fs=require('fs'); console.log(fs.readFileSync('input.txt','utf8').trim());",
        isolation,
        timeout: 10_000,
      });
      expect(direct).toMatchObject({ exitCode: 0, timedOut: false });
      expect(direct.stdout.trim()).toBe("project-visible");

      const file = await executor.executeFile({
        path: "input.txt",
        language: "javascript",
        code: "console.log(FILE_CONTENT.trim());",
        isolation,
        timeout: 10_000,
      });
      expect(file).toMatchObject({ exitCode: 0, timedOut: false });
      expect(file.stdout.trim()).toBe("project-visible");
      expect(readdirSync(hostTmp)).toEqual([]);
    },
  );

  test.runIf(Boolean(detectRuntimes().python))(
    "Python reads project content with bytecode persistence disabled",
    async () => {
      const result = await executor.execute({
        language: "python",
        code: "from pathlib import Path\nprint(Path('input.txt').read_text().strip())",
        isolation,
        timeout: 10_000,
      });
      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      expect(result.stdout.trim()).toBe("project-visible");
      expect(readdirSync(projectRoot)).not.toContain("__pycache__");
    },
  );

  test("TypeScript uses a read-only runtime without host temp writes", async () => {
    const result = await executor.execute({
      language: "typescript",
      code: "const value: string = 'typescript-visible'; console.log(value);",
      isolation,
      timeout: 10_000,
    });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout.trim()).toBe("typescript-visible");
    expect(readdirSync(hostTmp)).toEqual([]);
  });

  test.runIf(Boolean(detectRuntimes().javascript))(
    "the isolated network namespace cannot reach a host-local listener",
    async () => {
      const server = createServer((socket) => socket.end("unexpected"));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing test port");
        const code = [
          "const net=require('net');",
          `const socket=net.connect({host:'127.0.0.1',port:${address.port}},()=>{console.log('network=allowed');socket.destroy();});`,
          "socket.on('error',error=>console.log('network=blocked:'+error.code));",
          "socket.setTimeout(1000,()=>{console.log('network=blocked:timeout');socket.destroy();});",
        ].join("\n");
        const result = await executor.execute({
          language: "javascript",
          code,
          isolation,
          timeout: 5_000,
        });
        expect(result.stdout).toContain("network=blocked:");
        expect(result.stdout).not.toContain("network=allowed");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  test("namespace teardown leaves no detached child", async () => {
    const marker = `ctx-restricted-background-${process.pid}-${Date.now()}`;
    const result = await executor.execute({
      language: "shell",
      code: `nohup sh -c 'sleep 4' ${shellQuote(marker)} >/dev/null 2>&1 &\necho launched`,
      isolation,
      timeout: 5_000,
    });
    expect(result.stdout).toContain("launched");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(processLines(marker)).toEqual([]);
  });

  test("timeout kills the full isolated process group", async () => {
    const marker = `ctx-restricted-timeout-${process.pid}-${Date.now()}`;
    const result = await executor.execute({
      language: "shell",
      code: `bash -c 'exec -a ${marker} sleep 10'`,
      isolation,
      timeout: 150,
    });
    expect(result.timedOut).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(processLines(marker)).toEqual([]);
  });
});
