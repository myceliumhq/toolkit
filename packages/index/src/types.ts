// Canonical fingerprint of "what produced this index". Compared against what's
// stored on disk on every open; any mismatch means the stored vectors came
// from a different provider/model/dimensionality/chunking scheme and can't
// be mixed with new ones, so the index is wiped and rebuilt from scratch.
export interface IndexIdentity {
  providerId: string;
  model: string;
  dimensions: number;
  chunkTokens: number;
  chunkOverlap: number;
}

export function identitiesMatch(a: IndexIdentity, b: IndexIdentity): boolean {
  return (
    a.providerId === b.providerId &&
    a.model === b.model &&
    a.dimensions === b.dimensions &&
    a.chunkTokens === b.chunkTokens &&
    a.chunkOverlap === b.chunkOverlap
  );
}

// A chunk-level hit from the vector index, before per-source dedup.
export interface ChunkHit {
  chunkId: string;
  sourceId: string;
  startLine: number;
  endLine: number;
  text: string;
  // Cosine similarity in [-1, 1] (higher is better) — already converted from
  // sqlite-vec's distance metric.
  score: number;
}

// A source-level semantic search result — one row per matching source (never
// per chunk), so callers can fold this straight into their own lexical
// results without dealing with chunk granularity.
export interface SemanticMatch {
  sourceId: string;
  snippet: string;
  score: number;
  startLine: number;
  endLine: number;
}

export interface UpsertChunk {
  id: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
  embedding: number[];
}
