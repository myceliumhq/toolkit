import type { SourceAdapter } from "./index.js";
import type { SemanticIndexStore } from "./store.js";

export interface ReconcileSummary {
  // False when the adapter has no listAllIds -- nothing to reconcile
  // against, distinct from "ran and found nothing to delete".
  supported: boolean;
  checked: number;
  deleted: number;
}

// Deletion backstop for sources whose "what changed" feed silently omits
// removed items instead of tombstoning them (see SourceAdapter.listAllIds's
// own doc comment). Streams every live id from the adapter into a Set, diffs
// it against every id currently stored, and deleteSource()s whatever's
// stored but no longer live. Deliberately not run on every sync pass --
// it's an O(all ids) full sweep, meant for an infrequent tick (see
// semanticd's own reconcile interval) rather than the incremental
// watermark-driven sync loop in sync.ts.
export async function runReconcile<TId extends string | number>(
  adapter: SourceAdapter<TId>,
  store: SemanticIndexStore,
): Promise<ReconcileSummary> {
  if (!adapter.listAllIds) {
    return { supported: false, checked: 0, deleted: 0 };
  }

  const liveIds = new Set<string>();
  for await (const id of adapter.listAllIds()) {
    liveIds.add(String(id));
  }

  let deleted = 0;
  for (const sourceId of store.listSourceIds()) {
    if (!liveIds.has(sourceId)) {
      store.deleteSource(sourceId);
      deleted += 1;
    }
  }

  return { supported: true, checked: liveIds.size, deleted };
}
