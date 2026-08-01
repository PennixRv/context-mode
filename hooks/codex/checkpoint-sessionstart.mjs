#!/usr/bin/env node
import "./platform.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

function readHookInput() {
  return new Promise((resolve, reject) => {
    let data = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
      callback(value);
    };
    const onData = (chunk) => {
      data += chunk.toString();
    };
    const onEnd = () => finish(resolve, data.replace(/^\uFEFF/, ""));
    const onError = (error) => finish(reject, error);
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

function parseHookInput(raw) {
  const cleaned = raw.trim();
  return cleaned ? JSON.parse(cleaned) : {};
}

function fallbackConfigDir() {
  const configured = process.env.CODEX_HOME;
  if (!configured) return join(homedir(), ".codex");
  return configured.startsWith("~")
    ? join(homedir(), configured.replace(/^~[/\\]?/, ""))
    : configured;
}

let additionalContext = "";
let input = {};
let configDir = fallbackConfigDir();
let recordDiagnostic;
let dependencyUnavailable = false;
try {
  ({ recordCheckpointSessionStartDiagnostic: recordDiagnostic } = await import("../checkpoint-diagnostics.mjs"));
  try {
    await import("./platform.mjs");
  } catch {
    // Platform marker is best-effort.
  }
  try {
    await import("../suppress-stderr.mjs");
  } catch {
    // Stderr suppression is best-effort.
  }
  try {
    await import("../ensure-deps.mjs");
  } catch {
    dependencyUnavailable = true;
  }

  const helpers = await import("../session-helpers.mjs");
  const raw = await helpers.readStdin();
  input = helpers.parseStdin(raw);
  configDir = helpers.resolveConfigDir(helpers.CODEX_OPTS);
} catch {
  dependencyUnavailable = true;
  try {
    input = parseHookInput(await readHookInput());
  } catch {
    input = {};
  }
}

try {
  const isCompactSessionStart = input?.source === "compact";
  if (typeof recordDiagnostic !== "function") {
    ({ recordCheckpointSessionStartDiagnostic: recordDiagnostic } = await import("../checkpoint-diagnostics.mjs"));
  }
  if (isCompactSessionStart) {
    if (dependencyUnavailable) {
      recordDiagnostic(input, configDir, {
        outcome: "failed",
        code: "DEPENDENCY_UNAVAILABLE",
      });
    } else {
      try {
        const { checkpointInternals } = await import("../checkpoint.bundle.mjs");
        const result = checkpointInternals.claimConfirmedCheckpointContextResult(input, { configDir });
        additionalContext = typeof result?.additionalContext === "string" ? result.additionalContext : "";
        recordDiagnostic(input, configDir, result);
      } catch {
        recordDiagnostic(input, configDir, {
          outcome: "failed",
          code: "DEPENDENCY_UNAVAILABLE",
        });
      }
    }
  }
} catch {
  // Compact recovery remains fail-open even when its runtime or diagnostics fail.
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
}) + "\n");
