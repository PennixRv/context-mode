import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolveCodexThreadContext } from "../../src/util/project-dir.js";
import { writeCodexRollout } from "../helpers/codex-rollout.js";
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(path => rmSync(path, {recursive:true,force:true})); });
test("metadata must match the exact native thread, stay bounded and refer to a real directory", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-thread-context-")); roots.push(root);
  const id = randomUUID();
  writeCodexRollout(root, root, id);
  const dir = join(root,"sessions/2026/10/18");
  const file = join(dir,readdirSync(dir)[0]);
  expect(resolveCodexThreadContext(id,root).projectDir).toBe(root);
  for (const payload of [{id:randomUUID(),cwd:root}, {id,cwd:"relative"}, {id,cwd:join(root,"missing")}]) {
    writeFileSync(file,JSON.stringify({type:"session_meta",payload})+"\n");
    expect(() => resolveCodexThreadContext(id,root)).toThrow();
  }
  writeFileSync(file,JSON.stringify({type:"session_meta",payload:{id,cwd:root,base_instructions:"x".repeat(32768)}})+"\n");
  expect(resolveCodexThreadContext(id,root).projectDir).toBe(root);
  writeFileSync(file,"x".repeat(1048577)+"\n");
  expect(() => resolveCodexThreadContext(id,root)).toThrow(/1 MiB/);
  rmSync(file);
  const foreign=join(root,"foreign.jsonl");
  writeFileSync(foreign,JSON.stringify({type:"session_meta",payload:{id,cwd:root}})+"\n");
  symlinkSync(foreign,file);
  expect(() => resolveCodexThreadContext(id,root)).toThrow(/found 0/);
});
