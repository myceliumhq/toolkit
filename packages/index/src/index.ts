import type { EmbeddingProvider } from "@myceliumhq/embed";
import { type ReconcileSummary, runReconcile } from "./reconcile.js";
import { searchSemantic } from "./search.js";
import { type OpenStoreResult, SemanticIndexStore } from "./store.js";
import { runIncrementalSync, type SyncLogger, type SyncSummary } from "./sync.js";
import { type IndexIdentity, identitiesMatch, type SemanticMatch } from "./types.js";

// Entity-shape differences between source systems (paperless documents,
// trilium notes, ...) live behind this adapter; everything else here is source-agnostic.
export interface SourceAdapter<TId extends string | number> {
  readonly name: string;
  // `since` must be inclusive (>=), not exclusive (>): a source system can
  // stamp the same modifiedAt on multiple items (e.g. one bulk edit), and an
  // exclusive filter would permanently drop every item tied with the
  // watermark boundary the moment it's set. Re-yielding an unchanged item at
  // the boundary is fine — its contentHash short-circuits it to a no-op.
  listChanged(
    since: string | undefined,
  ): AsyncIterable<{ id: TId; contentHash: string; modifiedAt: string }>;
  fetchContent(id: TId): Promise<string>;
  // Every id that currently exists at the source, for reconcile() to diff
  // against what's stored and purge anything no longer there. Optional
  // because listChanged/fetchContent alone are enough for keeping content
  // up to date -- this is only needed to detect deletions, which a source
  // whose API silently omits removed items from its "changed" feed (no
  // tombstones) can't otherwise signal. Omit it and reconcile() is a no-op.
  listAllIds?(): AsyncIterable<TId>;
}

export interface RankedHit<TId> {
  id: TId;
  score: number;
}

// Merges ranked lists by rank position, not raw score — lexical and semantic
// scores are rarely on comparable scales. k=60 per the original RRF paper.
export function reciprocalRankFusion<TId extends string | number>(
  rankedLists: TId[][],
  k = 60,
): RankedHit<TId>[] {
  const scores = new Map<TId, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

export interface SemanticIndexConfig {
  embeddingProvider: EmbeddingProvider;
  dbPath: string;
  chunkTokens: number;
  chunkOverlap: number;
  embedConcurrency: number;
  maxItemsPerSync: number;
  queryTimeoutMs: number;
}

export const DEFAULT_SEMANTIC_INDEX_CONFIG: Omit<
  SemanticIndexConfig,
  "embeddingProvider" | "dbPath"
> = {
  chunkTokens: 400,
  chunkOverlap: 80,
  embedConcurrency: 2,
  maxItemsPerSync: 200,
  queryTimeoutMs: 3_000,
};

export type SemanticIndexHandle =
  | { available: true; index: SemanticIndex }
  | { available: false; reason: string };

// Opens (or rebuilds, on an identity mismatch) the index and returns a
// ready-to-use handle bundling the store with sync/search entry points.
// Never throws — resolves to `{ available: false, reason }` on any failure
// so a caller can fail open to lexical-only search.
export async function openSemanticIndex(config: SemanticIndexConfig): Promise<SemanticIndexHandle> {
  const opened: OpenStoreResult = await SemanticIndexStore.open(
    config.dbPath,
    config.embeddingProvider.dimensions,
  );
  if (!opened.available) return { available: false, reason: opened.reason };

  const { store } = opened;
  const wantedIdentity: IndexIdentity = {
    providerId: config.embeddingProvider.id,
    model: config.embeddingProvider.model,
    dimensions: config.embeddingProvider.dimensions,
    chunkTokens: config.chunkTokens,
    chunkOverlap: config.chunkOverlap,
  };
  const storedIdentity = store.getIdentity();
  if (!storedIdentity || !identitiesMatch(storedIdentity, wantedIdentity)) {
    store.rebuild(wantedIdentity);
  }

  return { available: true, index: new SemanticIndex(store, config) };
}

export class SemanticIndex {
  constructor(
    private readonly store: SemanticIndexStore,
    private readonly config: SemanticIndexConfig,
  ) {}

  sync<TId extends string | number>(
    adapter: SourceAdapter<TId>,
    logger?: SyncLogger,
  ): Promise<SyncSummary> {
    return runIncrementalSync({
      adapter,
      store: this.store,
      embeddingProvider: this.config.embeddingProvider,
      chunkTokens: this.config.chunkTokens,
      chunkOverlap: this.config.chunkOverlap,
      maxItemsPerSync: this.config.maxItemsPerSync,
      embedConcurrency: this.config.embedConcurrency,
      logger,
    });
  }

  // Deletion backstop -- see reconcile.ts's own doc comment. A no-op
  // (`supported: false`) if the adapter has no listAllIds.
  reconcile<TId extends string | number>(adapter: SourceAdapter<TId>): Promise<ReconcileSummary> {
    return runReconcile(adapter, this.store);
  }

  search(
    searchTerm: string | undefined,
    limit: number,
    logger?: { warn: (message: string) => void },
  ): Promise<SemanticMatch[]> {
    return searchSemantic(
      {
        store: this.store,
        embeddingProvider: this.config.embeddingProvider,
        queryTimeoutMs: this.config.queryTimeoutMs,
        logger,
      },
      searchTerm,
      limit,
    );
  }

  sourceCount(): number {
    return this.store.sourceCount();
  }

  close(): void {
    this.store.close();
  }
}

export { type Chunk, type ChunkOptions, chunkText } from "./chunking.js";
export { type ReconcileSummary, runReconcile } from "./reconcile.js";
export { type SearchDeps, searchSemantic } from "./search.js";
export { type OpenStoreResult, SemanticIndexStore } from "./store.js";
export {
  type RunSyncParams,
  runIncrementalSync,
  type SyncLogger,
  type SyncSummary,
} from "./sync.js";
export {
  type ChunkHit,
  type IndexIdentity,
  identitiesMatch,
  type SemanticMatch,
  type UpsertChunk,
} from "./types.js";
