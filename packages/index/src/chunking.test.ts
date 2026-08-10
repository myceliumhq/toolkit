import { describe, expect, test } from "vitest";
import { chunkText } from "./chunking.js";

describe("chunkText", () => {
  test("returns a single chunk for short text", () => {
    const chunks = chunkText("line one\nline two\nline three", { tokens: 400, overlap: 80 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 3 });
    expect(chunks[0]?.text).toBe("line one\nline two\nline three");
  });

  test("splits long text into multiple chunks with contiguous line coverage", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const chunks = chunkText(lines.join("\n"), { tokens: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // Every line is covered by at least one chunk, first chunk starts at 1,
    // last chunk ends at the final line.
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(200);
    const contiguous = chunks
      .slice(1)
      .every((chunk, i) => chunk.startLine <= (chunks[i]?.endLine ?? -1));
    expect(contiguous).toBe(true);
  });

  test("consecutive chunks overlap by roughly the configured amount", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${"x".repeat(20)}`);
    const chunks = chunkText(lines.join("\n"), { tokens: 50, overlap: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    const [first, second] = chunks;
    if (!first || !second) throw new Error("expected at least two chunks");
    expect(first.endLine - second.startLine + 1).toBeGreaterThan(0);
  });

  test("a single line longer than the token budget still becomes its own chunk", () => {
    const chunks = chunkText("x".repeat(10_000), { tokens: 10, overlap: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(1);
  });

  test("each chunk carries a content hash", () => {
    const chunks = chunkText("hello world", { tokens: 400, overlap: 80 });
    expect(chunks[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("empty text produces no chunks", () => {
    expect(chunkText("", { tokens: 400, overlap: 80 })).toEqual([]);
  });
});
