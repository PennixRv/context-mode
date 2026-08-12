import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import { formatEphemeralSearch } from "../src/ephemeral-search.js";
import {
  boundedText,
  hashBatchCommands,
  measurePresentation,
  measureResponsePresentation,
  presentSource,
  renderBatchCommandLine,
  renderBoundedTitle,
  renderCommandSource,
  renderExecutionSource,
  renderSearchableTerms,
  resolvePresentationPolicy,
  type PresentationPolicy,
} from "../src/presentation-policy.js";

const POLICY: PresentationPolicy = {
  codePreviewChars: 64,
  commandPreviewChars: 64,
  titlePreviewChars: 16,
  searchableTerms: 2,
  resultPreviewChars: 160,
};

describe("shared MCP response presentation policy", () => {
  test("uses compact deterministic defaults", () => {
    expect(resolvePresentationPolicy({})).toEqual({
      codePreviewChars: 240,
      commandPreviewChars: 160,
      titlePreviewChars: 96,
      searchableTerms: 20,
      resultPreviewChars: 1_200,
    });
  });

  test("accepts bounded configuration and falls back for invalid values", () => {
    expect(resolvePresentationPolicy({
      CONTEXT_MODE_CODE_ECHO_MAX: "80",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "90",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "32",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "7",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "400",
    })).toEqual({
      codePreviewChars: 80,
      commandPreviewChars: 90,
      titlePreviewChars: 32,
      searchableTerms: 7,
      resultPreviewChars: 400,
    });

    expect(resolvePresentationPolicy({
      CONTEXT_MODE_CODE_ECHO_MAX: "-1",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "invalid",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "3.5",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "NaN",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "999999999999999999999999",
    })).toEqual(resolvePresentationPolicy({}));
  });

  test("zero preserves #717/#736 source visibility but may suppress terms", () => {
    expect(resolvePresentationPolicy({
      CONTEXT_MODE_CODE_ECHO_MAX: "0",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "0",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "0",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "0",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "0",
    })).toEqual({
      codePreviewChars: 64,
      commandPreviewChars: 64,
      titlePreviewChars: 16,
      searchableTerms: 0,
      resultPreviewChars: 160,
    });
  });

  test("clamps small and large values to documented bounds", () => {
    expect(resolvePresentationPolicy({
      CONTEXT_MODE_CODE_ECHO_MAX: "1",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "1",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "1",
      CONTEXT_MODE_SEARCHABLE_TERMS_MAX: "999",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "1",
    })).toEqual({
      codePreviewChars: 64,
      commandPreviewChars: 64,
      titlePreviewChars: 16,
      searchableTerms: 80,
      resultPreviewChars: 160,
    });
    expect(resolvePresentationPolicy({
      CONTEXT_MODE_CODE_ECHO_MAX: "9999",
      CONTEXT_MODE_COMMAND_ECHO_MAX: "9999",
      CONTEXT_MODE_TITLE_PREVIEW_MAX: "9999",
      CONTEXT_MODE_RESULT_PREVIEW_MAX: "9999",
    })).toMatchObject({
      codePreviewChars: 2_000,
      commandPreviewChars: 500,
      titlePreviewChars: 240,
      resultPreviewChars: 3_000,
    });
  });

  test("counts and truncates Unicode by code point", () => {
    const source = "A😀B界C";
    expect(presentSource("text", source, 4)).toMatchObject({
      language: "text",
      originalChars: 5,
      previewChars: 4,
      omittedChars: 1,
      truncated: true,
      preview: "A😀B界",
    });
    expect(boundedText(source, 4)).toBe("A😀B界...");
  });

  test("measures UTF-8 bytes, Unicode code points, and wrapper lines separately", () => {
    expect(measurePresentation("A😀\n\n界")).toEqual({
      utf8Bytes: 10,
      unicodeChars: 5,
      totalLines: 3,
      nonEmptyLines: 2,
    });
    expect(measureResponsePresentation("proof😀", "result\nline")).toEqual({
      wrapper: { utf8Bytes: 9, unicodeChars: 6, totalLines: 1, nonEmptyLines: 1 },
      actionable: { utf8Bytes: 11, unicodeChars: 11, totalLines: 2, nonEmptyLines: 2 },
      total: { utf8Bytes: 21, unicodeChars: 18, totalLines: 3, nonEmptyLines: 3 },
    });
  });

  test("renders language, lengths, truncation, and a stable source digest", () => {
    const source = `console.log("${"x".repeat(80)}")`;
    const digest = createHash("sha256").update(source).digest("hex");
    const rendered = renderExecutionSource("javascript", source, POLICY, "src/a.js");
    expect(rendered).toContain("path=src/a.js");
    expect(rendered).toContain("Executed javascript");
    expect(rendered).toContain(`64/${Array.from(source).length} chars`);
    expect(rendered).toContain(`(truncated; ${Array.from(source).length - 64} omitted)`);
    expect(rendered).toContain(`sha256=${digest}`);
    expect(rendered).not.toContain("preview=");
    expect(rendered).not.toContain("truncated=");
    expect(rendered).not.toContain(source);
  });

  test("chooses a fence longer than source backtick runs", () => {
    const source = "console.log(````inside````)";
    const rendered = renderExecutionSource("javascript", source, {
      ...POLICY,
      codePreviewChars: 100,
    });
    expect(rendered).toContain("`````javascript");
    expect(rendered).toContain("\n`````\n\n");
  });

  test("renders compact command accounting and visible line breaks without hiding truncation", () => {
    const command = `printf 'start'\necho '${"x".repeat(100)}'`;
    const rendered = renderCommandSource(command, POLICY);
    expect(rendered).toContain("...");
    expect(rendered).toContain(`64/${Array.from(command).length} chars`);
    expect(rendered).toMatch(/sha256=[a-f0-9]{64}/);
    expect(rendered).toContain("\\n");
    expect(rendered).not.toContain("source=");
    expect(rendered).not.toContain("preview=");
    expect(rendered).not.toContain("omitted=");
    expect(rendered).not.toContain("truncated=");
    expect(renderCommandSource("echo short", POLICY)).toBe("echo short");
  });

  test("binds the complete ordered batch while keeping every actual command visible", () => {
    const commands = [
      { label: "alpha", command: "echo alpha", status: "completed" },
      { label: "bravo", command: "echo bravo", status: "skipped" },
    ];
    const expectedDigest = createHash("sha256")
      .update(JSON.stringify(commands.map(({ label, command }) => [label, command])))
      .digest("hex");

    expect(hashBatchCommands(commands)).toBe(expectedDigest);
    expect(hashBatchCommands([...commands].reverse())).not.toBe(expectedDigest);
    expect(renderBatchCommandLine(commands, POLICY)).toBe(
      `Commands (2): 1 alpha: echo alpha || 2 [skipped] bravo: echo bravo | sha256=${expectedDigest}`,
    );
  });

  test("bounds titles and searchable terms through the same policy", () => {
    expect(renderBoundedTitle("abcdefghijklmnopq", POLICY)).toBe("abcdefghijklmnop...");
    expect(renderSearchableTerms(["alpha", "bravo", "charlie"], POLICY)).toBe(
      "Searchable terms (2/3): alpha, bravo",
    );
    expect(renderSearchableTerms(["x".repeat(40)], POLICY)).toBe(
      `Searchable terms (1): ${"x".repeat(16)}...`,
    );
    expect(renderSearchableTerms(["alpha"], { ...POLICY, searchableTerms: 0 })).toBeNull();
  });

  test("request-local search is bounded and explicitly non-persistent", () => {
    const content = [
      "# Alpha heading that is deliberately long",
      `alpha ${"detail ".repeat(80)}`,
      "# Bravo",
      "bravo result",
    ].join("\n");
    const rendered = formatEphemeralSearch(content, ["alpha"], "batch:test", POLICY);
    expect(rendered).toContain("Persisted: no.");
    expect(rendered).toContain("## Request-Local Sections");
    expect(rendered).toContain("## alpha");
    expect(rendered).toContain("Searchable terms (2/3)");
    expect(rendered).toContain("not available to ctx_search");
    expect(rendered).not.toContain("detail ".repeat(40));
  });

  test("measures representative wrappers for all fifteen registered MCP tools", () => {
    const source = `console.log('${"x".repeat(100)}')`;
    const sourceDigest = createHash("sha256").update(source).digest("hex");
    const commandRows = [
      { label: "alpha", command: "printf alpha" },
      { label: "bravo", command: "printf bravo" },
      { label: "charlie", command: "printf charlie" },
    ];
    const batchDigest = hashBatchCommands(commandRows);
    const state = {
      available: true,
      provider: "trellis",
      sha256: "b".repeat(64),
      bytes: 5424,
      warnings: [],
    };
    const actionable = "## probe\n\n### Alpha\nmatched result line one\nmatched result line two";
    const unchanged = "status=ok; value=42";
    const fixtures: Record<string, { before: string; after: string; actionable: string }> = {
      ctx_execute: {
        before: `Executed javascript | source=115 chars | preview=64 chars | omitted=51 chars | truncated=yes | sha256=${sourceDigest}\n\`\`\`javascript\n${Array.from(source).slice(0, 64).join("")}\n\`\`\``,
        after: renderExecutionSource("javascript", source, POLICY).trimEnd(),
        actionable: "probe output",
      },
      ctx_execute_file: {
        before: `path=src/probe.js\nExecuted javascript | source=115 chars | preview=64 chars | omitted=51 chars | truncated=yes | sha256=${sourceDigest}\n\`\`\`javascript\n${Array.from(source).slice(0, 64).join("")}\n\`\`\``,
        after: renderExecutionSource("javascript", source, POLICY, "src/probe.js").trimEnd(),
        actionable: "file probe output",
      },
      ctx_index: {
        before: "Indexed 4 sections (2 with code) from: docs.\nUse ctx_search(queries: [\"...\"]) to query this content. Use source: \"docs\" to scope results.",
        after: "Indexed 4 sections (2 with code) from: docs. Search: ctx_search(queries: [\"...\"], source: \"docs\").",
        actionable: "",
      },
      ctx_search: {
        before: "> Throttle: call #1/8 in this window. 2 call(s) before soft cap. Prefer ctx_search(queries: [...]) array form for multi-query workloads — it counts as a single call.",
        after: "Throttle: call #1/8; 2 calls before soft cap. Batch queries in one call.",
        actionable,
      },
      ctx_fetch_and_index: {
        before: "Cached: **docs** — 4 sections, indexed 2m ago (fresh, TTL: 24h).\nTo refresh: call ctx_fetch_and_index again with `force: true`.\n\nYou MUST call ctx_search() to answer questions about this content — this cached response contains no content.\nUse: ctx_search(queries: [...], source: \"docs\")",
        after: "Cached **docs**: 4 sections; age 2m ago; TTL 24h. Search: ctx_search(queries: [...], source: \"docs\"); refresh with force: true.",
        actionable: "",
      },
      ctx_batch_execute: {
        before: `Executed 3 commands (40 lines, 2.0KB). Indexed 6 sections. Searched 1 queries.\n\n## Commands\n\n- alpha: printf alpha [source=12 chars, preview=12 chars, omitted=0 chars, truncated=no, sha256=${"1".repeat(64)}]\n- bravo: printf bravo [source=12 chars, preview=12 chars, omitted=0 chars, truncated=no, sha256=${"2".repeat(64)}]\n- charlie: printf charlie [source=14 chars, preview=14 chars, omitted=0 chars, truncated=no, sha256=${"3".repeat(64)}]\n\n## Indexed Sections\n\n- Alpha (0.5KB)\n- Bravo (0.5KB)\n- Charlie (0.5KB)\n\n> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use ctx_search(queries: [...]) or call ctx_batch_execute with query_scope: \"global\".`,
        after: `Executed 3 commands (40 lines, 2.0KB). Persisted: yes. Indexed 6 sections as "batch:alpha,bravo,charlie". Searched 1 request-local queries.\n${renderBatchCommandLine(commandRows, POLICY)}`,
        actionable,
      },
      ctx_stats: { before: unchanged, after: unchanged, actionable: "" },
      ctx_checkpoint_report: {
        before: JSON.stringify(state, null, 2),
        after: JSON.stringify(state),
        actionable: "",
      },
      ctx_recovery_brief_init: {
        before: JSON.stringify({ ...state, ok: true, initialized: true }, null, 2),
        after: JSON.stringify({ ...state, ok: true, initialized: true }),
        actionable: "",
      },
      ctx_recovery_brief_status: {
        before: JSON.stringify({ ...state, health: "available", sourceDrift: false }, null, 2),
        after: JSON.stringify({ ...state, health: "available", sourceDrift: false }),
        actionable: "",
      },
      ctx_recovery_brief_update: {
        before: JSON.stringify({ ...state, ok: false, errorCode: "CONFLICT" }, null, 2),
        after: JSON.stringify({ ...state, ok: false, errorCode: "CONFLICT" }),
        actionable: "",
      },
      ctx_doctor: {
        before: "context-mode doctor\n\n[OK] Runtimes: 8/11\n[OK] Storage sessions: /tmp/sessions\n[OK] Storage content: /tmp/content\n[OK] Server test: PASS\n[OK] FTS5 / SQLite: PASS\n[WARN] Performance: NORMAL — install Bun",
        after: "context-mode doctor\n[OK] 5 checks: Runtimes: 8/11 | Storage sessions: /tmp/sessions | Storage content: /tmp/content | Server test: PASS | FTS5 / SQLite: PASS\n[WARN] Performance: NORMAL — install Bun",
        actionable: "",
      },
      ctx_upgrade: {
        before: "## ctx-upgrade\n\nRun this command using your shell execution tool:\n\n```\nnode cli.bundle.mjs upgrade --platform codex\n```\n\nAfter the command completes, display results as a markdown checklist:\n- `[x]` for success, `[ ]` for failure\n- Example format with pulled, built, installed, hooks, and doctor checks\n- Tell the user to restart their session to pick up the new version.",
        after: "Run this command, report each upgrade check as success/failure, then restart the session:\n```shell\nnode cli.bundle.mjs upgrade --platform codex\n```",
        actionable: "",
      },
      ctx_purge: { before: unchanged, after: unchanged, actionable: "" },
      ctx_insight: { before: unchanged, after: unchanged, actionable: "" },
    };

    expect(Object.keys(fixtures)).toEqual([
      "ctx_execute", "ctx_execute_file", "ctx_index", "ctx_search",
      "ctx_fetch_and_index", "ctx_batch_execute", "ctx_stats",
      "ctx_checkpoint_report", "ctx_recovery_brief_init",
      "ctx_recovery_brief_status", "ctx_recovery_brief_update", "ctx_doctor",
      "ctx_upgrade", "ctx_purge", "ctx_insight",
    ]);

    const measured = Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => {
      const before = measureResponsePresentation(fixture.before, fixture.actionable);
      const after = measureResponsePresentation(fixture.after, fixture.actionable);
      expect(after.actionable).toEqual(before.actionable);
      return [name, {
        beforeBytes: before.wrapper.utf8Bytes,
        afterBytes: after.wrapper.utf8Bytes,
        beforeChars: before.wrapper.unicodeChars,
        afterChars: after.wrapper.unicodeChars,
        beforeLines: before.wrapper.nonEmptyLines,
        afterLines: after.wrapper.nonEmptyLines,
      }];
    }));

    expect(measured).toEqual({
      ctx_execute: {
        beforeBytes: 249,
        afterBytes: 215,
        beforeChars: 249,
        afterChars: 215,
        beforeLines: 4,
        afterLines: 4,
      },
      ctx_execute_file: {
        beforeBytes: 267,
        afterBytes: 235,
        beforeChars: 267,
        afterChars: 235,
        beforeLines: 5,
        afterLines: 4,
      },
      ctx_index: {
        beforeBytes: 137,
        afterBytes: 98,
        beforeChars: 137,
        afterChars: 98,
        beforeLines: 2,
        afterLines: 1,
      },
      ctx_search: {
        beforeBytes: 167,
        afterBytes: 72,
        beforeChars: 165,
        afterChars: 72,
        beforeLines: 1,
        afterLines: 1,
      },
      ctx_fetch_and_index: {
        beforeBytes: 290,
        afterBytes: 127,
        beforeChars: 286,
        afterChars: 127,
        beforeLines: 4,
        afterLines: 1,
      },
      ctx_batch_execute: {
        beforeBytes: 828,
        afterBytes: 303,
        beforeChars: 828,
        afterChars: 303,
        beforeLines: 10,
        afterLines: 2,
      },
      ctx_stats: {
        beforeBytes: 19,
        afterBytes: 19,
        beforeChars: 19,
        afterChars: 19,
        beforeLines: 1,
        afterLines: 1,
      },
      ctx_checkpoint_report: {
        beforeBytes: 163,
        afterBytes: 142,
        beforeChars: 163,
        afterChars: 142,
        beforeLines: 7,
        afterLines: 1,
      },
      ctx_recovery_brief_init: {
        beforeBytes: 200,
        afterBytes: 171,
        beforeChars: 200,
        afterChars: 171,
        beforeLines: 9,
        afterLines: 1,
      },
      ctx_recovery_brief_status: {
        beforeBytes: 212,
        afterBytes: 183,
        beforeChars: 212,
        afterChars: 183,
        beforeLines: 9,
        afterLines: 1,
      },
      ctx_recovery_brief_update: {
        beforeBytes: 205,
        afterBytes: 176,
        beforeChars: 205,
        afterChars: 176,
        beforeLines: 9,
        afterLines: 1,
      },
      ctx_doctor: {
        beforeBytes: 203,
        afterBytes: 200,
        beforeChars: 201,
        afterChars: 198,
        beforeLines: 7,
        afterLines: 3,
      },
      ctx_upgrade: {
        beforeBytes: 371,
        afterBytes: 147,
        beforeChars: 371,
        afterChars: 147,
        beforeLines: 9,
        afterLines: 4,
      },
      ctx_purge: {
        beforeBytes: 19,
        afterBytes: 19,
        beforeChars: 19,
        afterChars: 19,
        beforeLines: 1,
        afterLines: 1,
      },
      ctx_insight: {
        beforeBytes: 19,
        afterBytes: 19,
        beforeChars: 19,
        afterChars: 19,
        beforeLines: 1,
        afterLines: 1,
      },
    });
    expect(fixtures.ctx_batch_execute.after.split("\n").filter(Boolean)).toHaveLength(2);
    expect(fixtures.ctx_batch_execute.after).not.toContain("[source=");
    expect(fixtures.ctx_batch_execute.after).not.toContain("## Indexed Sections");
    expect(fixtures.ctx_batch_execute.after).toContain(`sha256=${batchDigest}`);
  });
});
