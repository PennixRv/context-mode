import {
  boundedText,
  renderBoundedTitle,
  renderSearchableTerms,
  type PresentationPolicy,
} from "./presentation-policy.js";

interface EphemeralSection {
  title: string;
  content: string;
}

function splitSections(content: string, fallbackTitle: string): EphemeralSection[] {
  const lines = content.split("\n");
  const sections: EphemeralSection[] = [];
  let title = fallbackTitle;
  let body: string[] = [];

  const flush = () => {
    const joined = body.join("\n").trim();
    if (joined || sections.length === 0) sections.push({ title, content: joined || "(no output)" });
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!heading) {
      body.push(line);
      continue;
    }
    if (body.length > 0) flush();
    title = heading[2].trim() || fallbackTitle;
    body = [];
  }
  flush();
  return sections;
}

function tokens(value: string): string[] {
  return (value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
}

function scoreSection(section: EphemeralSection, query: string): number {
  const haystack = `${section.title}\n${section.content}`.toLocaleLowerCase();
  let score = 0;
  for (const token of new Set(tokens(query))) {
    let offset = haystack.indexOf(token);
    while (offset >= 0) {
      score += 1;
      offset = haystack.indexOf(token, offset + token.length);
    }
  }
  return score;
}

function distinctiveTerms(content: string, max: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens(content)) {
    if (token.length < 4 || /^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, max)
    .map(([term]) => term);
}

export function formatEphemeralSearch(
  content: string,
  queries: string[],
  source: string,
  policy: PresentationPolicy,
): string {
  const sections = splitSections(content, source);
  const totalBytes = Buffer.byteLength(content);
  const totalLines = content.split("\n").length;
  const output: string[] = [
    `Processed ${sections.length} request-local sections (${totalLines} lines, ${(totalBytes / 1024).toFixed(1)}KB). Persisted: no.`,
    "",
    "## Request-Local Sections",
    "",
  ];

  for (const section of sections) {
    output.push(`- ${renderBoundedTitle(section.title, policy)} (${Buffer.byteLength(section.content)} bytes)`);
  }

  for (const query of queries) {
    output.push("", `## ${renderBoundedTitle(query, policy)}`, "");
    const matches = sections
      .map((section) => ({ section, score: scoreSection(section, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    if (matches.length === 0) {
      output.push("No matching request-local sections found.");
      continue;
    }
    for (const { section } of matches) {
      output.push(`### ${renderBoundedTitle(section.title, policy)}`);
      output.push(boundedText(section.content, policy.resultPreviewChars));
      output.push("");
    }
  }

  const terms = distinctiveTerms(content, policy.searchableTerms + 1);
  const termLine = renderSearchableTerms(terms, policy);
  if (termLine) output.push("", termLine);
  output.push("", "This result existed only for the current request and is not available to ctx_search.");
  return output.join("\n");
}
