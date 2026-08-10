import { realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import { describe, expect, test } from "vitest";

import {
  HOST_TEMP_DIRECTORY,
  resolveHostTempDirectory,
} from "../../src/util/system-temp.js";

describe("host temp directory resolution", () => {
  test.skipIf(process.platform === "win32")(
    "ignores an inherited hidden sandbox TMPDIR",
    () => {
      const originalTmpDir = process.env.TMPDIR;
      const sandboxTmpDir = join(HOST_TEMP_DIRECTORY, ".ctx-mode-test-sandbox");

      try {
        process.env.TMPDIR = sandboxTmpDir;
        const resolved = resolveHostTempDirectory();
        const relation = relative(sandboxTmpDir, resolved);

        expect(relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)).toBe(true);
        expect(basename(resolved)).not.toMatch(/^\.ctx-mode-/);
      } finally {
        if (originalTmpDir === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = originalTmpDir;
      }
    },
  );

  test("exports the resolved directory for host-side fixtures", () => {
    expect(HOST_TEMP_DIRECTORY).toBeTruthy();
    expect(HOST_TEMP_DIRECTORY).not.toBe(process.cwd());
    expect(realpathSync(HOST_TEMP_DIRECTORY)).toBe(HOST_TEMP_DIRECTORY);
  });
});
