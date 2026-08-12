/**
 * Issue #852 — ctx_execute_file project-boundary containment.
 *
 * Repro: with the host sandbox enabled, an agent asks to read a file OUTSIDE
 * the project (e.g. `/home/user/some-private-dir/index.ts`). The host denies
 * it, the agent retries via `ctx_execute_file`, and the file is read because
 * the executor fed the path straight into `resolve(projectRoot, path)` where an
 * absolute path (or `../` traversal) escapes the workspace. The host's MCP
 * approval prompt cannot inspect the params, so the escape went unseen.
 *
 * These tests retain coverage for the pure containment primitive used by other
 * security callers. Issue #064 intentionally removed it from compatibility
 * `ctx_execute_file`; host and OS authorization now govern that entry point.
 *
 * No regex in the implementation — pure `path.relative`/`path.resolve` math.
 */

import { describe, it, expect, beforeAll, afterAll, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInsideProject, evaluateProjectContainment } from "../../src/security.js";

describe("isPathInsideProject — issue #852 containment", () => {
  let project: string;
  let outside: string;

  beforeAll(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "ctx-852-proj-")));
    outside = realpathSync(mkdtempSync(join(tmpdir(), "ctx-852-out-")));
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "app.ts"), "export const x = 1;\n");
    writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");
  });

  afterAll(() => {
    for (const d of [project, outside]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("ALLOWS a relative path inside the project", () => {
    expect(isPathInsideProject("src/app.ts", project)).toBe(true);
  });

  it("ALLOWS an absolute path inside the project", () => {
    expect(isPathInsideProject(join(project, "src", "app.ts"), project)).toBe(true);
  });

  it("ALLOWS the project root itself", () => {
    expect(isPathInsideProject(project, project)).toBe(true);
  });

  it("BLOCKS an absolute path outside the project (the #852 repro)", () => {
    // `/home/user/some-private-dir/index.ts`-equivalent: a real absolute path
    // that resolve(projectRoot, abs) would happily hand back verbatim.
    expect(isPathInsideProject(join(outside, "secret.txt"), project)).toBe(false);
  });

  it("BLOCKS a ../ traversal that escapes the project", () => {
    expect(isPathInsideProject("../../../../etc/passwd", project)).toBe(false);
  });

  it("BLOCKS a path that climbs out and is NOT a prefix-sibling of the root", () => {
    // A sibling dir whose name starts with the project basename must NOT be
    // mistaken for "inside" via naive string-prefix matching.
    expect(isPathInsideProject(project + "-evil/secret", project)).toBe(false);
  });

  it("BLOCKS a project-local symlink whose target escapes the project", () => {
    const link = join(project, "escape-link");
    try {
      symlinkSync(join(outside, "secret.txt"), link);
    } catch {
      // Symlink creation can fail on restricted CI (esp. Windows) — skip then.
      return;
    }
    expect(isPathInsideProject("escape-link", project)).toBe(false);
  });

  it("fail-open: returns true when no project root is known", () => {
    expect(isPathInsideProject("/anywhere/at/all", undefined)).toBe(true);
  });

  // ── Escape hatch via host permissions.allow Read(...) rules ──
  it("containment ALLOWS an in-project path with no allow rules (reason: inside)", () => {
    const v = evaluateProjectContainment(join(project, "src", "app.ts"), project, []);
    expect(v).toEqual({ allowed: true, reason: "inside" });
  });

  it("containment DENIES an out-of-project path with no allow rules (reason: outside)", () => {
    const v = evaluateProjectContainment(join(outside, "secret.txt"), project, []);
    expect(v).toEqual({ allowed: false, reason: "outside" });
  });

  it("containment ALLOWS an out-of-project path matched by a host Read(...) allow rule", () => {
    // The user opts a specific out-of-project path back in via the SAME host
    // permissions.allow mechanism Claude Code uses — not a context-mode env.
    const allowGlobs = [[join(outside, "**")]];
    const v = evaluateProjectContainment(join(outside, "secret.txt"), project, allowGlobs);
    expect(v).toEqual({ allowed: true, reason: "allow-rule" });
  });

  it("containment still DENIES an out-of-project path NOT covered by the allow rule", () => {
    const allowGlobs = [["/some/unrelated/path/**"]];
    const v = evaluateProjectContainment(join(outside, "secret.txt"), project, allowGlobs);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("outside");
  });
});

// ─────────────────────────────────────────────────────────
// Server wiring — compatibility ctx_execute_file must not install this
// component-owned containment primitive as a second permission wall.
// ─────────────────────────────────────────────────────────
describe("ctx_execute_file: host-authorized compatibility reads (#852/#064)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const serverSrc = readFileSync(resolve(__dirname, "../../src/server.ts"), "utf-8");

  // titleAfter: the first double-quoted string following a `title:` key that
  // appears after `marker` — equivalent to capturing group 1 of the old regex.
  function titleAfter(src: string, marker: string): string | null {
    const i = src.indexOf(marker);
    if (i === -1) return null;
    const t = src.indexOf("title:", i);
    if (t === -1) return null;
    const q1 = src.indexOf('"', t);
    const q2 = src.indexOf('"', q1 + 1);
    return q1 === -1 || q2 === -1 ? null : src.slice(q1 + 1, q2);
  }

  test("compatibility handler does not implement a second project permission wall", () => {
    expect(serverSrc).not.toContain("function checkProjectBoundary");
    expect(serverSrc).not.toContain("File access blocked:");
    expect(serverSrc).not.toContain("CONTEXT_MODE_ALLOW_OUTSIDE_PROJECT");
  });

  test("execution tools announce code execution in their MCP-prompt title (#852)", () => {
    // refs(claude-code): the approval prompt renders `serverName - <title> (MCP)`;
    // the title is the one server-controlled field, so it must read as code-exec.
    const execTitle = titleAfter(serverSrc, '"ctx_execute",');
    const fileTitle = titleAfter(serverSrc, '"ctx_execute_file",');
    expect(execTitle?.toLowerCase()).toContain("code");
    const fileLower = fileTitle?.toLowerCase() ?? "";
    expect(fileLower.includes("code") || fileLower.includes("execute")).toBe(true);
  });
});
