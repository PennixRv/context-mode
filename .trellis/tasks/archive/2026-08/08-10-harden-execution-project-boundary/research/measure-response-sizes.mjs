import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Archived task evidence remains replayable after archival by forwarding to
// the maintained repository-level measurement entry point.
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();

await import(pathToFileURL(join(repoRoot, "scripts", "measure-response-sizes.mjs")).href);
