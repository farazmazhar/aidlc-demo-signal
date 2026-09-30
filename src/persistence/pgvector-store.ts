/**
 * Postgres/pgvector adapter for `VectorStore` (FR3.2, FR4.1, FR7.2).
 *
 * The connection string comes from configuration at construction time and a
 * fresh connection is opened and closed per call: the spike's volumes are tiny,
 * and a per-invocation connection cannot leak across Lambda invocations.
 */

import { Client } from 'pg';

import { ValidationError } from '../domain/ports';
import type { VectorStore } from '../domain/ports';
import type { VectorRecord } from '../domain/types';
import { cosineSimilarity } from '../domain/vector-math';

export interface PgVectorStoreOptions {
  readonly connectionString: string;
  readonly dimensions: number;
  /** Guard for `listWindow`; the weekly job's window is bounded by design. */
  readonly windowLimit?: number;
}

interface VectorRow {
  readonly item_id: string;
  readonly embedding: string | number[];
  readonly meta: Record<string, unknown> | null;
  readonly created_at: Date | string;
}

/** pgvector accepts the JSON array form as a `vector` literal input. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toString() : '0')).join(',')}]`;
}

/** pgvector returns the text form; tolerate a driver that already parsed it. */
export function parseVector(value: string | number[]): number[] {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new ValidationError(`Stored embedding is not an array: ${String(value).slice(0, 32)}`);
  }
  return parsed.map(Number);
}

export class PgVectorStore implements VectorStore {
  private readonly options: PgVectorStoreOptions;

  constructor(options: PgVectorStoreOptions) {
    this.options = options;
  }

  async upsert(itemId: string, vector: number[], meta: Record<string, unknown> = {}): Promise<void> {
    this.assertDimensions(itemId, vector);
    await this.withClient(async (client) => {
      await client.query(
        `INSERT INTO feedback_vectors (item_id, embedding, source, meta, updated_at)
         VALUES ($1, $2::vector, $3, $4::jsonb, now())
         ON CONFLICT (item_id) DO UPDATE
           SET embedding = EXCLUDED.embedding,
               source = EXCLUDED.source,
               meta = EXCLUDED.meta,
               updated_at = now()`,
        [itemId, toVectorLiteral(vector), typeof meta.source === 'string' ? meta.source : null, JSON.stringify(meta)],
      );
    });
  }

  async listWindow(since: Date, limit = this.options.windowLimit ?? 2000): Promise<VectorRecord[]> {
    return this.withClient(async (client) => {
      const { rows } = await client.query<VectorRow>(
        `SELECT item_id, embedding, meta, created_at
           FROM feedback_vectors
          WHERE created_at >= $1
          ORDER BY created_at ASC
          LIMIT $2`,
        [since.toISOString(), limit],
      );
      return rows.map((row) => this.toRecord(row));
    });
  }

  async querySimilar(vector: number[], limit: number): Promise<VectorRecord[]> {
    this.assertDimensions('query', vector);
    return this.withClient(async (client) => {
      const { rows } = await client.query<VectorRow>(
        `SELECT item_id, embedding, meta, created_at
           FROM feedback_vectors
          ORDER BY embedding <=> $1::vector
          LIMIT $2`,
        [toVectorLiteral(vector), limit],
      );
      return rows.map((row) => this.toRecord(row));
    });
  }

  private toRecord(row: VectorRow): VectorRecord {
    return {
      itemId: row.item_id,
      vector: parseVector(row.embedding),
      meta: row.meta ?? {},
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  private assertDimensions(itemId: string, vector: readonly number[]): void {
    if (vector.length !== this.options.dimensions) {
      throw new ValidationError(
        `Embedding for '${itemId}' has ${vector.length} dimensions but the schema declares vector(${this.options.dimensions}). Align EMBEDDING_DIMENSIONS with the embedding model.`,
      );
    }
  }

  private async withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.options.connectionString });
    try {
      await client.connect();
      return await operation(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/** Similarity ranking kept beside the store so both fakes and callers agree. */
export function rankBySimilarity(
  records: readonly VectorRecord[],
  vector: readonly number[],
  limit: number,
): VectorRecord[] {
  return [...records]
    .map((record) => ({ record, score: cosineSimilarity(record.vector, vector) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}
