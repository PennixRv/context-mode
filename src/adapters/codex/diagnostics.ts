export interface CodexPluginDiagnostic {
  channel: "codex-marketplace" | "standalone";
  pluginId: string | null;
  version: string | null;
  enabled: boolean;
  configuredRoot: string;
  configuredManifestAvailable: boolean;
  runtimeRoot: string | null;
  runtimeManifestAvailable: boolean;
  rootMismatch: boolean;
  releaseMatches: boolean;
  hooksAvailable: boolean;
  ownsHooksForUpgrade: boolean;
  requiredHooks: string[];
  registeredHooks: string[];
  missingHooks: string[];
}

export interface CodexPluginDiagnosticFacts {
  enabled: boolean;
  pluginId?: string | null;
  version?: string | null;
  configuredRoot: string;
  configuredManifestAvailable: boolean;
  runtimeRoot: string | null;
  runtimeManifestAvailable: boolean;
  sameRoot: boolean;
  releaseMatches: boolean;
  requiredHooks?: string[];
  registeredHooks?: string[];
}

/** Project raw Codex/plugin-list facts into the shared Doctor model. */
export function projectCodexPluginDiagnostic(
  facts: CodexPluginDiagnosticFacts,
): CodexPluginDiagnostic {
  const rootMismatch = facts.runtimeRoot !== null && !facts.sameRoot;
  const requiredHooks = facts.requiredHooks ?? [];
  const registeredHooks = facts.registeredHooks ?? [];
  const missingHooks = requiredHooks.filter((hook) => !registeredHooks.includes(hook));
  // An enabled marketplace plugin is active only at the root reported by
  // `codex plugin list`. A manifest beside the Doctor binary is useful for
  // drift diagnosis, but cannot prove runtime hook registration.
  const manifestAvailable = facts.enabled
    ? facts.runtimeRoot !== null && facts.runtimeManifestAvailable
    : facts.configuredManifestAvailable;
  const hooksAvailable = facts.enabled
    && manifestAvailable
    && (requiredHooks.length === 0 || missingHooks.length === 0);
  return {
    channel: facts.enabled ? "codex-marketplace" : "standalone",
    pluginId: facts.pluginId ?? null,
    version: facts.version ?? null,
    enabled: facts.enabled,
    configuredRoot: facts.configuredRoot,
    configuredManifestAvailable: facts.configuredManifestAvailable,
    runtimeRoot: facts.runtimeRoot,
    runtimeManifestAvailable: facts.runtimeManifestAvailable,
    rootMismatch,
    releaseMatches: facts.runtimeRoot !== null
      && rootMismatch
      && facts.releaseMatches,
    hooksAvailable,
    ownsHooksForUpgrade: facts.enabled
      && facts.runtimeRoot !== null
      && facts.runtimeManifestAvailable
      && !rootMismatch
      && missingHooks.length === 0,
    requiredHooks,
    registeredHooks,
    missingHooks,
  };
}
