import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
});
