/**
 * Composition root for the Lambda entrypoints.
 *
 * This is the only module that turns configuration into real adapters. It is
 * invoked per request (the clustering job per invocation), so a provider or
 * dimension change in `config/config.env` takes effect without a code change
 * (FR6.2) — nothing here is captured at module load.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { createFileStaticAssets } from '../api/static-assets';
import type { StaticAssets } from '../api/static-assets';
import type { ApiConfig, ApiDependencies } from '../api/routes';
import type { Config } from '../config/config';
import { ConfigError } from '../domain/ports';
import { DynamoFeedbackRepository } from '../persistence/dynamo-repository';
import { PgVectorStore } from '../persistence/pgvector-store';
import { createEmbeddingProvider, createLlmProvider } from '../providers/factory';
import type { EmbeddingProvider, LlmProvider } from '../providers/types';

export function buildRepository(config: Config): DynamoFeedbackRepository {
  return new DynamoFeedbackRepository({
    tableName: config.feedbackTable,
    region: config.awsRegion,
    endpoint: config.awsEndpointUrl,
  });
}

export function buildVectorStore(config: Config): PgVectorStore {
  return new PgVectorStore({
    connectionString: config.databaseUrl,
    dimensions: config.embeddingDimensions,
  });
}

export function buildProviders(config: Config): {
  llm: LlmProvider;
  embedder: EmbeddingProvider;
} {
  return {
    llm: createLlmProvider(config),
    embedder: createEmbeddingProvider(config),
  };
}

/**
 * Locate the static dashboard assets.
 *
 * Deployed, they sit beside the bundle in `static/`; in the repository they are
 * under `dashboard/static`. Anything else is a configuration error rather than a
 * silently blank dashboard.
 */
export function resolveStaticDirectory(): string {
  const candidates = [
    path.join(__dirname, 'static'),
    path.join(process.cwd(), 'dashboard', 'static'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  throw new ConfigError(
    `Dashboard assets not found. Looked in: ${candidates.join(', ')}. Run from the workspace root or bundle the assets with the Lambda.`,
  );
}

let cachedStaticAssets: StaticAssets | undefined;

export function buildStaticAssets(): StaticAssets {
  cachedStaticAssets ??= createFileStaticAssets(resolveStaticDirectory());
  return cachedStaticAssets;
}

export function buildApiDependencies(config: Config): ApiDependencies {
  const { llm, embedder } = buildProviders(config);
  const apiConfig: ApiConfig = {
    apiStageName: config.apiStageName,
    dashboardTrendWeeks: config.dashboardTrendWeeks,
  };
  return {
    repository: buildRepository(config),
    vectors: buildVectorStore(config),
    llm,
    embedder,
    clock: { now: () => new Date() },
    config: apiConfig,
    staticAssets: buildStaticAssets(),
  };
}
