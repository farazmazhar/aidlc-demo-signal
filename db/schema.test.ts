/**
 * T1–T3 — data model / database behaviour.
 *
 * T1 happy: the rendered pgvector migration and the DynamoDB key/GSI design are
 *           the ones the rest of the system depends on.
 * T2 edge:  changing provider configuration changes the rendered schema with no
 *           code change (FR6.1/FR6.2).
 * T3 error: unusable configuration fails loudly, naming the variable — no
 *           silently invented default (FR7.2, NFR5).
 */

import { describe, expect, test } from 'bun:test';

import { ConfigError, loadConfig } from '../src/config/config';
import {
  GSI_CATEGORY_CREATED,
  GSI_DEFINITIONS,
  GSI_THEME_CREATED,
  GSI_URGENCY_CREATED,
  META_SORT_KEY,
  TABLE_ATTRIBUTE_DEFINITIONS,
  itemPartitionKey,
  runPartitionKey,
  themePartitionKey,
} from '../src/persistence/dynamo-keys';
import {
  readMigrationTemplate,
  renderMigrationSql,
  renderSchema,
  splitStatements,
} from '../src/persistence/pg-schema';
import { testEnv } from '../tests/factories';

describe('data model and database behaviour', () => {
  test('T1 renders the canonical pgvector schema and the single-table key design', () => {
    const config = loadConfig(testEnv());
    const sql = renderSchema(config);

    // Idempotent guards, so `bun run db:migrate` is safe to re-run.
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS feedback_vectors');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS feedback_vectors_embedding_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS feedback_vectors_created_at_idx');

    // Vector column width follows configuration, and the cosine index is present.
    expect(sql).toContain('vector(768)');
    expect(sql).toContain('vector_cosine_ops');
    expect(sql).not.toContain('{{');

    const statements = splitStatements(sql);
    expect(statements.length).toBeGreaterThanOrEqual(4);
    expect(statements.every((statement) => statement.length > 0)).toBe(true);
    expect(statements[0]?.startsWith('CREATE EXTENSION')).toBe(true);

    // One place, one definition, shared with the CDK stack and verify:infra.
    expect(GSI_DEFINITIONS.map((definition) => definition.name)).toEqual([
      GSI_URGENCY_CREATED,
      GSI_CATEGORY_CREATED,
      GSI_THEME_CREATED,
    ]);
    for (const definition of GSI_DEFINITIONS) {
      expect(definition.partitionKey).toBe(definition.name);
      expect(definition.sortKey).toBe('createdAt');
    }

    // Items, themes and runs live in one table, separated by key prefix.
    expect(itemPartitionKey('abc')).toBe('ITEM#abc');
    expect(themePartitionKey('run-1', 'theme-1')).toBe('THEME#run-1#theme-1');
    expect(runPartitionKey('run-1')).toBe('RUN#run-1');
    expect(META_SORT_KEY).toBe('META');

    // DynamoDB rejects a table whose index keys are missing from
    // AttributeDefinitions, so every key the design references must be declared.
    const declared = TABLE_ATTRIBUTE_DEFINITIONS.map((definition) => definition.name);
    for (const definition of GSI_DEFINITIONS) {
      expect(declared).toContain(definition.partitionKey);
      expect(declared).toContain(definition.sortKey);
    }
    expect(new Set(declared).size).toBe(declared.length);
  });

  test('T2 switching to Bedrock changes the rendered schema with no code change', () => {
    const ollamaConfig = loadConfig(testEnv());
    const bedrockConfig = loadConfig(
      testEnv({ EMBEDDING_PROVIDER: 'bedrock', EMBEDDING_DIMENSIONS: '1024' }),
    );

    expect(bedrockConfig.embeddingProvider).toBe('bedrock');
    expect(bedrockConfig.embeddingDimensions).toBe(1024);

    const bedrockSql = renderSchema(bedrockConfig);
    expect(bedrockSql).toContain('vector(1024)');
    expect(bedrockSql).not.toContain('vector(768)');

    // Same template, same statement count: configuration is the only difference.
    const template = readMigrationTemplate();
    expect(splitStatements(bedrockSql).length).toBe(splitStatements(renderSchema(ollamaConfig)).length);
    expect(renderMigrationSql(template, 1024)).toBe(bedrockSql);
  });

  test('T3 unusable configuration fails loudly and names the variable', () => {
    expect(() => loadConfig(testEnv({ DATABASE_URL: undefined }))).toThrow(ConfigError);
    expect(() => loadConfig(testEnv({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);

    for (const invalid of ['abc', '0', '-5', '768.5']) {
      expect(() => loadConfig(testEnv({ EMBEDDING_DIMENSIONS: invalid }))).toThrow(
        /EMBEDDING_DIMENSIONS/,
      );
    }

    // A known-bad provider name is a configuration error, not a silent fallback.
    expect(() => loadConfig(testEnv({ LLM_PROVIDER: 'openai' }))).toThrow(/LLM_PROVIDER/);
    expect(() => loadConfig(testEnv({ CLUSTER_SIMILARITY_THRESHOLD: '2' }))).toThrow(
      /CLUSTER_SIMILARITY_THRESHOLD/,
    );
  });
});
