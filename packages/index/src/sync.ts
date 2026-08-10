import type { EmbeddingProvider } from "@myceliumhq/embed";
import { chunkText } from "./chunking.js";
import { runWithConcurrency } from "./host.js";
import type { SourceAdapter } from "./index.js";
import type { SemanticIndexStore } from "./store.js";
import type { UpsertChunk } from "./types.js";

export interface SyncLogger {
  info?: (message: string) => void;
  warn: (message: string) => void;
}

export interface SyncSummary {
  processed: number;
  skippedUnchanged: number;
  failed: number;
  // False if this pass stopped because it hit maxItemsPerSync, not because
  // the source ran out of changes — there's more to sync on the next pass.
  reachedEnd: boolean;
}

export interface RunSyncParams<TId extends string | number> {
  adapter: SourceAdapter<TId>;
  store: SemanticIndexStore;
  embeddingProvider: EmbeddingProvider;
  chunkTokens: number;
  chunkOverlap: number;
  maxItemsPerSync: number;
  embedConcurrency: number;
  logger?: SyncLogger;
}

type ChangedItem<TId> = { id: TId; contentHash: string; modifiedAt: string };

// One incremental pass: pulls changes since the stored watermark (unset on
// first run — a full backfill) from the adapter, newest-first, short-
// circuits re-embedding when the adapter's own contentHash is unchanged, and
// chunks+embeds+stores the rest. Bounded to maxItemsPerSync per call so one
// pass can't run unbounded; the watermark only advances once a full page of
// concurrent work completes, so an interrupted run re-attempts at most one
// page's worth of items rather than losing its place.
export async function runIncrementalSync<TId extends string | number>(
  params: RunSyncParams<TId>,
): Promise<SyncSummary> {
  const { adapter, store, maxItemsPerSync, embedConcurrency } = params;
  const summary: SyncSummary = { processed: 0, skippedUnchanged: 0, failed: 0, reachedEnd: false };

  const watermark = store.getSyncWatermark();
  const pageSize = Math.max(1, embedConcurrency) * 10;
  const iterator = adapter.listChanged(watermark)[Symbol.asyncIterator]();

  let page: ChangedItem<TId>[] = [];
  try {
    while (summary.processed + summary.skippedUnchanged + summary.failed < maxItemsPerSync) {
      const next = await iterator.next();
      if (next.done) {
        summary.reachedEnd = true;
        break;
      }
      page.push(next.value);
      if (page.length >= pageSize) {
        await processPage(page, params, summary);
        store.setSyncWatermark(page.at(-1)?.modifiedAt);
        page = [];
      }
    }
  } finally {
    await iterator.return?.();
  }

  if (page.length > 0) {
    await processPage(page, params, summary);
    store.setSyncWatermark(page.at(-1)?.modifiedAt);
  }

  return summary;
}

async function processPage<TId extends string | number>(
  page: ChangedItem<TId>[],
  params: RunSyncParams<TId>,
  summary: SyncSummary,
): Promise<void> {
  const { adapter, store, embeddingProvider, chunkTokens, chunkOverlap, embedConcurrency, logger } =
    params;
  const tasks = page.map((item) => async () => {
    const sourceId = String(item.id);
    try {
      if (store.getSourceContentHash(sourceId) === item.contentHash) {
        summary.skippedUnchanged += 1;
        return;
      }

      const content = await adapter.fetchContent(item.id);
      const chunks = chunkText(content, { tokens: chunkTokens, overlap: chunkOverlap });

      let upsertChunks: UpsertChunk[] = [];
      if (chunks.length > 0) {
        const embeddings = await embeddingProvider.embedBatch(chunks.map((c) => c.text));
        upsertChunks = chunks.map((chunk, i) => ({
          id: `${sourceId}:${chunk.startLine}-${chunk.endLine}`,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          hash: chunk.hash,
          embedding: embeddings[i] ?? [],
        }));
      }
      store.upsertSource(sourceId, item.contentHash, item.modifiedAt, upsertChunks);
      summary.processed += 1;
    } catch (err) {
      summary.failed += 1;
      logger?.warn(
        `@myceliumhq/index: failed to index ${sourceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  await runWithConcurrency(tasks, Math.max(1, embedConcurrency));
}
