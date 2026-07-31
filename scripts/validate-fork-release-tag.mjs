#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const RELEASE_REF = "refs/remotes/origin/devel";

function resolveCommit(ref, description) {
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  if (result.status !== 0 || result.error) {
    throw new Error(`Unable to resolve ${description}.`);
  }

  const commit = result.stdout.trim();
  if (!commit) {
    throw new Error(`Unable to resolve ${description}.`);
  }
  return commit;
}

function validateReleaseTag(tagName) {
  const tagCommit = resolveCommit(
    `refs/tags/${tagName}`,
    `release tag ${tagName}`,
  );
  resolveCommit(RELEASE_REF, "fork release ref origin/devel");

  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", tagCommit, RELEASE_REF],
    { stdio: "ignore" },
  );

  if (ancestry.status === 0) {
    return;
  }
  if (ancestry.status === 1) {
    throw new Error(
      `Release tag ${tagName} is not reachable from fork release ref origin/devel.`,
    );
  }
  throw new Error("Unable to validate release tag ancestry against origin/devel.");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].length === 0) {
    throw new Error(
      "Usage: node scripts/validate-fork-release-tag.mjs <release-tag>",
    );
  }

  validateReleaseTag(args[0]);
  console.log(`Release tag ${args[0]} is reachable from fork release ref origin/devel.`);
}

const isDirectInvocation =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
