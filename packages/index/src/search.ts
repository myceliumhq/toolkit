import type { EmbeddingProvider } from "@myceliumhq/embed";
import type { SemanticIndexStore } from "./store.js";
import type { SemanticMatch } from "./types.js";

export interface SearchDeps {
  store: SemanticIndexStore;
  embeddingProvider: EmbeddingProvider;
  queryTimeoutMs: number;
  logger?: { warn: (message: string) => void };
}

// Oversample chunk-level KNN hits before collapsing to one row per source, so
// a source doesn't get dropped just because its single best-matching chunk
// didn't make it into a `limit`-sized raw scan.
const CANDIDATE_OVERSAMPLE = 4;

// Embeds `searchTerm` (query-time — sources were embedded ahead of time, at
// sync time), does a chunk-level KNN scan, and collapses it to the single
// best-scoring chunk per source. Never throws — any embedding-provider or
// SQLite error, or a call that overruns `queryTimeoutMs`, resolves to `[]`
// so a caller's own lexical results still come back untouched (fail open).
export async function searchSemantic(
  deps: SearchDeps,
  searchTerm: string | undefined,
  limit: number,
): Promise<SemanticMatch[]> {
  if (!searchTerm) return [];

  try {
    return await withTimeout(runQuery(deps, searchTerm, limit), deps.queryTimeoutMs);
  } catch (err) {
    deps.logger?.warn(
      `@myceliumhq/index: query failed, falling back to lexical-only results: ${describeError(err)}`,
    );
    return [];
  }
}

async function runQuery(
  deps: SearchDeps,
  searchTerm: string,
  limit: number,
): Promise<SemanticMatch[]> {
  const queryEmbedding = await deps.embeddingProvider.embedQuery(searchTerm);
  const hits = deps.store.knnSearch(queryEmbedding, Math.max(limit, 1) * CANDIDATE_OVERSAMPLE);

  const bestPerSource = new Map<
    string,
    { snippet: string; score: number; startLine: number; endLine: number }
  >();
  for (const hit of hits) {
    const existing = bestPerSource.get(hit.sourceId);
    if (!existing || hit.score > existing.score) {
      bestPerSource.set(hit.sourceId, {
        snippet: hit.text,
        score: hit.score,
        startLine: hit.startLine,
        endLine: hit.endLine,
      });
    }
  }

  return [...bestPerSource.entries()]
    .map(([sourceId, { snippet, score, startLine, endLine }]) => ({
      sourceId,
      snippet,
      score,
      startLine,
      endLine,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`semantic query timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
