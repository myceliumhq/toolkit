// Real sqlite-vec, real node:sqlite -- no fake/mock store here, since the
// whole point of this suite is exercising openSemanticIndex end to end
// (sync + search + identity-drift rebuild) against the real thing.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openSemanticIndex, type SemanticIndex, type SourceAdapter } from "./index.js";

// Deterministic fake: a 4-dim "embedding" derived from character codes, so
// texts sharing more characters score more similar without needing a real model.
function fakeEmbeddingProvider({ id = "fake", model = "fake-model", dimensions = 4 } = {}) {
  return {
    id,
    model,
    dimensions,
    async embedQuery(text: string) {
      return embed(text, dimensions);
    },
    async embedBatch(texts: string[]) {
      return texts.map((text) => embed(text, dimensions));
    },
  };
}

function embed(text: string, dimensions: number): number[] {
  const vec = new Array(dimensions).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[text.charCodeAt(i) % dimensions] += 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

type FakeItem = { id: number; contentHash: string; modifiedAt: string; content: string };

// `withListAllIds: true` makes the fixture mutable list `items` the live
// source of truth for reconcile() tests -- listAllIds re-reads it on every
// call, so a test can splice an item out and see reconcile() react.
function fakeAdapter(
  items: FakeItem[],
  opts: { withListAllIds?: boolean } = {},
): SourceAdapter<number> {
  return {
    name: "fake",
    async *listChanged(since) {
      const sorted = [...items].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
      for (const item of sorted) {
        // Inclusive at the boundary (gte, not gt) — see the SourceAdapter
        // docstring for why an exclusive filter here would be a real bug.
        if (since && item.modifiedAt < since) continue;
        yield { id: item.id, contentHash: item.contentHash, modifiedAt: item.modifiedAt };
      }
    },
    async fetchContent(id) {
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error(`no such item: ${id}`);
      return item.content;
    },
    ...(opts.withListAllIds
      ? {
          async *listAllIds() {
            for (const item of items) yield item.id;
          },
        }
      : {}),
  };
}

const openHandles: SemanticIndex[] = [];
afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close();
});

async function open(config: Partial<Parameters<typeof openSemanticIndex>[0]> = {}) {
  const result = await openSemanticIndex({
    embeddingProvider: fakeEmbeddingProvider(),
    dbPath: ":memory:",
    chunkTokens: 400,
    chunkOverlap: 80,
    embedConcurrency: 2,
    maxItemsPerSync: 200,
    queryTimeoutMs: 3_000,
    ...config,
  } as Parameters<typeof openSemanticIndex>[0]);
  if (!result.available) throw new Error(`test setup failed: ${result.reason}`);
  openHandles.push(result.index);
  return result.index;
}

describe("openSemanticIndex + sync + search (real sqlite-vec)", () => {
  test("syncs sources and finds the most relevant one by search term", async () => {
    const index = await open();
    const adapter = fakeAdapter([
      {
        id: 1,
        contentHash: "h1",
        modifiedAt: "2026-01-01T00:00:00Z",
        content: "apples and oranges",
      },
      {
        id: 2,
        contentHash: "h2",
        modifiedAt: "2026-01-02T00:00:00Z",
        content: "quarterly tax filing",
      },
      {
        id: 3,
        contentHash: "h3",
        modifiedAt: "2026-01-03T00:00:00Z",
        content: "orange marmalade recipe",
      },
    ]);

    const summary = await index.sync(adapter);
    expect(summary.processed).toBe(3);
    expect(summary.failed).toBe(0);
    expect(index.sourceCount()).toBe(3);

    const results = await index.search("orange", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.sourceId === "1" || r.sourceId === "3")).toBe(true);
  });

  test("a second sync pass with no changes skips everything", async () => {
    const index = await open();
    const items: FakeItem[] = [
      { id: 1, contentHash: "h1", modifiedAt: "2026-01-01T00:00:00Z", content: "hello world" },
    ];
    const adapter = fakeAdapter(items);

    const first = await index.sync(adapter);
    expect(first.processed).toBe(1);

    const second = await index.sync(adapter);
    expect(second.processed).toBe(0);
    expect(second.skippedUnchanged).toBe(1);
  });

  test("a changed contentHash re-embeds the source", async () => {
    const index = await open();
    const items: FakeItem[] = [
      { id: 1, contentHash: "h1", modifiedAt: "2026-01-01T00:00:00Z", content: "version one" },
    ];
    const adapter = fakeAdapter(items);
    await index.sync(adapter);

    const [item] = items;
    if (!item) throw new Error("test setup: expected one item");
    item.contentHash = "h2";
    item.modifiedAt = "2026-01-02T00:00:00Z";
    item.content = "version two";
    const second = await index.sync(adapter);
    expect(second.processed).toBe(1);
    expect(second.skippedUnchanged).toBe(0);
  });

  test("reconcile is a no-op when the adapter has no listAllIds", async () => {
    const index = await open();
    const adapter = fakeAdapter([
      { id: 1, contentHash: "h1", modifiedAt: "2026-01-01T00:00:00Z", content: "hello" },
    ]);
    await index.sync(adapter);

    const result = await index.reconcile(adapter);
    expect(result).toEqual({ supported: false, checked: 0, deleted: 0 });
    expect(index.sourceCount()).toBe(1);
  });

  test("reconcile purges sources the adapter no longer lists, and leaves live ones alone", async () => {
    const index = await open();
    const items: FakeItem[] = [
      { id: 1, contentHash: "h1", modifiedAt: "2026-01-01T00:00:00Z", content: "keep me" },
      { id: 2, contentHash: "h2", modifiedAt: "2026-01-02T00:00:00Z", content: "delete me" },
    ];
    const adapter = fakeAdapter(items, { withListAllIds: true });
    await index.sync(adapter);
    expect(index.sourceCount()).toBe(2);

    items.splice(1, 1); // source 2 deleted at the source, source 1 still live

    const result = await index.reconcile(adapter);
    expect(result).toEqual({ supported: true, checked: 1, deleted: 1 });
    expect(index.sourceCount()).toBe(1);

    expect(await index.search("keep", 5)).not.toEqual([]);
  });

  test("search returns nothing before any sync, and fails open on an empty term", async () => {
    const index = await open();
    expect(await index.search("anything", 5)).toEqual([]);
    expect(await index.search(undefined, 5)).toEqual([]);
  });

  test("reopening with a different embedding model rebuilds the index from scratch", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mycelium-index-"));
    const dbPath = path.join(dir, "index.db");
    try {
      const first = await open({
        dbPath,
        embeddingProvider: fakeEmbeddingProvider({ model: "model-a", dimensions: 4 }),
      });
      await first.sync(
        fakeAdapter([
          { id: 1, contentHash: "h1", modifiedAt: "2026-01-01T00:00:00Z", content: "x" },
        ]),
      );
      expect(first.sourceCount()).toBe(1);
      first.close();
      openHandles.pop();

      // Different model -> different identity fingerprint -> rebuild, even
      // though it's the same dbPath and same dimensionality.
      const second = await open({
        dbPath,
        embeddingProvider: fakeEmbeddingProvider({ model: "model-b", dimensions: 4 }),
      });
      expect(second.sourceCount()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
