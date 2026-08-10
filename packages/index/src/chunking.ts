import { hashText } from "./host.js";

export interface Chunk {
  text: string;
  startLine: number;
  endLine: number;
  hash: string;
}

export interface ChunkOptions {
  tokens: number;
  overlap: number;
}

// ~4 chars/token, the usual cheap approximation when a real tokenizer isn't
// worth the dependency for this — chunk boundaries just need to be roughly
// tokens-sized, not exact.
const CHARS_PER_TOKEN = 4;

// Splits text into overlapping, line-numbered spans (1-indexed, matching
// whatever line numbering the caller already uses elsewhere for the same
// content). Line-based rather than sentence/paragraph-aware: keeps chunk
// boundaries reproducible and cheap to compute over arbitrary markdown.
export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  const tokenBudget = Math.max(1, options.tokens);
  const overlapBudget = Math.max(0, Math.min(options.overlap, tokenBudget - 1));

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let tokenCount = 0;
    while (end < lines.length) {
      const lineTokens = Math.max(1, Math.ceil((lines[end]?.length ?? 0) / CHARS_PER_TOKEN));
      if (tokenCount > 0 && tokenCount + lineTokens > tokenBudget) break;
      tokenCount += lineTokens;
      end += 1;
    }
    // A single line longer than the whole budget still needs to go somewhere.
    if (end === start) end = start + 1;

    const chunkLines = lines.slice(start, end);
    const chunkText = chunkLines.join("\n");
    chunks.push({
      text: chunkText,
      startLine: start + 1,
      endLine: end,
      hash: hashText(chunkText),
    });

    if (end >= lines.length) break;

    // Step back by roughly overlapBudget tokens' worth of trailing lines.
    let back = 0;
    let overlapTokens = 0;
    while (back < chunkLines.length - 1 && overlapTokens < overlapBudget) {
      const line = chunkLines[chunkLines.length - 1 - back];
      overlapTokens += Math.max(1, Math.ceil((line?.length ?? 0) / CHARS_PER_TOKEN));
      back += 1;
    }
    start = end - back;
  }

  return chunks;
}
