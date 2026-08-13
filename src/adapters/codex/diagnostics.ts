export type CodexDiagnosticState =
  | "present"
  | "missing"
  | "unavailable"
  | "not_applicable";

export interface CodexDiagnosticObservation<T = string> {
  state: CodexDiagnosticState;
  value?: T;
}

export interface CodexPluginListEntry {
  state: "present" | "missing" | "unavailable";
  pluginId?: string;
  version?: string;
  installed?: boolean;
  enabled?: boolean;
  sourceRoot?: string;
  cacheRoot?: string;
}

export interface CodexPluginDiagnosticChecks {
  identity: CodexDiagnosticObservation;
  version: CodexDiagnosticObservation;
  installation: CodexDiagnosticObservation<boolean>;
  enabled: CodexDiagnosticObservation<boolean>;
  sourceRoot: CodexDiagnosticObservation;
  cacheRoot: CodexDiagnosticObservation;
  cacheManifest: CodexDiagnosticObservation;
  runtimeRoot: CodexDiagnosticObservation;
  runtimeCacheAlignment: CodexDiagnosticObservation<
    "same" | "different_matching_release" | "different_release"
  >;
  manifest: CodexDiagnosticObservation;
  hooks: CodexDiagnosticObservation<string[]>;
  sessionHooksLoaded: CodexDiagnosticObservation<boolean>;
}

export interface CodexPluginDiagnostic {
  channel: "codex-marketplace" | "standalone";
  pluginId: string | null;
  version: string | null;
  installed: boolean | null;
  enabled: boolean | null;
  sourceRoot: string | null;
  cacheRoot: string | null;
  configuredRoot: string;
  configuredManifestAvailable: boolean | null;
  runtimeRoot: string | null;
  runtimeManifestAvailable: boolean | null;
  rootMismatch: boolean | null;
  releaseMatches: boolean | null;
  hooksAvailable: boolean;
  ownsHooksForUpgrade: boolean;
  requiredHooks: string[];
  registeredHooks: string[];
  missingHooks: string[];
  checks: CodexPluginDiagnosticChecks;
}

export interface CodexPluginDiagnosticFacts {
  pluginListState?: "present" | "missing" | "unavailable";
  installed?: boolean | null;
  enabled?: boolean | null;
  pluginId?: string | null;
  version?: string | null;
  sourceRoot?: string | null;
  cacheRoot?: string | null;
  configuredRoot?: string;
  configuredManifestAvailable?: boolean;
  runtimeRoot: string | null;
  runtimeManifestAvailable: boolean | null;
  cacheManifestAvailable?: boolean | null;
  sameRoot: boolean | null;
  releaseMatches: boolean | null;
  requiredHooks?: string[];
  registeredHooks?: string[];
  sessionHooksLoaded?: boolean | null;
}

/** Stable, content-free cross-entry diagnostic summary. */
export function serializeCodexPluginDiagnostic(
  diagnostic: CodexPluginDiagnostic,
): string {
  return JSON.stringify({
    channel: diagnostic.channel,
    plugin_id: diagnostic.pluginId,
    version: diagnostic.version,
    installed: diagnostic.installed,
    enabled: diagnostic.enabled,
    source_root: diagnostic.sourceRoot,
    cache_root: diagnostic.cacheRoot,
    runtime_root: diagnostic.runtimeRoot,
    checks: {
      "codex.plugin.identity": diagnostic.checks.identity,
      "codex.plugin.version": diagnostic.checks.version,
      "codex.plugin.installation": diagnostic.checks.installation,
      "codex.plugin.enabled": diagnostic.checks.enabled,
      "codex.plugin.source_root": diagnostic.checks.sourceRoot,
      "codex.plugin.cache_root": diagnostic.checks.cacheRoot,
      "codex.plugin.cache_manifest": diagnostic.checks.cacheManifest,
      "codex.plugin.runtime_root": diagnostic.checks.runtimeRoot,
      "codex.plugin.runtime_cache_alignment": diagnostic.checks.runtimeCacheAlignment,
      "codex.plugin.runtime_manifest": diagnostic.checks.manifest,
      "codex.plugin.runtime_hooks": diagnostic.checks.hooks,
      "codex.plugin.session_hooks_loaded": diagnostic.checks.sessionHooksLoaded,
    },
  });
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Parse `codex plugin list --json`, with bounded compatibility for legacy text output. */
export function parseCodexPluginList(raw: string): CodexPluginListEntry {
  const text = raw.trim();
  if (!text) return { state: "unavailable" };

  try {
    const payload = objectField(JSON.parse(text));
    if (!payload) return { state: "unavailable" };
    const rows = [
      ...(Array.isArray(payload.installed) ? payload.installed : []),
      ...(Array.isArray(payload.available) ? payload.available : []),
    ];
    const row = rows
      .map(objectField)
      .find((candidate) => stringField(candidate?.pluginId)?.startsWith("context-mode@"));
    if (!row) return { state: "missing" };

    const marketplaceSource = objectField(row.marketplaceSource);
    return {
      state: "present",
      pluginId: stringField(row.pluginId),
      version: stringField(row.version) ?? stringField(row.localVersion),
      installed: typeof row.installed === "boolean" ? row.installed : undefined,
      enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
      sourceRoot: stringField(marketplaceSource?.source),
      cacheRoot: stringField(row.installedPath),
    };
  } catch {
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(context-mode@[^\s]+)\s+(installed|not installed),\s+(enabled|disabled)\s+(\S+)\s+(.+?)\s*$/,
      );
      if (!match) continue;
      return {
        state: "present",
        pluginId: match[1],
        installed: match[2] === "installed",
        enabled: match[3] === "enabled",
        version: match[4],
        cacheRoot: match[5]?.trim(),
      };
    }
    return /no plugins installed/i.test(text)
      ? { state: "missing" }
      : { state: "unavailable" };
  }
}

function observed<T = string>(
  state: CodexDiagnosticState,
  value?: T,
): CodexDiagnosticObservation<T> {
  return value === undefined ? { state } : { state, value };
}

/** Project raw Codex/plugin-list facts into the shared Doctor model. */
export function projectCodexPluginDiagnostic(
  facts: CodexPluginDiagnosticFacts,
): CodexPluginDiagnostic {
  const pluginListState = facts.pluginListState
    ?? (facts.enabled === null || facts.enabled === undefined
      ? "unavailable"
      : facts.enabled
        ? facts.runtimeRoot === null ? "unavailable" : "present"
        : "missing");
  const installed = facts.installed
    ?? (pluginListState === "missing" ? false : null);
  const enabledValue = facts.enabled ?? null;
  const enabled = enabledValue;
  const runtimeRoot = facts.runtimeRoot;
  const configuredRoot = facts.configuredRoot ?? runtimeRoot ?? "";
  const runtimeManifestAvailable = facts.runtimeManifestAvailable;
  const configuredManifestAvailable = facts.configuredManifestAvailable
    ?? runtimeManifestAvailable;
  const requiredHooks = facts.requiredHooks ?? [];
  const registeredHooks = facts.registeredHooks ?? [];
  const missingHooks = runtimeManifestAvailable === true
    ? requiredHooks.filter((hook) => !registeredHooks.includes(hook))
    : [];
  const rootMismatch = runtimeRoot === null || facts.sameRoot === null
    ? null
    : facts.sameRoot === false;
  const releaseMatches = rootMismatch === true ? facts.releaseMatches : null;
  const hooksAvailable = enabled === true
    && runtimeManifestAvailable === true
    && missingHooks.length === 0;

  const identity = facts.pluginId
    ? observed("present", facts.pluginId)
    : observed(pluginListState === "missing" ? "missing" : "unavailable");
  const version = facts.version
    ? observed("present", facts.version)
    : observed(pluginListState === "missing" ? "not_applicable" : "unavailable");
  const installation = pluginListState === "unavailable"
    ? observed<boolean>("unavailable")
    : installed === true
      ? observed("present", true)
      : installed === false
        ? observed("missing", false)
        : observed<boolean>("unavailable");
  const enabledCheck = installed === false && enabledValue === null
      ? observed<boolean>("not_applicable")
      : enabledValue === null
        ? observed<boolean>("unavailable")
        : enabledValue === true
        ? observed("present", true)
        : observed("missing", false);
  const sourceRoot = facts.sourceRoot
    ? observed("present", facts.sourceRoot)
    : observed(pluginListState === "missing" ? "not_applicable" : "unavailable");
  const cacheRoot = facts.cacheRoot
    ? observed("present", facts.cacheRoot)
    : facts.cacheManifestAvailable === false || installed === false
      ? observed("missing")
      : observed(pluginListState === "missing" ? "not_applicable" : "unavailable");
  const cacheManifest = facts.cacheRoot === null || facts.cacheRoot === undefined
    ? observed(pluginListState === "missing" || installed === false
      ? "not_applicable"
      : "unavailable")
    : facts.cacheManifestAvailable === true
      ? observed("present")
      : facts.cacheManifestAvailable === false
        ? observed("missing")
        : observed("unavailable");
  const runtimeRootCheck = runtimeRoot
    ? observed("present", runtimeRoot)
    : observed("unavailable");
  const runtimeCacheAlignment = facts.cacheRoot === null || facts.cacheRoot === undefined
    ? observed<"same" | "different_matching_release" | "different_release">(
        installed === false || pluginListState === "missing" ? "not_applicable" : "unavailable",
      )
    : facts.sameRoot === true
      ? observed("present", "same" as const)
      : facts.sameRoot === false && facts.releaseMatches === true
        ? observed("present", "different_matching_release" as const)
        : facts.sameRoot === false && facts.releaseMatches === false
          ? observed("missing", "different_release" as const)
          : observed<"same" | "different_matching_release" | "different_release">("unavailable");
  const manifest = runtimeRoot === null
    ? observed("unavailable")
    : facts.runtimeManifestAvailable === true
      ? observed("present")
      : facts.runtimeManifestAvailable === false
        ? observed("missing")
        : observed("unavailable");
  const hooks = manifest.state === "missing" || manifest.state === "not_applicable"
    ? observed<string[]>("not_applicable")
    : manifest.state === "unavailable"
      ? observed<string[]>("unavailable")
      : missingHooks.length > 0
        ? observed("missing", missingHooks)
        : observed("present", registeredHooks);
  const sessionHooksLoaded = enabledValue === false
    ? observed<boolean>("not_applicable")
    : pluginListState === "missing" && enabledValue === null
      ? observed<boolean>("not_applicable")
    : facts.sessionHooksLoaded === true
      ? observed("present", true)
      : facts.sessionHooksLoaded === false
        ? observed("missing", false)
        : observed<boolean>("unavailable");

  return {
    channel: enabled === true || (pluginListState === "present" && facts.pluginId !== undefined)
      ? "codex-marketplace"
      : "standalone",
    pluginId: facts.pluginId ?? null,
    version: facts.version ?? null,
    installed,
    enabled,
    sourceRoot: facts.sourceRoot ?? null,
    cacheRoot: facts.cacheRoot ?? null,
    configuredRoot,
    configuredManifestAvailable,
    runtimeRoot,
    runtimeManifestAvailable,
    rootMismatch,
    releaseMatches,
    hooksAvailable,
    ownsHooksForUpgrade: enabled === true
      && pluginListState === "present"
      && installed === true
      && runtimeRoot !== null
      && runtimeManifestAvailable === true
      && facts.cacheManifestAvailable === true
      && facts.sameRoot === true
      && missingHooks.length === 0,
    requiredHooks,
    registeredHooks,
    missingHooks,
    checks: {
      identity,
      version,
      installation,
      enabled: enabledCheck,
      sourceRoot,
      cacheRoot,
      cacheManifest,
      runtimeRoot: runtimeRootCheck,
      runtimeCacheAlignment,
      manifest,
      hooks,
      sessionHooksLoaded,
    },
  };
}
