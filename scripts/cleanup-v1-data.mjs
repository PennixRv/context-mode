#!/usr/bin/env node
// One-time v1 maintenance. Default is a read-only preview; never traverses Codex sessions or the v2 data root.
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {pathToFileURL} from "node:url";

const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const databaseName = /^[a-f0-9]{16}(?:__[a-f0-9]{8})?\.db$/;
const statsName = new RegExp(`^stats-${uuid}\\.json$`);
const projectionName = new RegExp(`^[a-f0-9]{16}(?:__[a-f0-9]{8})?-${uuid}-events\\.md$`);
const statsKeys = new Set(["schemaVersion", "version", "session_start", "updated_at", "uptime_ms", "total_calls", "total_processed", "bytes_indexed", "bytes_returned", "bytes_sandboxed", "cache_bytes_saved", "cache_hits", "dollars_saved_lifetime", "dollars_saved_session", "kept_out", "reduction_pct", "tokens_saved", "tokens_saved_lifetime", "by_tool"]);
const root = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "context-mode");
const inside = value => value === root || value.startsWith(root + path.sep);
const identity = st => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs, st.mode, st.nlink];

function owned(file, directory = false) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile()) || st.uid !== process.getuid() || (st.mode & 0o022) || (!directory && st.nlink !== 1)) throw new Error(`unsafe ownership/type: ${path.relative(root, file) || "."}`);
  return st;
}

function activity() {
  const blocked = [];
  if (process.platform !== "linux") return ["activity verification requires Linux /proc"];
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const proc = `/proc/${name}`;
    let relevant = false;
    let candidate = false;
    try {
      if (fs.statSync(proc).uid !== process.getuid()) continue;
      const args = fs.readFileSync(`${proc}/cmdline`, "utf8").split("\0");
      const oldWriter = args.some(arg => arg.includes("context-mode") && (arg.endsWith("server.bundle.mjs") || arg.includes("/hooks/codex/")));
      candidate = oldWriter;
      if (oldWriter) {
        relevant = true;
        const values = fs.readFileSync(`${proc}/environ`, "utf8").split("\0");
        const envValue = key => values.find(value => value.startsWith(key + "="))?.slice(key.length + 1);
        const oldRoot = envValue("CONTEXT_MODE_DIR") || path.join(envValue("CODEX_HOME") || path.join(envValue("HOME") || os.homedir(), ".codex"), "context-mode");
        relevant = path.resolve(oldRoot) === root;
        if (relevant) { blocked.push(`old writer process ${name}`); continue; }
      }
      for (const fd of fs.readdirSync(`${proc}/fd`)) {
        try { if (inside(fs.readlinkSync(`${proc}/fd/${fd}`).replace(/ \(deleted\)$/, ""))) relevant = true; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (!relevant) relevant = fs.readFileSync(`${proc}/maps`, "utf8").split("\n").some(line => line.includes(root + path.sep));
      if (relevant) blocked.push(`open v1 data process ${name}`);
    } catch (error) {
      if ((candidate || relevant) && error.code !== "ENOENT" && error.code !== "ESRCH") blocked.push(`cannot verify process ${name}: ${error.code || error.message}`);
    }
  }
  return blocked;
}

function validateDb(file, area) {
  // Immutable mode reads the checkpointed schema without creating WAL/SHM in the original directory.
  const db = new DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, {readOnly: true});
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== 0) throw new Error("not a v1 schema");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).sort();
    const wanted = area === "sessions" ? ["session_events", "session_meta", "session_resume", "tool_calls"] : ["sources", "chunks", "vocabulary"];
    if (!wanted.every(t => tables.includes(t))) throw new Error("missing v1 tables");
    const allowed = new Set([...wanted, "sqlite_sequence", ...(area === "content" ? ["chunks_data", "chunks_idx", "chunks_content", "chunks_docsize", "chunks_config", "chunks_trigram", "chunks_trigram_data", "chunks_trigram_idx", "chunks_trigram_content", "chunks_trigram_docsize", "chunks_trigram_config"] : [])]);
    if (tables.some(t => !allowed.has(t))) throw new Error("unknown table");
    const table = area === "sessions" ? "session_events" : "sources";
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    const required = area === "sessions" ? ["session_id", "type", "category", "data", "project_dir"] : ["label", "chunk_count", "file_path", "content_hash"];
    if (!required.every(c => columns.includes(c))) throw new Error("unknown v1 columns");
  } finally { db.close(); }
}

function inspect() {
  const result = {root, files: [], directories: [], unknown: [], blocked: []};
  if (!fs.lstatSync(root, {throwIfNoEntry: false})) return {...result, status: "absent", digest: createHash("sha256").update(root).digest("hex")};
  try {
    owned(root, true);
    if (fs.realpathSync(root) !== root) throw new Error("linked root or ancestor");
    result.directories.push({path: ".", identity: identity(owned(root, true))});
    for (const area of fs.readdirSync(root).sort()) {
      if (!["content", "sessions"].includes(area)) { result.unknown.push(area); continue; }
      const dir = path.join(root, area);
      result.directories.push({path: area, identity: identity(owned(dir, true))});
      const names = fs.readdirSync(dir).sort();
      const validDbs = new Set();
      for (const name of names.filter(n => databaseName.test(n))) {
        try { owned(path.join(dir, name)); validateDb(path.join(dir, name), area); validDbs.add(name); }
        catch (error) { result.unknown.push(`${area}/${name}: ${error.message}`); }
      }
      for (const name of names) {
        const rel = `${area}/${name}`, file = path.join(dir, name);
        try {
          const st = owned(file);
          let valid = validDbs.has(name);
          if (name.endsWith(".db-wal") || name.endsWith(".db-shm")) valid = validDbs.has(name.slice(0, -4));
          if (area === "sessions" && statsName.test(name) && st.size <= 1_048_576) {
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            valid = data.schemaVersion === 2 && /^1\.0\.169-pennix\.\d+$/.test(data.version) && Object.keys(data).every(k => statsKeys.has(k)) && typeof data.by_tool === "object";
          }
          if (area === "sessions" && projectionName.test(name)) {
            const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try { const head = Buffer.alloc(160); const n = fs.readSync(fd, head, 0, head.length, 0); valid = head.subarray(0, n).toString().startsWith("# Session history\nHistorical observations; current host instructions and native task state take precedence."); }
            finally { fs.closeSync(fd); }
          }
          if (valid) result.files.push({path: rel, bytes: st.size, identity: identity(st)});
          else if (!result.unknown.some(x => x.startsWith(rel + ":"))) result.unknown.push(rel);
        } catch (error) { result.unknown.push(`${rel}: ${error.message}`); }
      }
    }
    result.blocked.push(...activity());
  } catch (error) { result.blocked.push(error.message); }
  const digest = createHash("sha256").update(JSON.stringify({root, files: result.files, directories: result.directories, unknown: result.unknown})).digest("hex");
  return {...result, status: result.unknown.length || result.blocked.length ? "blocked" : "eligible", digest};
}

function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--apply" && /^[a-f0-9]{64}$/.test(args[1]))) throw new Error("usage: node scripts/cleanup-v1-data.mjs [--apply <preview-digest>]");
  const preview = inspect();
  if (!args.length) return {mode: "preview", ...preview};
  if (preview.digest !== args[1]) throw new Error("preview changed; inspect again");
  if (preview.status === "blocked") throw new Error("unknown data or active/unverified writers; keep all v1 data");
  if (preview.status === "absent") return {mode: "apply", ...preview, removed: []};
  const lock = path.join(path.dirname(root), ".context-mode-v1-cleanup.lock");
  const fd = fs.openSync(lock, "wx", 0o600);
  const removed = [];
  try {
    const current = inspect();
    if (current.digest !== preview.digest || current.status !== "eligible") throw new Error("data or writers changed after locking");
    for (const item of current.files) {
      const file = path.join(root, item.path);
      owned(root, true); owned(path.dirname(file), true);
      if (JSON.stringify(identity(owned(file))) !== JSON.stringify(item.identity)) throw new Error(`changed: ${item.path}`);
      fs.unlinkSync(file); removed.push(item.path);
    }
    for (const dir of ["content", "sessions"]) if (fs.existsSync(path.join(root, dir))) fs.rmdirSync(path.join(root, dir));
    fs.rmdirSync(root);
    return {mode: "apply", root, status: "removed", digest: current.digest, removed};
  } catch (error) {
    return {mode: "apply", root, status: "partial_failure", removed, error: error.message};
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

try {
  const result = main();
  console.log(JSON.stringify(result));
  if (result.status === "blocked" || result.status === "partial_failure") process.exitCode = 1;
} catch (error) { console.log(JSON.stringify({root, status: "blocked", error: error.message})); process.exitCode = 1; }
