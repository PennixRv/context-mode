import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dirname, "..", "..");
const hookPath = join(repositoryRoot, ".codex", "hooks", "session-start.py");
const commonScriptsPath = join(repositoryRoot, ".trellis", "scripts", "common");
const contextLimit = 900;
const protectedTaskFiles = [
  "task.json",
  "prd.md",
  "design.md",
  "implement.md",
  "check.md",
  "recovery-brief.json",
];

type HookResponse = {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
};

type Fixture = {
  projectDir: string;
  taskDir: string;
  sessionId: string;
};

const fixtureDirectories: string[] = [];

function createFixture(taskRef = ".trellis/tasks/task-1"): Fixture {
  const projectDir = mkdtempSync(join(tmpdir(), "trellis-session-start-"));
  fixtureDirectories.push(projectDir);

  const trellisDir = join(projectDir, ".trellis");
  const taskDir = join(trellisDir, "tasks", "task-1");
  const sessionId = "session-start-fixture";
  cpSync(commonScriptsPath, join(trellisDir, "scripts", "common"), { recursive: true });
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(join(trellisDir, "spec", "guides"), { recursive: true });
  mkdirSync(join(trellisDir, "spec", "backend"), { recursive: true });
  mkdirSync(join(trellisDir, ".runtime", "sessions"), { recursive: true });

  writeFileSync(
    join(trellisDir, "workflow.md"),
    "## Phase Index\n\nPhase 1: Plan\nPhase 2: Execute\nPhase 3: Finish\n",
    "utf8",
  );
  writeFileSync(join(trellisDir, "spec", "guides", "index.md"), "# Guides\n", "utf8");
  writeFileSync(join(trellisDir, "spec", "backend", "index.md"), "# Backend\n", "utf8");
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({ id: "task-1", status: "in_progress", title: "FORBIDDEN_TASK_TITLE" }),
    "utf8",
  );
  writeFileSync(join(taskDir, "prd.md"), "FORBIDDEN_TASK_BODY", "utf8");
  writeFileSync(join(taskDir, "design.md"), "FORBIDDEN_DESIGN_BODY", "utf8");
  writeFileSync(join(taskDir, "implement.md"), "FORBIDDEN_IMPLEMENT_BODY", "utf8");
  writeFileSync(join(taskDir, "check.md"), "FORBIDDEN_CHECK_BODY", "utf8");
  writeFileSync(join(taskDir, "recovery-brief.json"), "FORBIDDEN_BRIEF_BODY", "utf8");
  writeFileSync(join(taskDir, "implement.jsonl"), "{\"_example\":true}\n", "utf8");
  writeFileSync(join(taskDir, "check.jsonl"), "{\"_example\":true}\n", "utf8");
  writeFileSync(
    join(trellisDir, ".runtime", "sessions", `codex_${sessionId}.json`),
    JSON.stringify({ current_task: taskRef }),
    "utf8",
  );

  return { projectDir, taskDir, sessionId };
}

function invokeHook(projectDir: string, sessionId: string, source: string): HookResponse {
  const result = spawnSync("python3", ["-X", "utf8", hookPath], {
    input: JSON.stringify({ cwd: projectDir, session_id: sessionId, source }),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_NON_INTERACTIVE: "0",
      TRELLIS_DISABLE_HOOKS: "0",
      TRELLIS_HOOKS: "1",
    },
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as HookResponse;
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project Trellis SessionStart hook", () => {
  it("registers one bounded local hook without changing the context-mode plugin hooks", () => {
    const localHooks = JSON.parse(
      readFileSync(join(repositoryRoot, ".codex", "hooks.json"), "utf8"),
    ) as {
      hooks: {
        SessionStart?: Array<{
          matcher: string;
          hooks: Array<{
            type: string;
            command: string;
            timeout: number;
            additionalContextLimit: number;
          }>;
        }>;
      };
    };
    const pluginHooks = JSON.parse(
      readFileSync(join(repositoryRoot, ".codex-plugin", "hooks.json"), "utf8"),
    ) as {
      hooks: {
        SessionStart?: Array<{
          matcher: string;
          hooks: Array<{ command: string; additionalContextLimit?: number }>;
        }>;
      };
    };

    expect(localHooks.hooks.SessionStart).toEqual([
      {
        matcher: "^(startup|resume|clear|compact)$",
        hooks: [
          {
            type: "command",
            command: "python3 -X utf8 .codex/hooks/session-start.py",
            timeout: 10,
            additionalContextLimit: contextLimit,
          },
        ],
      },
    ]);
    expect(pluginHooks.hooks.SessionStart?.[0]?.matcher).toBe("^(startup|resume|clear)$");
    expect(pluginHooks.hooks.SessionStart?.[1]?.matcher).toBe("^compact$");
    expect(pluginHooks.hooks.SessionStart?.[1]?.hooks[0]?.command).toContain(
      "checkpoint-sessionstart.mjs",
    );
    expect(pluginHooks.hooks.SessionStart?.[1]?.hooks[0]?.additionalContextLimit).toBe(1500);
  });

  it.each(["startup", "resume", "clear", "compact"])(
    "returns bounded read-only orientation for %s",
    (source) => {
      const fixture = createFixture();
      const response = invokeHook(fixture.projectDir, fixture.sessionId, source);
      const context = response.hookSpecificOutput.additionalContext;

      expect(response.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(contextLimit);
      expect(context).toContain("Read-only current-task orientation");
      expect(context).toContain("Workflow: Phase 1 Plan -> Phase 2 Execute -> Phase 3 Finish.");
      expect(context).toContain("Task: .trellis/tasks/task-1; status=in_progress.");
      expect(context).toContain(
        "Artifacts: task.json, prd.md, design.md, implement.md, check.md, implement.jsonl, check.jsonl.",
      );
      expect(context).toContain(".trellis/spec/guides/index.md");
      expect(context).not.toContain("FORBIDDEN_TASK_TITLE");
      expect(context).not.toContain("FORBIDDEN_TASK_BODY");
      expect(context).not.toContain("FORBIDDEN_DESIGN_BODY");
      expect(context).not.toContain("FORBIDDEN_IMPLEMENT_BODY");
      expect(context).not.toContain("FORBIDDEN_CHECK_BODY");
      expect(context).not.toContain("FORBIDDEN_BRIEF_BODY");
      expect(context).not.toContain("first-reply-notice");
      expect(context).not.toContain("RecoveryBrief");
    },
  );

  it("reports no active task and stale pointers without task writes", () => {
    const noActive = createFixture();
    rmSync(join(noActive.projectDir, ".trellis", ".runtime", "sessions"), {
      recursive: true,
      force: true,
    });
    const noActiveResponse = invokeHook(noActive.projectDir, noActive.sessionId, "startup");
    expect(noActiveResponse.hookSpecificOutput.additionalContext).toContain("Task: none; status=none.");
    expect(noActiveResponse.hookSpecificOutput.additionalContext).toContain("Artifacts: unavailable.");

    const stale = createFixture(".trellis/tasks/missing-task");
    const taskFilesBefore = protectedTaskFiles.map((name) =>
      readFileSync(join(stale.taskDir, name), "utf8"),
    );
    const staleResponse = invokeHook(stale.projectDir, stale.sessionId, "compact");
    const taskFilesAfter = protectedTaskFiles.map((name) =>
      readFileSync(join(stale.taskDir, name), "utf8"),
    );

    expect(staleResponse.hookSpecificOutput.additionalContext).toContain(
      "Task: .trellis/tasks/missing-task; status=stale-pointer.",
    );
    expect(staleResponse.hookSpecificOutput.additionalContext).toContain("Artifacts: unavailable.");
    expect(taskFilesAfter).toEqual(taskFilesBefore);
  });

  it("fails open for unavailable Trellis state and keeps malformed pointers bounded", () => {
    const unavailableDir = mkdtempSync(join(tmpdir(), "trellis-session-start-unavailable-"));
    fixtureDirectories.push(unavailableDir);
    const unavailableResponse = invokeHook(unavailableDir, "missing-session", "compact");
    expect(unavailableResponse.hookSpecificOutput.additionalContext).toBe("");

    const longPointer = `.trellis/tasks/${"x".repeat(4_096)}`;
    const malformed = createFixture(longPointer);
    const malformedResponse = invokeHook(malformed.projectDir, malformed.sessionId, "compact");
    const malformedContext = malformedResponse.hookSpecificOutput.additionalContext;

    expect(malformedContext).toContain("status=stale-pointer.");
    expect(Buffer.byteLength(malformedContext, "utf8")).toBeLessThanOrEqual(contextLimit);
  });
});
