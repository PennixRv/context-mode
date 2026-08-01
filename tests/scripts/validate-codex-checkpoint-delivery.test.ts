import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatReleaseHookTrustState } from "../../scripts/validate-codex-checkpoint-delivery.mjs";

const repositoryRoot = resolve(__dirname, "..", "..");
const validatorSource = readFileSync(
  resolve(repositoryRoot, "scripts", "validate-codex-checkpoint-delivery.mjs"),
  "utf8",
);

describe("Codex checkpoint delivery attestation release boundary", () => {
  test("requires an installed offline release payload instead of the source tree", () => {
    expect(validatorSource).toContain('requireEnvironmentDirectory("CONTEXT_MODE_RELEASE_PLUGIN_ROOT")');
    expect(validatorSource).toContain("CONTEXT_MODE_RELEASE_PLUGIN_ROOT must stay inside CONTEXT_MODE_VALIDATION_HOME/plugins/cache");
    expect(validatorSource).toContain("context-mode-offline");
    expect(validatorSource).toContain('"hooks/checkpoint-diagnostics.mjs"');
    expect(validatorSource).toContain("release payload must not contain node_modules");
  });

  test("derives temporary hook trust only from Codex-discovered release hooks", () => {
    const releasePluginRoot = repositoryRoot;
    const hookConfig = JSON.parse(readFileSync(
      resolve(releasePluginRoot, ".codex-plugin", "hooks.json"),
      "utf8",
    ));
    const hooks = Object.entries(hookConfig.hooks).flatMap(([eventName, entries]) => entries.flatMap(
      (entry: { hooks: unknown[] }, entryIndex: number) => entry.hooks.map((_, hookIndex) => ({
        pluginId: "context-mode@context-mode-offline",
        source: "plugin",
        trustStatus: "untrusted",
        sourcePath: resolve(releasePluginRoot, ".codex-plugin", "hooks.json"),
        key: `context-mode@context-mode-offline:.codex-plugin/hooks.json:${eventName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "")}:${entryIndex}:${hookIndex}`,
        currentHash: `sha256:${"a".repeat(64)}`,
      })),
    ));
    const trustState = formatReleaseHookTrustState(releasePluginRoot, { data: [{ hooks }] });

    expect(trustState).toContain('[hooks.state."context-mode@context-mode-offline:.codex-plugin/hooks.json:pre_compact:0:0"]');
    expect(trustState).toContain(`trusted_hash = "sha256:${"a".repeat(64)}"`);
    expect(() => formatReleaseHookTrustState(releasePluginRoot, {
      data: [{ hooks: hooks.slice(1) }],
    })).toThrow(/every release plugin hook/);
    expect(validatorSource).toContain('client.request("hooks/list", { cwds: [options.projectPath] })');
    expect(validatorSource).toContain('"features.hooks=true"');
    expect(validatorSource).not.toContain('"--dangerously-bypass-hook-trust"');
  });

  test("keeps automatic synthetic history above the compact threshold without excess provider load", () => {
    const historyWordCount = Number(
      validatorSource.match(/AUTOMATIC_HISTORY_WORD_COUNT = ([0-9_]+)/)?.[1].replaceAll("_", ""),
    );
    const tokenLimit = Number(
      validatorSource.match(/AUTOMATIC_TOKEN_LIMIT = ([0-9_]+)/)?.[1].replaceAll("_", ""),
    );

    expect(historyWordCount).toBe(3_000);
    expect(tokenLimit).toBe(2_000);
    expect(historyWordCount).toBeGreaterThan(tokenLimit);
  });
});
