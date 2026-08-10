import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const entry = join(repoRoot, "start.mjs");

const scenarios = [
  {
    name: "legacy-proxy",
    env: {
      CONTEXT_MODE_CODE_ECHO_MAX: "2000",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "500",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "240",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "80",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "3000",
    },
  },
  { name: "default", env: {} },
  {
    name: "configured-compact",
    env: {
      CONTEXT_MODE_CODE_ECHO_MAX: "80",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "80",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "32",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "5",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "200",
    },
  },
  {
    name: "zero-policy",
    env: {
      CONTEXT_MODE_CODE_ECHO_MAX: "0",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "0",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "0",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "0",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "0",
    },
  },
];

function cleanEnvironment() {
  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      /^(CLAUDE|CODEX|GEMINI|VSCODE|CURSOR|OPENCODE|KILO|KIRO|PI|OMP|ZED|QWEN|KIMI|ANTIGRAVITY|OPENCLAW|COPILOT)_/.test(key)
      || key.startsWith("CONTEXT_MODE_")
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function fileCount(root) {
  if (!existsSync(root)) return 0;
  let count = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(dir, entry.name));
      else count++;
    }
  };
  visit(root);
  return count;
}

function textFrom(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function metrics(text) {
  const preview = /preview=(\d+) chars/.exec(text)?.[1];
  return {
    chars: Array.from(text).length,
    bytes: Buffer.byteLength(text),
    lines: text.split("\n").length,
    sourcePreviewChars: preview ? Number(preview) : null,
  };
}

const longTail = "x".repeat(3990);
const executeCode = `console.log("MEASURE_OK");\n// ${longTail}`;
const fileCode = `console.log(FILE_CONTENT.trim());\n// ${longTail}`;
const batchCommand = `printf '# Alpha\\nmeasure-marker alpha result\\n'\n# ${"y".repeat(1500)}`;
const measurements = [];

for (const scenario of scenarios) {
  const fixture = mkdtempSync(join(tmpdir(), `ctx-response-${scenario.name}-`));
  const project = join(fixture, "project");
  const storage = join(fixture, "storage");
  const home = join(fixture, "home");
  const hostTmp = join(fixture, "host-tmp");
  for (const dir of [project, home, hostTmp]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(project, "input.txt"), "MEASURE_FILE\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: repoRoot,
    stderr: "pipe",
    env: {
      ...cleanEnvironment(),
      HOME: home,
      TMPDIR: hostTmp,
      PWD: project,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CONTEXT_MODE_PROJECT_DIR: project,
      CONTEXT_MODE_DIR: storage,
      CONTEXT_MODE_DISABLE_VERSION_CHECK: "1",
      CONTEXT_MODE_PLATFORM: "claude-code",
      CONTEXT_MODE_EXECUTION_MODE: "restricted",
      CONTEXT_MODE_RESTRICTED_PROJECT_ROOT: project,
      ...scenario.env,
    },
  });
  transport.stderr?.on("data", () => {});
  const client = new Client(
    { name: "execution-response-measurement", version: "1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const execute = textFrom(await client.callTool({
      name: "ctx_execute",
      arguments: { language: "javascript", code: executeCode },
    }));
    const executeFile = textFrom(await client.callTool({
      name: "ctx_execute_file",
      arguments: { path: "input.txt", language: "javascript", code: fileCode },
    }));
    const batch = textFrom(await client.callTool({
      name: "ctx_batch_execute",
      arguments: {
        commands: [{ label: "measurement", command: batchCommand }],
        queries: ["measure-marker"],
      },
    }));
    measurements.push({
      scenario: scenario.name,
      execute: metrics(execute),
      executeFile: metrics(executeFile),
      batch: metrics(batch),
      persistentFiles: {
        storage: fileCount(storage),
        home: fileCount(home),
        hostTmp: fileCount(hostTmp),
      },
    });
  } finally {
    await client.close();
    rmSync(fixture, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  inputs: {
    executeCodeChars: Array.from(executeCode).length,
    executeCodeLines: executeCode.split("\n").length,
    fileCodeChars: Array.from(fileCode).length,
    batchCommandChars: Array.from(batchCommand).length,
  },
  measurements,
}, null, 2));
