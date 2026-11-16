// src/cli/args.ts: flags, help text and typo hints for setup, doctor and upgrade (ADR-0019 section 8, D7).
// Pure module: no I/O, so the golden --help tests and the usage-error tests need no TTY.
import { ADAPTERS } from "../adapters/table.ts";
import { SUPPORTED_AGENTS_LINE, UNSUPPORTED_SETUP_LINE } from "../core/ops/unsupported-host.ts";
import { unsupportedHostByName } from "../core/ops/unsupported-host.ts";
import type { AgentId } from "../core/contracts/agents.ts";

export type Command = "setup" | "doctor" | "upgrade";
export const COMMANDS: readonly Command[] = ["setup", "doctor", "upgrade"];
export const ALL_COMMANDS: readonly string[] = ["setup", "doctor", "upgrade", "server", "mcp", "hook", "help"];
export const AGENT_IDS: readonly AgentId[] = ADAPTERS.map((a) => a.id);

export interface Flags {
  help: boolean; json: boolean; yes: boolean; noInput: boolean; dryRun: boolean; debug: boolean;
  quiet: boolean; verbose: boolean; noColor: boolean; list: boolean; remove: boolean; repair: boolean;
  agents?: AgentId[]; tag?: string; print?: AgentId;
}

const COMMON = ["--help", "-h", "--json", "--yes", "-y", "--no-input", "--debug", "--quiet", "-q", "--verbose", "--no-color", "--agents"];
const FLAGS: Readonly<Record<Command, readonly string[]>> = {
  setup: [...COMMON, "--dry-run", "--list", "--remove", "--repair", "--print"],
  doctor: COMMON,
  upgrade: [...COMMON, "--dry-run", "--tag"],
};
const VALUE_FLAGS = new Set(["--agents", "--tag", "--print"]);
const TAG_RE = /^[a-z0-9][a-z0-9.+-]*$/i; // npm dist-tag or semver; never reaches a shell unquoted

export class UsageError extends Error {}

/** D-UNSUPPORTED-HOSTS-1: a known unsupported host gets the positive line; any other name gets the supported list. */
function badAgent(name: string): UsageError {
  const h = unsupportedHostByName(name);
  if (h !== undefined) return new UsageError(UNSUPPORTED_SETUP_LINE(h.name));
  return new UsageError(`unknown agent "${name}".${suggest(name, AGENT_IDS)} ${SUPPORTED_AGENTS_LINE} Run context-mode setup --list.`);
}

/** Levenshtein distance, small inputs only (commands, flags, agent ids). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** ` Did you mean "x"?` for the closest candidate within reach, else "". */
export function suggest(word: string, candidates: readonly string[]): string {
  let best = "";
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(word, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? ` Did you mean "${best}"?` : "";
}

export function parseFlags(cmd: Command, argv: readonly string[]): Flags {
  const f: Flags = { help: false, json: false, yes: false, noInput: false, dryRun: false, debug: false, quiet: false, verbose: false, noColor: false, list: false, remove: false, repair: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    if (!FLAGS[cmd].includes(name)) {
      const kind = name.startsWith("-") ? "option" : "argument";
      throw new UsageError(`unknown ${kind} "${name}" for context-mode ${cmd}.${name.startsWith("-") ? suggest(name, FLAGS[cmd]) : ""}`);
    }
    let value: string | undefined;
    if (VALUE_FLAGS.has(name)) {
      value = eq > 0 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined || value === "" || value.startsWith("-")) throw new UsageError(`${name} needs a value.`);
    } else if (eq > 0) throw new UsageError(`${name} takes no value.`);
    switch (name) {
      case "--help": case "-h": f.help = true; break;
      case "--json": f.json = true; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--no-input": f.noInput = true; break;
      case "--dry-run": f.dryRun = true; break;
      case "--debug": f.debug = true; break;
      case "--quiet": case "-q": f.quiet = true; break;
      case "--verbose": f.verbose = true; break;
      case "--no-color": f.noColor = true; break;
      case "--list": f.list = true; break;
      case "--remove": f.remove = true; break;
      case "--repair": f.repair = true; break;
      case "--tag":
        if (!TAG_RE.test(value!)) throw new UsageError(`--tag "${value}" is not an npm dist-tag or version.`);
        f.tag = value!;
        break;
      case "--print":
        if (!(AGENT_IDS as readonly string[]).includes(value!)) throw badAgent(value!);
        f.print = value as AgentId;
        break;
      case "--agents": {
        const ids = value!.split(",").map((s) => s.trim()).filter(Boolean);
        for (const id of ids) {
          if (!(AGENT_IDS as readonly string[]).includes(id)) throw badAgent(id);
        }
        f.agents = [...new Set(ids)] as AgentId[];
        break;
      }
    }
  }
  if (f.list && f.remove) throw new UsageError("--list and --remove cannot be used together.");
  if (f.print) {
    const mixed = ([["--remove", f.remove], ["--list", f.list], ["--dry-run", f.dryRun], ["--repair", f.repair], ["--agents", !!f.agents]] as const).find(([, on]) => on);
    if (mixed) throw new UsageError(`--print cannot be used with ${mixed[0]}.`);
  }
  return f;
}

const EXIT_CODES = `Exit codes:
  0    success
  1    a check or step failed
  2    usage error (unknown command, option or agent; an answer is needed but there is no TTY)
  130  stopped with Ctrl-C (the agent in progress is rolled back)
`;

export const HELP_MAIN = `Usage: context-mode <command> [options]

Commands:
  setup                       List agents or print manual configuration; changes require Pennix Lifecycle
  doctor                      Check every agent; changes nothing
  upgrade                     Legacy entry; updates require Pennix Lifecycle
  server [--agent <id>]       Run the MCP server on stdio (alias: mcp)
  hook --agent <id>           Run one hook call: JSON on stdin, answer on stdout
  hook <platform> <event>     Old form of hook; still works, use Pennix Lifecycle to refresh it

Options:
  -h, --help                  Show this help (context-mode <command> --help for a command)
  -v, --version               Show the version

${EXIT_CODES}
Examples:
  context-mode setup --list
  context-mode doctor --agents codex
  context-mode server --agent codex
`;

const COMMON_HELP = `  --agents <ids>     Only these agents, comma-separated (ids: context-mode setup --list)
  -y, --yes          Compatibility flag; does not authorize installation changes
  --no-input         Never prompt; exit 2 if an answer is needed
  --json             Write only JSON to stdout
  -q, --quiet        Results only; no progress lines
  --verbose          Show every check
  --debug            Print the full debug report on failure
  --no-color         No colour (also NO_COLOR, TERM=dumb, or no TTY)
  -h, --help         Show this help
`;

export const HELP: Readonly<Record<Command, string>> = {
  setup: `Usage: context-mode setup [options]

List supported agents or print manual configuration without changing files.
Pennix Lifecycle owns installation, updates, repair and removal. Other setup forms exit 2 without changes.

Options:
  --list             Print every supported agent and its support level; change nothing
  --dry-run          Legacy flag; this setup form requires Pennix Lifecycle
  --remove           Legacy flag; removal requires Pennix Lifecycle
  --repair           Legacy flag; repair requires Pennix Lifecycle
  --print <id>       Print the manual step for one agent, paths filled in; change nothing
${COMMON_HELP}
${EXIT_CODES}
Examples:
  context-mode setup --list
  context-mode setup --print codex
`,
  doctor: `Usage: context-mode doctor [options]

Check each agent: config entry, old context-mode entries, MCP handshake, one hook call. Changes nothing.
Never offers or runs repair. Installation fixes require Pennix Lifecycle (pennix-component-lifecycle).

Options:
${COMMON_HELP}
${EXIT_CODES}
Examples:
  context-mode doctor
  context-mode doctor --agents codex --json
  context-mode doctor --no-input
`,
  upgrade: `Usage: context-mode upgrade [options]

Pennix Lifecycle owns updates. This legacy entry exits 2 without installing or changing files.
Use pennix-component-lifecycle to review and perform updates through the native owner.

Options:
  --tag <tag>        Compatibility flag; does not select or install a release
  --dry-run          Compatibility flag; still reports that the native owner is required
${COMMON_HELP}
${EXIT_CODES}
Examples:
  pennix updates --json
  pennix update context-mode
`,
};
