-- Build Signal — canonical pgvector schema template (FR7.2).
--
-- Rendered by src/persistence/pg-schema.ts, which substitutes the single
-- vector-width placeholder below with the configured embedding dimensions, so
-- the column always matches the selected embedding model. Every statement is
-- idempotent, so re-running `bun run db:migrate` is safe on a database that
-- already matches.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS feedback_vectors (
  item_id    TEXT PRIMARY KEY,
  embedding  vector({{EMBEDDING_DIMENSIONS}}) NOT NULL,
  source     TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cosine-distance index used by the clustering job's similarity work (FR4.1).
CREATE INDEX IF NOT EXISTS feedback_vectors_embedding_idx
  ON feedback_vectors USING hnsw (embedding vector_cosine_ops);

-- The weekly job reads a time window rather than a similarity neighbourhood.
CREATE INDEX IF NOT EXISTS feedback_vectors_created_at_idx
  ON feedback_vectors (created_at);
