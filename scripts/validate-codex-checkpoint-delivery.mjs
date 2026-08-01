#!/usr/bin/env node
// Real-host delivery attestation for the Codex confirmed-checkpoint experiment.
//
// This is deliberately a source-tree validation tool, not plugin runtime code.
// It requires a prebuilt, disposable CODEX_HOME that already contains the
// intended provider, authentication cache, installed local plugin, and trusted
// hook definitions. It never copies credentials or changes normal CODEX_HOME.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync as Database } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const AUTOMATIC_HISTORY_WORD_COUNT = 5_000;
const AUTOMATIC_TOKEN_LIMIT = 2_000;
const REQUEST_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 120_000;
const COMPACTION_START_TIMEOUT_MS = 30_000;
const COMPACTION_COMPLETE_TIMEOUT_MS = 120_000;
const NORMAL_CODEX_HOME = resolve(homedir(), ".codex");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESPONSE_ITEM_TYPES = new Set([
  "agentMessage",
  "contextCompaction",
  "reasoning",
  "userMessage",
]);
const CHECKPOINT_HOOK_EVENTS = new Set([
  "preCompact",
  "postCompact",
  "sessionStart",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireEnvironmentDirectory(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  const resolved = resolve(value);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${name} must reference an existing directory`);
  }

  return resolved;
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} is invalid: ${message}`);
  }
}

function isInside(parentPath, candidatePath) {
  const pathRelative = relative(parentPath, candidatePath);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

export function resolveOptions() {
  const validationHome = requireEnvironmentDirectory("CONTEXT_MODE_VALIDATION_HOME");
  const projectPath = requireEnvironmentDirectory("CONTEXT_MODE_PROJECT_PATH");
  const releasePluginRoot = requireEnvironmentDirectory("CONTEXT_MODE_RELEASE_PLUGIN_ROOT");
  const trigger = process.env.CONTEXT_MODE_CHECKPOINT_TRIGGER ?? "manual";

  if (validationHome === NORMAL_CODEX_HOME) {
    throw new Error("CONTEXT_MODE_VALIDATION_HOME must not be the normal CODEX_HOME");
  }
  if (releasePluginRoot === repositoryRoot) {
    throw new Error("CONTEXT_MODE_RELEASE_PLUGIN_ROOT must be an installed release payload, not this source tree");
  }
  if (!isInside(join(validationHome, "plugins", "cache"), releasePluginRoot)) {
    throw new Error("CONTEXT_MODE_RELEASE_PLUGIN_ROOT must stay inside CONTEXT_MODE_VALIDATION_HOME/plugins/cache");
  }
  if (lstatSync(releasePluginRoot).isSymbolicLink()) {
    throw new Error("CONTEXT_MODE_RELEASE_PLUGIN_ROOT must be a materialized release payload, not a symlink");
  }
  const releasePackage = readJson(join(releasePluginRoot, "package.json"), "release payload package.json");
  if (releasePackage.name !== "context-mode" || typeof releasePackage.version !== "string") {
    throw new Error("CONTEXT_MODE_RELEASE_PLUGIN_ROOT is not a context-mode release payload");
  }
  const expectedPluginRoot = join(
    validationHome,
    "plugins",
    "cache",
    "context-mode-offline",
    "context-mode",
    releasePackage.version,
  );
  if (realpathSync(releasePluginRoot) !== realpathSync(expectedPluginRoot)) {
    throw new Error("CONTEXT_MODE_RELEASE_PLUGIN_ROOT must be the context-mode-offline marketplace installation");
  }
  for (const requiredPath of [
    ".codex-plugin/plugin.json",
    ".codex-plugin/hooks.json",
    "hooks/checkpoint.bundle.mjs",
    "hooks/checkpoint-diagnostics.mjs",
    "start.mjs",
    "server.bundle.mjs",
    "fetch-worker.bundle.cjs",
  ]) {
    if (!existsSync(join(releasePluginRoot, requiredPath))) {
      throw new Error(`release payload is missing ${requiredPath}`);
    }
  }
  if (existsSync(join(releasePluginRoot, "node_modules"))) {
    throw new Error("release payload must not contain node_modules");
  }
  if (trigger !== "manual" && trigger !== "auto") {
    throw new Error("CONTEXT_MODE_CHECKPOINT_TRIGGER must be manual or auto");
  }

  const reportPath = resolve(
    process.env.CONTEXT_MODE_REPORT_PATH ?? join(validationHome, "checkpoint-delivery-attestation.json"),
  );
  if (!isInside(validationHome, reportPath)) {
    throw new Error("CONTEXT_MODE_REPORT_PATH must stay inside CONTEXT_MODE_VALIDATION_HOME");
  }

  return {
    validationHome,
    projectPath,
    releasePluginRoot,
    releaseVersion: releasePackage.version,
    reportPath,
    trigger,
  };
}

export function writeReport(reportPath, report) {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}

export function createReport(options) {
  return {
    status: "running",
    trigger: options.trigger,
    release: {
      pluginRoot: options.releasePluginRoot,
      version: options.releaseVersion,
    },
    threadId: null,
    seedTurnId: null,
    attestationTurnId: null,
    effectiveConfig: null,
    checkpoint: null,
    compactionStarted: false,
    compactionCompleted: false,
    hookEvents: [],
    attestation: null,
    error: null,
  };
}

export function findCheckpoint(validationHome, sessionId) {
  const checkpointDirectory = join(validationHome, "context-mode", "checkpoints");
  if (!existsSync(checkpointDirectory)) {
    return null;
  }

  for (const fileName of readdirSync(checkpointDirectory).sort()) {
    if (!fileName.endsWith(".db")) {
      continue;
    }

    const databasePath = join(checkpointDirectory, fileName);
    const database = new Database(databasePath, { readOnly: true });
    try {
      const checkpoint = database.prepare(`
        SELECT *
        FROM compact_checkpoints
        WHERE session_id = ?
        ORDER BY sequence DESC
        LIMIT 1
      `).get(sessionId);
      if (!checkpoint) {
        continue;
      }

      const transitions = database.prepare(`
        SELECT from_state, to_state, reason
        FROM checkpoint_transitions
        WHERE checkpoint_id = ?
        ORDER BY transition_id
      `).all(checkpoint.checkpoint_id);
      return { checkpoint, transitions };
    } finally {
      database.close();
    }
  }

  return null;
}

function verifyCompletedCheckpointHooks(hookEvents) {
  const completedEvents = new Set(
    hookEvents
      .filter((event) => event.source === "plugin" && event.status === "completed")
      .map((event) => event.eventName),
  );
  const missingEvents = [...CHECKPOINT_HOOK_EVENTS].filter(
    (eventName) => !completedEvents.has(eventName),
  );
  if (missingEvents.length > 0) {
    throw new Error(`checkpoint hook lifecycle was incomplete: ${missingEvents.join(", ")}`);
  }
}

export function createClient(options, report) {
  const appServerArguments = [
    "--dangerously-bypass-hook-trust",
    "-c",
    "features.hooks=true",
    "-c",
    "features.code_mode_host=true",
    ...(options.trigger === "auto"
      ? ["-c", `model_auto_compact_token_limit=${AUTOMATIC_TOKEN_LIMIT}`]
      : []),
    "app-server",
    "--stdio",
  ];
  const appServer = spawn("codex", appServerArguments, {
    cwd: options.projectPath,
    env: {
      ...process.env,
      CODEX_HOME: options.validationHome,
      CONTEXT_MODE_DIR: join(options.validationHome, "context-mode-state"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  const pendingRequests = new Map();
  const responseTextByTurn = new Map();
  let nextRequestId = 1;

  function send(message) {
    appServer.stdin.write(JSON.stringify(message) + "\n");
  }

  function request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = nextRequestId++;
    send({ id, method, params });

    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        rejectRequest(new Error(`${method} timed out`));
      }, timeoutMs);
      pendingRequests.set(id, { method, resolveRequest, rejectRequest, timer });
    });
  }

  function waitFor(predicate, timeoutMs, description, startIndex = 0) {
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setInterval(() => {
        const event = events.slice(startIndex).find(predicate);
        if (!event) {
          return;
        }
        clearInterval(timer);
        clearTimeout(timeout);
        resolveEvent(event);
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(timer);
        rejectEvent(new Error(`${description} timed out`));
      }, timeoutMs);
    });
  }

  createInterface({ input: appServer.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.rejectRequest(new Error(`${pending.method}: ${String(message.error.message)}`));
      } else {
        pending.resolveRequest(message.result);
      }
      return;
    }

    const parameters = message.params ?? {};
    const item = parameters.item ?? null;
    const turn = parameters.turn ?? null;
    const hookRun = parameters.run ?? null;
    const event = {
      method: message.method ?? null,
      itemType: item?.type ?? null,
      turnId: turn?.id ?? parameters.turnId ?? null,
      turnStatus: turn?.status ?? null,
      hookEventName: hookRun?.eventName ?? null,
      hookStatus: hookRun?.status ?? null,
      hookSource: hookRun?.source ?? null,
    };
    events.push(event);

    if (event.method === "item/agentMessage/delta" && typeof parameters.delta === "string" && event.turnId) {
      responseTextByTurn.set(event.turnId, (responseTextByTurn.get(event.turnId) ?? "") + parameters.delta);
    }
    if (event.method === "item/started" && event.itemType === "contextCompaction") {
      report.compactionStarted = true;
    }
    if (event.method === "item/completed" && event.itemType === "contextCompaction") {
      report.compactionCompleted = true;
    }
    if (event.method === "hook/started" || event.method === "hook/completed") {
      report.hookEvents.push({
        eventName: event.hookEventName,
        source: event.hookSource,
        status: event.hookStatus,
        turnId: event.turnId,
      });
    }
  });
  appServer.stderr.resume();

  async function close() {
    if (appServer.exitCode !== null) {
      return;
    }
    appServer.kill("SIGTERM");
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 2_000);
      appServer.once("exit", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }

  return { close, events, request, responseTextByTurn, send, waitFor };
}

function checkpointAttestationPrompt() {
  return [
    "Without using any tools, reply with exactly the checkpoint_id field from the historical confirmed checkpoint context.",
    "If no such context is available, reply with exactly NO-CHECKPOINT.",
    "Do not add quotes, Markdown, punctuation, or explanation.",
  ].join(" ");
}

async function startTurn(client, threadId, prompt) {
  const startedTurn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: prompt }],
  });
  const turnId = startedTurn.turn?.id ?? null;
  if (!turnId) {
    throw new Error("turn/start did not return a turn id");
  }
  return turnId;
}

async function waitForCompletedTurn(client, turnId, startIndex, description) {
  const completedTurn = await client.waitFor(
    (event) => event.method === "turn/completed" && event.turnId === turnId,
    TURN_TIMEOUT_MS,
    description,
    startIndex,
  );
  if (completedTurn.turnStatus !== "completed") {
    throw new Error(`${description} completed with status ${String(completedTurn.turnStatus)}`);
  }
}

async function runManualCompaction(client, threadId) {
  const eventStart = client.events.length;
  await client.request("thread/compact/start", { threadId });
  const compactStarted = await client.waitFor(
    (event) => event.method === "item/started" && event.itemType === "contextCompaction",
    COMPACTION_START_TIMEOUT_MS,
    "manual contextCompaction item/started",
    eventStart,
  );
  await client.waitFor(
    (event) => event.method === "item/completed" && event.itemType === "contextCompaction",
    COMPACTION_COMPLETE_TIMEOUT_MS,
    "manual contextCompaction item/completed",
    eventStart,
  );
  await client.waitFor(
    (event) => event.method === "turn/completed" && event.turnId === compactStarted.turnId,
    COMPACTION_START_TIMEOUT_MS,
    "manual compaction turn/completed",
    eventStart,
  );
}

export async function run(options, report, verification = null) {
  const client = createClient(options, report);
  const verificationPrompt = verification?.prompt ?? checkpointAttestationPrompt();
  try {
    await client.request("initialize", {
      clientInfo: {
        name: "context-mode-checkpoint-delivery",
        title: "Context Mode Checkpoint Delivery",
        version: "1.0",
      },
      capabilities: { experimentalApi: true },
    });
    client.send({ method: "initialized", params: {} });

    const effectiveConfig = await client.request("config/read", { cwd: options.projectPath });
    report.effectiveConfig = {
      model: effectiveConfig.config?.model ?? null,
      modelProvider: effectiveConfig.config?.model_provider ?? null,
      modelContextWindow: effectiveConfig.config?.model_context_window ?? null,
      autoCompactTokenLimit: effectiveConfig.config?.model_auto_compact_token_limit ?? null,
    };
    if (!report.effectiveConfig.modelProvider) {
      throw new Error("effective Codex configuration did not select a model provider");
    }
    if (options.trigger === "auto" && report.effectiveConfig.autoCompactTokenLimit !== AUTOMATIC_TOKEN_LIMIT) {
      throw new Error("automatic compaction threshold override was not effective");
    }

    const startedThread = await client.request("thread/start", {
      cwd: options.projectPath,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      serviceName: "context-mode-checkpoint-delivery",
    });
    report.threadId = startedThread.thread?.id ?? null;
    if (!report.threadId) {
      throw new Error("thread/start did not return a thread id");
    }

    if (options.trigger === "auto") {
      await client.request("thread/inject_items", {
        threadId: report.threadId,
        items: [{
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "Synthetic continuity history. " + "neutral ".repeat(AUTOMATIC_HISTORY_WORD_COUNT),
          }],
        }],
      });
    }

    const seedEventStart = client.events.length;
    report.seedTurnId = await startTurn(
      client,
      report.threadId,
      options.trigger === "manual" ? "Reply with exactly seed." : verificationPrompt,
    );
    await waitForCompletedTurn(client, report.seedTurnId, seedEventStart, "seed turn");

    let attestationEventStart = client.events.length;
    if (options.trigger === "manual") {
      await runManualCompaction(client, report.threadId);
      attestationEventStart = client.events.length;
      report.attestationTurnId = await startTurn(client, report.threadId, verificationPrompt);
      await waitForCompletedTurn(client, report.attestationTurnId, attestationEventStart, "attestation turn");
    } else {
      const seedCompaction = client.events.slice(seedEventStart).find(
        (event) => event.method === "item/started" && event.itemType === "contextCompaction",
      );
      if (seedCompaction) {
        report.attestationTurnId = report.seedTurnId;
        attestationEventStart = seedEventStart;
      } else {
        report.attestationTurnId = await startTurn(client, report.threadId, verificationPrompt);
        await waitForCompletedTurn(client, report.attestationTurnId, attestationEventStart, "automatic attestation turn");
      }
    }

    const compactionStart = await client.waitFor(
      (event) => event.method === "item/started" && event.itemType === "contextCompaction",
      COMPACTION_START_TIMEOUT_MS,
      `${options.trigger} contextCompaction item/started`,
      options.trigger === "manual" ? 0 : attestationEventStart,
    );
    await client.waitFor(
      (event) => event.method === "item/completed" && event.itemType === "contextCompaction",
      COMPACTION_COMPLETE_TIMEOUT_MS,
      `${options.trigger} contextCompaction item/completed`,
      options.trigger === "manual" ? 0 : attestationEventStart,
    );
    verifyCompletedCheckpointHooks(report.hookEvents);

    const checkpointEvidence = findCheckpoint(options.validationHome, report.threadId);
    if (!checkpointEvidence) {
      throw new Error("checkpoint database did not contain the target session");
    }
    if (checkpointEvidence.checkpoint.trigger !== options.trigger) {
      throw new Error("checkpoint trigger did not match the requested host gate");
    }
    if (checkpointEvidence.checkpoint.state !== "claimed") {
      throw new Error("checkpoint was not claimed by SessionStart(compact)");
    }

    const expectedTransitions = [
      ["pending", "pending", "created"],
      ["pending", "confirmed", "postcompact_succeeded"],
      ["confirmed", "claimed", "sessionstart_context_emitted"],
    ];
    const actualTransitions = checkpointEvidence.transitions.map((transition) => [
      transition.from_state,
      transition.to_state,
      transition.reason,
    ]);
    if (JSON.stringify(actualTransitions) !== JSON.stringify(expectedTransitions)) {
      throw new Error("checkpoint transitions did not match the confirmed delivery protocol");
    }

    const assistantResponse = (client.responseTextByTurn.get(report.attestationTurnId) ?? "").trim();
    const itemTypes = [...new Set(
      client.events
        .slice(attestationEventStart)
        .filter((event) => event.method === "item/started" && event.turnId === report.attestationTurnId)
        .map((event) => event.itemType)
        .filter((itemType) => itemType !== null),
    )].sort();
    const unexpectedItemTypes = itemTypes.filter((itemType) => !RESPONSE_ITEM_TYPES.has(itemType));
    const verificationResult = verification === null
      ? {
        attestation: {
          assistantResponseLength: Buffer.byteLength(assistantResponse, "utf8"),
          assistantResponseSha256: sha256(assistantResponse),
          checkpointIdSha256: sha256(checkpointEvidence.checkpoint.checkpoint_id),
          matchesCheckpointId: assistantResponse === checkpointEvidence.checkpoint.checkpoint_id,
          observedItemTypes: itemTypes,
          unexpectedItemTypes,
        },
        error: assistantResponse === checkpointEvidence.checkpoint.checkpoint_id
          ? unexpectedItemTypes.length > 0
            ? "attestation turn used a non-response item type"
            : null
          : "assistant response did not attest the hook-only checkpoint id",
      }
      : await verification({
        assistantResponse,
        checkpointEvidence,
        itemTypes,
        unexpectedItemTypes,
      });
    report.checkpoint = {
      state: checkpointEvidence.checkpoint.state,
      trigger: checkpointEvidence.checkpoint.trigger,
      transitionReasons: checkpointEvidence.transitions.map((transition) => transition.reason),
    };
    report.attestation = verificationResult.attestation;
    if (verificationResult.error) {
      throw new Error(verificationResult.error);
    }
    if (compactionStart.turnId !== report.attestationTurnId && options.trigger === "auto") {
      throw new Error("automatic compaction did not occur in the attestation turn");
    }

    report.status = "passed";
  } finally {
    await client.close();
  }
}

async function main() {
  const options = resolveOptions();
  const report = createReport(options);
  writeReport(options.reportPath, report);

  try {
    await run(options, report);
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
  }

  writeReport(options.reportPath, report);
  if (report.status !== "passed") {
    process.exitCode = 1;
  }
}

const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  await main();
}
