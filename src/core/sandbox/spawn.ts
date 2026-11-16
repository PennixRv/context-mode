// impl/03 §5, AS2, AS3: the one process-spawn path for sandboxed code. argv only, shell:false,
// env supplied by the caller (buildChildEnv), shared bounded raw capture, never rejects.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { KILL_GRACE_MS, PIPE_DRAIN_MAX_MS, PIPE_EOF_GRACE_MS, PROCESS_OUTPUT_CAP } from "../contracts/constants.ts";
import { killTree } from "./kill.ts";
import { findRuntime } from "./runtimes.ts";

export interface RunOptions {
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  timeoutMs: number;
  stdin?: string;
}

export interface RunResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  killed: "timeout" | "cancel" | "output_limit" | null;
  /** The shared capture budget was exhausted, possibly after a timeout or cancellation. */
  outputLimited?: boolean;
  /** D-1337-EXIT-SETTLE-1: the child exited but a background process still held the pipes; the output is what arrived by then. */
  held?: boolean;
}

const NOT_STARTED: RunResult = Object.freeze({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: null, killed: null });

/** Name stderr even after exit 0; an output-limit tail may end inside a UTF-8 code point. */
export function capturedOutput(r: RunResult): string {
  const limited = r.killed === "output_limit" || r.outputLimited === true;
  const decode = (buffer: Buffer): string => limited ? new StringDecoder("utf8").write(buffer) : buffer.toString("utf8");
  const stdout = decode(r.stdout);
  return stdout + (r.stderr.length === 0 ? "" : (stdout === "" || stdout.endsWith("\n") ? "" : "\n") + "[stderr]\n" + decode(r.stderr))
    + (limited && r.killed !== "output_limit" ? "\n[output capture limit reached; incomplete]" : "");
}

/**
 * DEVIATIONS D-M2-R3-3: Windows cannot start an extensionless `#!/bin/sh` shim (pyenv-win, #1208/#1209)
 * directly, so it runs as `[sh.exe, shim, ...args]` with the sh that `findRuntime("shell")` finds on
 * PATH. No sh on PATH: null, and the caller's SPAWN_FAILED line names the shim (argv[0]).
 */
function startArgv(argv: string[]): string[] | null {
  if (process.platform !== "win32" || path.extname(argv[0]) !== "") return argv;
  const sh = findRuntime("shell");
  return sh === null ? null : [sh, ...argv];
}

export function runProcess(argv: string[], o: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const isWin = process.platform === "win32";
    const start = startArgv(argv);
    if (start === null) return resolve(NOT_STARTED);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(start[0], start.slice(1), {
        cwd: o.cwd,
        env: o.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        // Step 1: POSIX group leader so killTree's -pid reaches grandchildren.
        detached: !isWin,
        // DEVIATIONS D-M2-T4-2: #384/#1154 (GP4/windows-hide-console-on-spawn); no-op on POSIX.
        windowsHide: true,
      });
    } catch {
      // Step 7 / D-M2-R3-3: spawn throws (not emits) on bad argv or Windows EINVAL; still never reject.
      return resolve(NOT_STARTED);
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killedBy: RunResult["killed"] = null;
    let capturedBytes = 0;
    let outputLimited = false;
    let settled = false;

    let held = false;
    let exited = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const kill = (): void => {
      if (child.pid !== undefined) killTree(child.pid);
      // The direct child may already be gone while a survivor holds the pipes: bound the wait.
      if (stopTimer === undefined) stopTimer = setTimeout(() => setImmediate(finishHeld), KILL_GRACE_MS);
    };
    const onAbort = (): void => {
      if (killedBy !== null || settled) return;
      killedBy = "cancel";
      clearTimeout(timer);
      kill();
    };
    const timer = setTimeout(() => {
      if (killedBy !== null || settled) return;
      killedBy = "timeout";
      kill();
    }, o.timeoutMs);

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      clearTimeout(drainTimer);
      clearTimeout(stopTimer);
      o.signal.removeEventListener("abort", onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode,
        killed: killedBy,
        ...(outputLimited ? { outputLimited: true } : {}),
        ...(held ? { held: true } : {}),
      });
    };
    // D-1337-EXIT-SETTLE-1 (#1337): the pipes did not end in time. What arrived is kept whole, the pipes are
    // destroyed, and the process group is killed so a survivor cannot hold them (POSIX: the group outlives its leader).
    const finishHeld = (): void => {
      if (settled) return;
      if (exited && child.stdout.readableEnded && child.stderr.readableEnded) {
        settle(child.exitCode);
        return;
      }
      held = exited && killedBy === null;
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.pid !== undefined) killTree(child.pid);
      settle(child.exitCode);
    };
    // A data chunk restarts the idle grace, so a large output that is still flowing is not cut.
    let outputGeneration = 0;
    const bump = (): void => {
      if (!exited || settled) return;
      clearTimeout(graceTimer);
      const generation = ++outputGeneration;
      // Timers can run before queued pipe I/O on a busy host; give that I/O one poll before deciding EOF is held.
      graceTimer = setTimeout(() => setImmediate(() => {
        if (generation === outputGeneration) finishHeld();
      }), PIPE_EOF_GRACE_MS);
    };

    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      if (outputLimited) return;
      const left = PROCESS_OUTPUT_CAP - capturedBytes;
      const kept = chunk.length <= left ? chunk : Buffer.from(chunk.subarray(0, left));
      if (kept.length > 0) { chunks.push(kept); capturedBytes += kept.length; }
      if (chunk.length > left) {
        outputLimited = true;
        // Preserve the first stop cause, but never retain more bytes after timeout/cancel either.
        if (killedBy === null) killedBy = "output_limit";
        clearTimeout(timer);
        kill();
      }
      bump();
    };
    child.stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));
    // DEVIATIONS D-M2-T4-3: "close" (exit + stdio drained), so no tail bytes are lost.
    child.on("close", (code: number | null) => settle(code));
    // D-1337-EXIT-SETTLE-1: "exit" starts a short bounded drain; "close" inside it settles at once.
    child.on("exit", () => {
      if (settled) return;
      exited = true;
      bump();
      drainTimer = setTimeout(() => setImmediate(finishHeld), PIPE_DRAIN_MAX_MS);
    });
    // Step 7: spawn-level failure (ENOENT argv[0], missing cwd) resolves, never rejects.
    child.on("error", () => settle(null));

    // A child that exits before reading stdin makes the write fail with EPIPE; the exit result
    // already carries the outcome, so the stdin stream error is not a second result.
    child.stdin.on("error", () => {});
    if (o.stdin !== undefined) child.stdin.write(o.stdin);
    child.stdin.end();

    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener("abort", onAbort, { once: true });
  });
}
