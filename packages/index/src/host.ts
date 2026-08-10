import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

// This package's sqlite-vec backing needs node:sqlite's loadExtension
// support, which Bun does not implement (checked directly: Bun's bundled
// sqlite3 build has extension loading compiled out entirely, separate from
// whether node:sqlite itself exists). Run this package under Node.
export function requireNodeSqlite(): typeof import("node:sqlite") {
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch (err) {
    throw new Error(
      `@myceliumhq/index requires Node's built-in node:sqlite module (run under Node, not Bun): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function loadSqliteVecExtension(
  db: DatabaseSyncType,
): { ok: true } | { ok: false; error: string } {
  try {
    sqliteVec.load(db);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < tasks.length; i = next++) {
      const task = tasks[i];
      if (task) results[i] = await task();
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker),
  );
  return results;
}
