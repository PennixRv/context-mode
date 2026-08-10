import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import { formatEphemeralSearch } from "../src/ephemeral-search.js";
import {
  boundedText,
  presentSource,
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

  test("renders language, lengths, truncation, and a stable source digest", () => {
    const source = `console.log("${"x".repeat(80)}")`;
    const digest = createHash("sha256").update(source).digest("hex");
    const rendered = renderExecutionSource("javascript", source, POLICY, "src/a.js");
    expect(rendered).toContain("path=src/a.js");
    expect(rendered).toContain("Executed javascript");
    expect(rendered).toContain(`source=${Array.from(source).length} chars`);
    expect(rendered).toContain("preview=64 chars");
    expect(rendered).toContain("truncated=yes");
    expect(rendered).toContain(`sha256=${digest}`);
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

  test("renders original command length and visible line breaks without hiding truncation", () => {
    const command = `printf 'start'\necho '${"x".repeat(100)}'`;
    const rendered = renderCommandSource(command, POLICY);
    expect(rendered).toContain("...");
    expect(rendered).toContain("source=");
    expect(rendered).toContain("preview=64 chars");
    expect(rendered).toContain("omitted=");
    expect(rendered).toContain("truncated=yes");
    expect(rendered).toMatch(/sha256=[a-f0-9]{64}/);
    expect(rendered).toContain(`source=${Array.from(command).length} chars`);
    expect(rendered).toContain("\\n");
  });

  test("bounds titles and searchable terms through the same policy", () => {
    expect(renderBoundedTitle("abcdefghijklmnopq", POLICY)).toBe("abcdefghijklmnop...");
    expect(renderSearchableTerms(["alpha", "bravo", "charlie"], POLICY)).toBe(
      "Searchable terms (2 shown, truncated=yes): alpha, bravo",
    );
    expect(renderSearchableTerms(["x".repeat(40)], POLICY)).toBe(
      `Searchable terms (1 shown, truncated=no): ${"x".repeat(16)}...`,
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
    expect(rendered).toContain("Searchable terms (2 shown");
    expect(rendered).toContain("not available to ctx_search");
    expect(rendered).not.toContain("detail ".repeat(40));
  });
});
