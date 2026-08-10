// Output conventions shared by every mycelium CLI: content an agent should
// read as data goes to stdout in a token-cheap shape; everything else
// (progress, truncation notices, doctor results) goes to stderr so piping
// `tri note read <id> | ...` never picks up incidental noise.

export function writeStdout(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function writeStderr(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

// Compact JSON -- not pretty-printed. An agent reads this as data; every
// extra space/newline is pure token overhead for zero readability gain in
// a tool-call transcript.
export function writeJson(value: unknown): void {
  writeStdout(JSON.stringify(value));
}

// One compact JSON object per line rather than a single JSON array, so a
// caller reading a large result with `head`/a bounded read still gets
// whole, parseable records instead of a truncated array literal.
export function writeJsonLines(items: readonly unknown[]): void {
  for (const item of items) {
    process.stdout.write(`${JSON.stringify(item)}\n`);
  }
}

export type Column<T> = {
  header: string;
  value: (row: T) => string;
  // Hard cap in characters; longer values are truncated with an ellipsis.
  // Keeps a row scannable and bounds output size regardless of how long a
  // title/snippet field happens to be upstream.
  maxWidth?: number;
};

function truncate(value: string, maxWidth: number | undefined): string {
  if (maxWidth === undefined || value.length <= maxWidth) return value;
  return maxWidth <= 1 ? value.slice(0, maxWidth) : `${value.slice(0, maxWidth - 1)}…`;
}

// Plain aligned columns -- no box-drawing characters, no color. Those cost
// tokens and add nothing an agent can act on; a human skimming a terminal
// loses little from their absence.
export function writeTable<T>(rows: readonly T[], columns: readonly Column<T>[]): void {
  const cells = rows.map((row) => columns.map((col) => truncate(col.value(row), col.maxWidth)));
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((cellRow) => cellRow[i]?.length ?? 0)),
  );

  const formatRow = (values: readonly string[]): string =>
    values
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();

  writeStdout(formatRow(columns.map((col) => col.header)));
  for (const cellRow of cells) {
    writeStdout(formatRow(cellRow));
  }
}

// Every list command that caps its output must call this instead of
// silently returning a partial page -- an agent that doesn't know a result
// was truncated will confidently reason from an incomplete set. Printed to
// stderr, since it's metadata about the response, not part of it.
export function writeTruncationNotice(options: {
  shown: number;
  total?: number;
  nextCursor?: string;
  limitFlag?: string;
}): void {
  const { shown, total, nextCursor, limitFlag = "--limit" } = options;
  const totalPart = total !== undefined ? ` of ${total}` : "";
  const hintParts = [`use ${limitFlag}`];
  if (nextCursor) hintParts.push(`--cursor ${nextCursor}`);
  writeStderr(`showing ${shown}${totalPart} -- ${hintParts.join(" or ")}`);
}
