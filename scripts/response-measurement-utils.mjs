export function sourcePreviewChars(text) {
  const current = /Executed\s+\S+(?:\s+\|[^\n|]+)*\s+\|\s+(\d+)\/\d+ chars/.exec(text)?.[1];
  const legacy = /preview=(\d+) chars/.exec(text)?.[1];
  const value = current ?? legacy;
  return value === undefined ? null : Number(value);
}
