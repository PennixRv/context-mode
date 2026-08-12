export type InstallationChannel =
  | "npm"
  | "codex-marketplace"
  | "standalone-git"
  | "unknown";

export type VersionRelation =
  | "local-newer"
  | "equal"
  | "remote-newer"
  | "uncomparable";

export interface InstallationChannelFacts {
  adapterName: string;
  installedVersion: string;
  packageRoot: string;
  sourceCheckout: boolean;
}

interface ParsedSemanticVersion {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: Array<bigint | string>;
}

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  const prereleaseIdentifiers = match[4]?.split(".") ?? [];
  if (prereleaseIdentifiers.some((identifier) => /^0\d+$/.test(identifier))) {
    return null;
  }
  const prerelease = match[4]
    ? prereleaseIdentifiers.map((identifier): bigint | string => {
      if (!/^\d+$/.test(identifier)) return identifier;
      return BigInt(identifier);
    })
    : [];
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease,
  };
}

/** Compare semantic versions. Returns null when either value is not SemVer. */
export function compareSemanticVersions(
  left: string,
  right: string,
): -1 | 0 | 1 | null {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  if (!a || !b) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const identifiers = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < identifiers; index++) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    if (typeof av === "bigint" && typeof bv === "string") return -1;
    if (typeof av === "string" && typeof bv === "bigint") return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function assessVersionRelation(
  localVersion: string,
  remoteVersion: string,
): VersionRelation {
  const comparison = compareSemanticVersions(localVersion, remoteVersion);
  if (comparison === null) return "uncomparable";
  if (comparison > 0) return "local-newer";
  if (comparison < 0) return "remote-newer";
  return "equal";
}

export function channelUsesNpmRegistry(channel: InstallationChannel): boolean {
  return channel === "npm";
}

/** Infer the update channel without treating every installation as npm. */
export function inferInstallationChannel(
  facts: InstallationChannelFacts,
): InstallationChannel {
  const normalizedRoot = facts.packageRoot.replace(/\\/g, "/").toLowerCase();
  // The running artifact's root is stronger evidence than another plugin
  // installed in the same host. This keeps npm/source invocations distinct
  // when Codex also has a marketplace plugin enabled.
  if (normalizedRoot.includes("/node_modules/context-mode")) return "npm";
  if (facts.sourceCheckout) return "standalone-git";
  if (
    facts.adapterName === "Codex CLI"
    && facts.installedVersion !== "standalone"
    && facts.installedVersion !== "not installed"
  ) {
    return "codex-marketplace";
  }
  return "unknown";
}
