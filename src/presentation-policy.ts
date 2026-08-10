import { createHash } from "node:crypto";

export const CODE_ECHO_MAX_ENV = "CONTEXT_MODE_CODE_ECHO_MAX";
export const COMMAND_ECHO_MAX_ENV = "CONTEXT_MODE_COMMAND_ECHO_MAX";
export const TITLE_PREVIEW_MAX_ENV = "CONTEXT_MODE_TITLE_PREVIEW_MAX";
export const SEARCHABLE_TERMS_MAX_ENV = "CONTEXT_MODE_SEARCHABLE_TERMS_MAX";
export const RESULT_PREVIEW_MAX_ENV = "CONTEXT_MODE_RESULT_PREVIEW_MAX";

export const CODE_ECHO_DEFAULT = 240;
export const CODE_ECHO_MIN = 64;
export const CODE_ECHO_MAX = 2_000;

export interface PresentationPolicy {
  codePreviewChars: number;
  commandPreviewChars: number;
  titlePreviewChars: number;
  searchableTerms: number;
  resultPreviewChars: number;
}

export interface SourcePresentation {
  language: string;
  originalChars: number;
  previewChars: number;
  omittedChars: number;
  truncated: boolean;
  sha256: string;
  preview: string;
}

function boundedInteger(
  raw: string | undefined,
  defaults: { value: number; min: number; max: number; zeroMeansMinimum?: boolean },
): number {
  if (raw === undefined || raw.trim() === "") return defaults.value;
  if (!/^\d+$/.test(raw.trim())) return defaults.value;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed)) return defaults.value;
  if (parsed === 0 && defaults.zeroMeansMinimum) return defaults.min;
  return Math.min(defaults.max, Math.max(defaults.min, parsed));
}

export function resolvePresentationPolicy(
  env: NodeJS.ProcessEnv = process.env,
): PresentationPolicy {
  return {
    codePreviewChars: boundedInteger(env[CODE_ECHO_MAX_ENV], {
      value: CODE_ECHO_DEFAULT,
      min: CODE_ECHO_MIN,
      max: CODE_ECHO_MAX,
      zeroMeansMinimum: true,
    }),
    commandPreviewChars: boundedInteger(env[COMMAND_ECHO_MAX_ENV], {
      value: 160,
      min: 64,
      max: 500,
      zeroMeansMinimum: true,
    }),
    titlePreviewChars: boundedInteger(env[TITLE_PREVIEW_MAX_ENV], {
      value: 96,
      min: 16,
      max: 240,
      zeroMeansMinimum: true,
    }),
    searchableTerms: boundedInteger(env[SEARCHABLE_TERMS_MAX_ENV], {
      value: 20,
      min: 0,
      max: 80,
    }),
    resultPreviewChars: boundedInteger(env[RESULT_PREVIEW_MAX_ENV], {
      value: 1_200,
      min: 160,
      max: 3_000,
      zeroMeansMinimum: true,
    }),
  };
}

function sourcePreview(source: string, maxChars: number): { preview: string; total: number } {
  let preview = "";
  let total = 0;
  for (const character of source) {
    total += 1;
    if (total <= maxChars) preview += character;
  }
  return { preview, total };
}

export function presentSource(
  language: string,
  source: string,
  maxChars: number,
): SourcePresentation {
  const measured = sourcePreview(source, maxChars);
  const previewChars = Math.min(measured.total, maxChars);
  return {
    language,
    originalChars: measured.total,
    previewChars,
    omittedChars: measured.total - previewChars,
    truncated: measured.total > previewChars,
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    preview: measured.preview,
  };
}

function markdownFence(source: string): string {
  let longest = 0;
  for (const match of source.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

export function renderExecutionSource(
  language: string,
  source: string,
  policy: PresentationPolicy,
  path?: string,
): string {
  const presented = presentSource(language, source, policy.codePreviewChars);
  const fence = markdownFence(presented.preview);
  const pathLine = path ? `path=${path}\n` : "";
  const metadata = [
    `Executed ${language}`,
    `source=${presented.originalChars} chars`,
    `preview=${presented.previewChars} chars`,
    `omitted=${presented.omittedChars} chars`,
    `truncated=${presented.truncated ? "yes" : "no"}`,
    `sha256=${presented.sha256}`,
  ].join(" | ");
  return `${pathLine}${metadata}\n${fence}${language}\n${presented.preview}\n${fence}\n\n`;
}

export function renderCommandSource(
  command: string,
  policy: PresentationPolicy,
): string {
  const presented = presentSource("shell", command, policy.commandPreviewChars);
  const visiblePreview = presented.preview
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
  const marker = presented.truncated ? "..." : "";
  return `${visiblePreview}${marker} [source=${presented.originalChars} chars, ` +
    `preview=${presented.previewChars} chars, omitted=${presented.omittedChars} chars, ` +
    `truncated=${presented.truncated ? "yes" : "no"}, sha256=${presented.sha256}]`;
}

export function boundedText(text: string, maxChars: number): string {
  const presented = presentSource("text", text, maxChars);
  return presented.truncated ? `${presented.preview}...` : presented.preview;
}

export function renderBoundedTitle(title: string, policy: PresentationPolicy): string {
  return boundedText(title, policy.titlePreviewChars);
}

export function renderSearchableTerms(
  terms: string[],
  policy: PresentationPolicy,
): string | null {
  if (policy.searchableTerms === 0 || terms.length === 0) return null;
  const visible = terms
    .slice(0, policy.searchableTerms)
    .map((term) => boundedText(term, policy.titlePreviewChars));
  const truncated = terms.length > visible.length;
  return `Searchable terms (${visible.length} shown, truncated=${truncated ? "yes" : "no"}): ${visible.join(", ")}`;
}
