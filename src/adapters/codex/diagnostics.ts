export type CodexDiagnosticState =
  | "present"
  | "missing"
  | "unavailable"
  | "not_applicable";

export type CodexDiagnosticReason =
  | "plugin_inventory_command_failed"
  | "plugin_inventory_output_empty"
  | "plugin_inventory_output_invalid"
  | "plugin_not_listed"
  | "plugin_not_installed"
  | "plugin_disabled"
  | "plugin_identity_unreported"
  | "plugin_version_unreported"
  | "plugin_installation_unreported"
  | "plugin_enabled_unreported"
  | "plugin_source_unreported"
  | "plugin_cache_root_unreported"
  | "plugin_cache_manifest_missing"
  | "plugin_cache_manifest_unavailable"
  | "codex_config_unavailable"
  | "runtime_root_unavailable"
  | "runtime_cache_not_comparable"
  | "runtime_release_mismatch"
  | "runtime_manifest_missing"
  | "runtime_manifest_unavailable"
  | "runtime_hooks_missing"
  | "host_session_hooks_not_loaded"
  | "host_session_observation_unavailable";

export interface CodexDiagnosticObservation<T = string> {
  state: CodexDiagnosticState;
  value?: T;
  reason?: CodexDiagnosticReason;
}

export interface CodexPluginListEntry {
  state: "present" | "missing" | "unavailable";
  reason?: CodexDiagnosticReason;
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
  pluginListReason?: CodexDiagnosticReason;
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
  if (!text) {
    return { state: "unavailable", reason: "plugin_inventory_output_empty" };
  }

  try {
    const payload = objectField(JSON.parse(text));
    if (!payload) {
      return { state: "unavailable", reason: "plugin_inventory_output_invalid" };
    }
    const rows = [
      ...(Array.isArray(payload.installed) ? payload.installed : []),
      ...(Array.isArray(payload.available) ? payload.available : []),
    ];
    const row = rows
      .map(objectField)
      .find((candidate) => stringField(candidate?.pluginId)?.startsWith("context-mode@"));
    if (!row) return { state: "missing", reason: "plugin_not_listed" };

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
      ? { state: "missing", reason: "plugin_not_listed" }
      : { state: "unavailable", reason: "plugin_inventory_output_invalid" };
  }
}

function observed<T = string>(
  state: CodexDiagnosticState,
  value?: T,
  reason?: CodexDiagnosticReason,
): CodexDiagnosticObservation<T> {
  return {
    state,
    ...(value === undefined ? {} : { value }),
    ...(state === "present" || reason === undefined ? {} : { reason }),
  };
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

  const inventoryUnavailableReason = facts.pluginListReason
    ?? "plugin_inventory_command_failed";
  const absentReason = installed === false
    ? "plugin_not_installed" as const
    : "plugin_not_listed" as const;

  const identity: CodexDiagnosticObservation<string> = facts.pluginId
    ? observed<string>("present", facts.pluginId)
    : observed<string>(
        pluginListState === "missing" ? "missing" : "unavailable",
        undefined,
        pluginListState === "missing"
          ? absentReason
          : pluginListState === "unavailable"
            ? inventoryUnavailableReason
            : "plugin_identity_unreported",
      );
  const version: CodexDiagnosticObservation<string> = facts.version
    ? observed<string>("present", facts.version)
    : observed<string>(
        pluginListState === "missing" ? "not_applicable" : "unavailable",
        undefined,
        pluginListState === "missing" ? absentReason : "plugin_version_unreported",
      );
  const installation = pluginListState === "unavailable"
    ? observed<boolean>("unavailable", undefined, inventoryUnavailableReason)
    : installed === true
      ? observed("present", true)
      : installed === false
        ? observed("missing", false, "plugin_not_installed")
        : observed<boolean>("unavailable", undefined, "plugin_installation_unreported");
  const enabledCheck = installed === false
      ? observed<boolean>("not_applicable", undefined, "plugin_not_installed")
      : enabledValue === null
        ? observed<boolean>(
            "unavailable",
            undefined,
            pluginListState === "unavailable"
              ? inventoryUnavailableReason
              : "plugin_enabled_unreported",
          )
        : enabledValue === true
        ? observed("present", true)
        : observed("missing", false, "plugin_disabled");
  const sourceRoot: CodexDiagnosticObservation<string> = facts.sourceRoot
    ? observed<string>("present", facts.sourceRoot)
    : observed<string>(
        pluginListState === "missing" ? "not_applicable" : "unavailable",
        undefined,
        pluginListState === "missing"
          ? absentReason
          : pluginListState === "unavailable"
            ? inventoryUnavailableReason
            : "plugin_source_unreported",
      );
  const cacheRoot: CodexDiagnosticObservation<string> = facts.cacheRoot
    ? observed<string>("present", facts.cacheRoot)
    : installed === false || pluginListState === "missing"
      ? observed<string>("not_applicable", undefined, absentReason)
      : observed<string>(
          "unavailable",
          undefined,
          pluginListState === "unavailable"
            ? inventoryUnavailableReason
            : "plugin_cache_root_unreported",
        );
  const cacheManifest: CodexDiagnosticObservation<string> = facts.cacheRoot === null || facts.cacheRoot === undefined
    ? observed<string>(pluginListState === "missing" || installed === false
      ? "not_applicable"
      : "unavailable", undefined, pluginListState === "missing" || installed === false
        ? absentReason
        : pluginListState === "unavailable"
          ? inventoryUnavailableReason
          : "plugin_cache_root_unreported")
    : facts.cacheManifestAvailable === true
      ? observed<string>("present")
      : facts.cacheManifestAvailable === false
        ? observed<string>("missing", undefined, "plugin_cache_manifest_missing")
        : observed<string>("unavailable", undefined, "plugin_cache_manifest_unavailable");
  const runtimeRootCheck: CodexDiagnosticObservation<string> = runtimeRoot
    ? observed<string>("present", runtimeRoot)
    : observed<string>("unavailable", undefined, "runtime_root_unavailable");
  const runtimeCacheAlignment: CodexDiagnosticObservation<
    "same" | "different_matching_release" | "different_release"
  > = facts.cacheRoot === null || facts.cacheRoot === undefined
    ? observed<"same" | "different_matching_release" | "different_release">(
        installed === false || pluginListState === "missing" ? "not_applicable" : "unavailable",
        undefined,
        installed === false || pluginListState === "missing"
          ? absentReason
          : pluginListState === "unavailable"
            ? inventoryUnavailableReason
            : "runtime_cache_not_comparable",
      )
    : facts.sameRoot === true
      ? observed("present", "same" as const)
      : facts.sameRoot === false && facts.releaseMatches === true
        ? observed("present", "different_matching_release" as const)
        : facts.sameRoot === false && facts.releaseMatches === false
          ? observed("missing", "different_release" as const, "runtime_release_mismatch")
          : observed<"same" | "different_matching_release" | "different_release">(
              "unavailable",
              undefined,
              "runtime_cache_not_comparable",
            );
  const manifest: CodexDiagnosticObservation<string> = runtimeRoot === null
    ? observed<string>("unavailable", undefined, "runtime_root_unavailable")
    : facts.runtimeManifestAvailable === true
      ? observed<string>("present")
      : facts.runtimeManifestAvailable === false
        ? observed<string>("missing", undefined, "runtime_manifest_missing")
        : observed<string>("unavailable", undefined, "runtime_manifest_unavailable");
  const hooks = manifest.state === "missing" || manifest.state === "not_applicable"
    ? observed<string[]>("not_applicable", undefined, "runtime_manifest_missing")
    : manifest.state === "unavailable"
      ? observed<string[]>("unavailable", undefined, manifest.reason ?? "runtime_root_unavailable")
      : missingHooks.length > 0
        ? observed("missing", missingHooks, "runtime_hooks_missing")
        : observed("present", registeredHooks);
  const sessionHooksLoaded = installed === false || pluginListState === "missing"
      ? observed<boolean>("not_applicable", undefined, absentReason)
    : enabledValue === false
      ? observed<boolean>("not_applicable", undefined, "plugin_disabled")
    : facts.sessionHooksLoaded === true
      ? observed("present", true)
      : facts.sessionHooksLoaded === false
        ? observed("missing", false, "host_session_hooks_not_loaded")
        : observed<boolean>(
            "unavailable",
            undefined,
            "host_session_observation_unavailable",
          );

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
