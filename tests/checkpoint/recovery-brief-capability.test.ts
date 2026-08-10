import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  RECOVERY_BRIEF_CAPABILITY_FIELD,
  RECOVERY_BRIEF_CAPABILITY_TTL_MS,
  consumeRecoveryBriefCapability,
  issueRecoveryBriefCapability,
} from "../../src/checkpoint/recovery-brief-capability.js";
import { HOST_TEMP_DIRECTORY } from "../../src/util/system-temp.js";

const cleanup: string[] = [];
const describePrivateCapability = process.platform === "win32" ? describe.skip : describe;
const REPOSITORY_ROOT = resolve(__dirname, "..", "..");
const CAPABILITY_LOADER_PATH = join(REPOSITORY_ROOT, "hooks", "recovery-brief-capability.mjs");

function fixture(): { root: string; project: string; storage: string } {
  const root = mkdtempSync(join(HOST_TEMP_DIRECTORY, "ctx-recovery-capability-"));
  const project = join(root, "project");
  const storage = join(root, "storage");
  mkdirSync(project, { recursive: true });
  cleanup.push(root);
  return { root, project, storage };
}

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function consumeInSubprocess(storage: string, token: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(join(
    REPOSITORY_ROOT,
    "build",
    "checkpoint",
    "recovery-brief-capability.js",
  )).href;
  const source = [
    `import { consumeRecoveryBriefCapability } from ${JSON.stringify(moduleUrl)};`,
    `const result = consumeRecoveryBriefCapability(${JSON.stringify(token)}, { storageDir: ${JSON.stringify(storage)} });`,
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");

  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`capability consumer exited ${code}: ${stderr}`));
        return;
      }
      resolveResult(JSON.parse(stdout));
    });
  });
}

describePrivateCapability("RecoveryBrief Codex identity capability", () => {
  it("loads only the generated hook bundle that the marketplace archive ships", () => {
    const loader = readFileSync(CAPABILITY_LOADER_PATH, "utf8");
    expect(loader).toContain("recovery-brief-capability.bundle.mjs");
    expect(loader).not.toContain("build/checkpoint/recovery-brief-capability.js");
  });

  it("issues one private opaque record and consumes the exact canonical project/session once", () => {
    const { project, storage } = fixture();
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    const token = issueRecoveryBriefCapability(
      { cwd: project, sessionId: "codex-session-a" },
      { storageDir: storage, now: () => now, randomBytes: () => Buffer.alloc(32, 7) },
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const recordPath = join(storage, token!);
    expect(lstatSync(storage).mode & 0o777).toBe(0o700);
    expect(lstatSync(recordPath).mode & 0o777).toBe(0o600);
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual([
      "canonical_project_root",
      "created_at",
      "expires_at",
      "project_root_sha256",
      "schema_version",
      "session_id",
      "token",
    ]);
    expect(JSON.stringify(record)).not.toContain("brief");
    expect(consumeRecoveryBriefCapability(token, {
      storageDir: storage,
      now: () => now + 1,
      randomBytes: () => Buffer.alloc(32, 8),
    })).toEqual({ projectDir: project, sessionId: "codex-session-a" });
    expect(consumeRecoveryBriefCapability(token, { storageDir: storage, now: () => now + 2 })).toBeNull();
  });

  it("fails closed for malformed, expired, unsafe, symlinked, and root-hash-tampered records", () => {
    const { root, project, storage } = fixture();
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    let nextByte = 20;
    const create = () => issueRecoveryBriefCapability(
      { cwd: project, sessionId: "codex-session-a" },
      { storageDir: storage, now: () => now, randomBytes: () => Buffer.alloc(32, nextByte++) },
    );

    const malformed = create()!;
    writeFileSync(join(storage, malformed), "{", "utf8");
    expect(consumeRecoveryBriefCapability(malformed, { storageDir: storage, now: () => now + 1 })).toBeNull();

    const expired = create()!;
    expect(consumeRecoveryBriefCapability(expired, {
      storageDir: storage,
      now: () => now + RECOVERY_BRIEF_CAPABILITY_TTL_MS,
    })).toBeNull();

    const unsafe = create()!;
    chmodSync(join(storage, unsafe), 0o644);
    expect(consumeRecoveryBriefCapability(unsafe, { storageDir: storage, now: () => now + 1 })).toBeNull();

    const symlink = create()!;
    const target = join(root, "record-target");
    writeFileSync(target, readFileSync(join(storage, symlink), "utf8"), "utf8");
    rmSync(join(storage, symlink));
    symlinkSync(target, join(storage, symlink));
    expect(consumeRecoveryBriefCapability(symlink, { storageDir: storage, now: () => now + 1 })).toBeNull();

    const tampered = create()!;
    const tamperedPath = join(storage, tampered);
    const content = JSON.parse(readFileSync(tamperedPath, "utf8")) as Record<string, unknown>;
    content.project_root_sha256 = "0".repeat(64);
    writeFileSync(tamperedPath, `${JSON.stringify(content)}\n`, "utf8");
    // Keep this branch about digest validation rather than the preceding
    // write operation's platform-dependent mode preservation.
    chmodSync(tamperedPath, 0o600);
    expect(consumeRecoveryBriefCapability(tampered, { storageDir: storage, now: () => now + 1 })).toBeNull();
  });

  it("rejects a symlinked capability directory or ancestor before it writes a record", () => {
    const { root, project } = fixture();
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    const target = join(root, "target");
    const linkedStorage = join(root, "storage-link");
    const ancestorTarget = join(root, "ancestor-target");
    const symlinkedAncestorStorage = join(root, "ancestor-link", "capabilities");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    mkdirSync(ancestorTarget, { recursive: true, mode: 0o700 });
    symlinkSync(target, linkedStorage);
    symlinkSync(ancestorTarget, join(root, "ancestor-link"));

    expect(issueRecoveryBriefCapability(
      { cwd: project, sessionId: "codex-session-a" },
      { storageDir: linkedStorage, now: () => now, randomBytes: () => Buffer.alloc(32, 41) },
    )).toBeNull();
    expect(issueRecoveryBriefCapability(
      { cwd: project, sessionId: "codex-session-a" },
      { storageDir: symlinkedAncestorStorage, now: () => now, randomBytes: () => Buffer.alloc(32, 42) },
    )).toBeNull();
  });

  it("rejects a non-0700 storage directory before consuming a valid record", () => {
    const { project, storage } = fixture();
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    const token = issueRecoveryBriefCapability(
      { cwd: project, sessionId: "codex-session-a" },
      { storageDir: storage, now: () => now, randomBytes: () => Buffer.alloc(32, 43) },
    );
    chmodSync(storage, 0o755);
    expect(consumeRecoveryBriefCapability(token, { storageDir: storage, now: () => now + 1 })).toBeNull();
  });

  it("requires an explicit absolute hook cwd and explicit session id", () => {
    const { storage } = fixture();
    expect(issueRecoveryBriefCapability({ cwd: ".", sessionId: "session" }, { storageDir: storage })).toBeNull();
    expect(issueRecoveryBriefCapability({ cwd: "/tmp", sessionId: "" }, { storageDir: storage })).toBeNull();
    expect(issueRecoveryBriefCapability({ cwd: "/tmp" }, { storageDir: storage })).toBeNull();
    expect(RECOVERY_BRIEF_CAPABILITY_FIELD).toMatch(/^__context_mode_/);
  });

  it("rejects a record when an independent project or session binding is expected", () => {
    const { root, project, storage } = fixture();
    const otherProject = join(root, "other-project");
    mkdirSync(otherProject, { recursive: true });
    const now = Date.parse("2026-08-04T00:00:00.000Z");
    const forProjectA = issueRecoveryBriefCapability(
      { cwd: project, sessionId: "session-a" },
      { storageDir: storage, now: () => now, randomBytes: () => Buffer.alloc(32, 31) },
    );
    expect(consumeRecoveryBriefCapability(forProjectA, {
      storageDir: storage,
      now: () => now + 1,
      expectedProjectRoot: otherProject,
    })).toBeNull();

    const forSessionA = issueRecoveryBriefCapability(
      { cwd: project, sessionId: "session-a" },
      { storageDir: storage, now: () => now, randomBytes: () => Buffer.alloc(32, 32) },
    );
    expect(consumeRecoveryBriefCapability(forSessionA, {
      storageDir: storage,
      now: () => now + 1,
      expectedSessionId: "session-b",
    })).toBeNull();
  });

  it("lets exactly one concurrent consumer obtain the identity and rejects replay", async () => {
    const { project, storage } = fixture();
    const token = issueRecoveryBriefCapability(
      { cwd: project, sessionId: "concurrent-session" },
      { storageDir: storage, randomBytes: () => Buffer.alloc(32, 44) },
    );
    expect(token).toBeTypeOf("string");

    const results = await Promise.all([
      consumeInSubprocess(storage, token!),
      consumeInSubprocess(storage, token!),
    ]);
    expect(results.filter((result) => result !== null)).toEqual([
      { projectDir: project, sessionId: "concurrent-session" },
    ]);
    expect(consumeRecoveryBriefCapability(token, { storageDir: storage })).toBeNull();
  });
});
