import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { ensureDir, loadSqliteVecExtension, requireNodeSqlite } from "./host.js";
import type { ChunkHit, IndexIdentity, UpsertChunk } from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS semantic_index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  chunk_tokens INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_sources (
  source_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS semantic_chunks_source_id ON semantic_chunks(source_id);

CREATE TABLE IF NOT EXISTS semantic_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark TEXT,
  updated_at TEXT NOT NULL
);
`;

const VEC_TABLE = "semantic_chunks_vec";

function assertValidDimensions(dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`@myceliumhq/index: invalid embedding dimensions (${dimensions})`);
  }
}

export type OpenStoreResult =
  | { available: true; store: SemanticIndexStore }
  | { available: false; reason: string };

// Owns the private SQLite file: schema, identity/drift detection, per-source
// chunk+vector storage, sync watermark, and a brute-force cosine KNN query.
// Vector-only — the source system's own lexical search supplies the other
// leg of a hybrid query one level up (see reciprocalRankFusion).
export class SemanticIndexStore {
  private constructor(private readonly db: DatabaseSyncType) {}

  // Never throws — any failure resolves to `{ available: false, reason }` so
  // callers can fail open to lexical-only search instead of crashing.
  static async open(indexPath: string, dimensions: number): Promise<OpenStoreResult> {
    let sqlite: typeof import("node:sqlite");
    try {
      sqlite = requireNodeSqlite();
    } catch (err) {
      return { available: false, reason: describeError(err) };
    }

    let db: DatabaseSyncType | undefined;
    try {
      assertValidDimensions(dimensions);
      if (indexPath !== ":memory:") {
        ensureDir(path.dirname(indexPath));
      }
      db = new sqlite.DatabaseSync(indexPath, { allowExtension: true });
      const vecResult = loadSqliteVecExtension(db);
      if (!vecResult.ok) {
        db.close();
        return { available: false, reason: vecResult.error };
      }
      const store = new SemanticIndexStore(db);
      store.ensureSchema(dimensions);
      return { available: true, store };
    } catch (err) {
      try {
        db?.close();
      } catch {
        // ignore — the original error below is what matters
      }
      return { available: false, reason: describeError(err) };
    }
  }

  private ensureSchema(dimensions: number): void {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${dimensions}])`,
    );
  }

  getIdentity(): IndexIdentity | undefined {
    const row = this.db
      .prepare(
        "SELECT provider_id, model, dimensions, chunk_tokens, chunk_overlap FROM semantic_index_meta WHERE id = 1",
      )
      .get() as
      | {
          provider_id: string;
          model: string;
          dimensions: number;
          chunk_tokens: number;
          chunk_overlap: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      providerId: row.provider_id,
      model: row.model,
      dimensions: row.dimensions,
      chunkTokens: row.chunk_tokens,
      chunkOverlap: row.chunk_overlap,
    };
  }

  private setIdentity(identity: IndexIdentity): void {
    this.db
      .prepare(
        `INSERT INTO semantic_index_meta (id, provider_id, model, dimensions, chunk_tokens, chunk_overlap)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id = excluded.provider_id,
           model = excluded.model,
           dimensions = excluded.dimensions,
           chunk_tokens = excluded.chunk_tokens,
           chunk_overlap = excluded.chunk_overlap`,
      )
      .run(
        identity.providerId,
        identity.model,
        identity.dimensions,
        identity.chunkTokens,
        identity.chunkOverlap,
      );
  }

  // Wipes every source/chunk/vector and the sync watermark, then records
  // `identity` as the new fingerprint. Mixing vectors from two different
  // embedding models in one vec0 table would make KNN distances meaningless,
  // so a clean rebuild — full re-backfill from the source system, which the
  // index is always fully derivable from — is the only safe option.
  rebuild(identity: IndexIdentity): void {
    assertValidDimensions(identity.dimensions);
    this.db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
    this.db.exec("DELETE FROM semantic_chunks");
    this.db.exec("DELETE FROM semantic_sources");
    this.db.exec("DELETE FROM semantic_sync_state");
    this.ensureSchema(identity.dimensions);
    this.setIdentity(identity);
  }

  getSourceContentHash(sourceId: string): string | undefined {
    const row = this.db
      .prepare("SELECT content_hash FROM semantic_sources WHERE source_id = ?")
      .get(sourceId) as { content_hash: string } | undefined;
    return row?.content_hash;
  }

  // Replaces every chunk/vector belonging to `sourceId` with `chunks` (paired
  // 1:1 with `chunks[i].embedding`) in one transaction, and records the
  // source's content hash/modified timestamp so a future sync pass can
  // short-circuit on an unchanged hash.
  upsertSource(
    sourceId: string,
    contentHash: string,
    modifiedAt: string,
    chunks: UpsertChunk[],
  ): void {
    const now = new Date().toISOString();
    this.withTransaction(() => {
      this.deleteSourceChunks(sourceId);
      const insertChunk = this.db.prepare(
        "INSERT INTO semantic_chunks (id, source_id, start_line, end_line, text, hash) VALUES (?, ?, ?, ?, ?, ?)",
      );
      const insertVec = this.db.prepare(`INSERT INTO ${VEC_TABLE} (id, embedding) VALUES (?, ?)`);
      for (const chunk of chunks) {
        insertChunk.run(chunk.id, sourceId, chunk.startLine, chunk.endLine, chunk.text, chunk.hash);
        insertVec.run(chunk.id, JSON.stringify(chunk.embedding));
      }
      this.db
        .prepare(
          `INSERT INTO semantic_sources (source_id, content_hash, modified_at, indexed_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             content_hash = excluded.content_hash,
             modified_at = excluded.modified_at,
             indexed_at = excluded.indexed_at`,
        )
        .run(sourceId, contentHash, modifiedAt, now);
    });
  }

  deleteSource(sourceId: string): void {
    this.withTransaction(() => {
      this.deleteSourceChunks(sourceId);
      this.db.prepare("DELETE FROM semantic_sources WHERE source_id = ?").run(sourceId);
    });
  }

  private deleteSourceChunks(sourceId: string): void {
    const ids = this.db
      .prepare("SELECT id FROM semantic_chunks WHERE source_id = ?")
      .all(sourceId) as {
      id: string;
    }[];
    if (ids.length === 0) return;
    const deleteVec = this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE id = ?`);
    for (const { id } of ids) deleteVec.run(id);
    this.db.prepare("DELETE FROM semantic_chunks WHERE source_id = ?").run(sourceId);
  }

  getSyncWatermark(): string | undefined {
    const row = this.db.prepare("SELECT watermark FROM semantic_sync_state WHERE id = 1").get() as
      | { watermark: string | null }
      | undefined;
    return row?.watermark ?? undefined;
  }

  setSyncWatermark(watermark: string | undefined): void {
    this.db
      .prepare(
        `INSERT INTO semantic_sync_state (id, watermark, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET watermark = excluded.watermark, updated_at = excluded.updated_at`,
      )
      .run(watermark ?? null, new Date().toISOString());
  }

  // Brute-force cosine KNN over every stored chunk vector via sqlite-vec's
  // vec_distance_cosine scalar function (not vec0's own MATCH/ANN mode — a
  // plain ORDER BY full scan works identically across sqlite-vec versions
  // and is exact, not approximate, all the way up to the low-hundreds-of-
  // thousands-of-chunks scale this is meant for).
  knnSearch(queryEmbedding: number[], limit: number): ChunkHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.source_id AS source_id, c.start_line AS start_line,
                c.end_line AS end_line, c.text AS text,
                vec_distance_cosine(v.embedding, vec_f32(?)) AS dist
           FROM ${VEC_TABLE} v
           JOIN semantic_chunks c ON c.id = v.id
          ORDER BY dist ASC
          LIMIT ?`,
      )
      .all(JSON.stringify(queryEmbedding), limit) as {
      chunk_id: string;
      source_id: string;
      start_line: number;
      end_line: number;
      text: string;
      dist: number;
    }[];
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      score: 1 - row.dist,
    }));
  }

  sourceCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM semantic_sources").get() as {
      n: number;
    };
    return row.n;
  }

  // Every source id currently stored, for reconcile() to diff against an
  // adapter's live id set -- see reconcile.ts.
  listSourceIds(): string[] {
    const rows = this.db.prepare("SELECT source_id FROM semantic_sources").all() as {
      source_id: string;
    }[];
    return rows.map((row) => row.source_id);
  }

  private withTransaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
