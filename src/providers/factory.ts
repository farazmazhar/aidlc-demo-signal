/**
 * Provider selection by configuration (FR6.1, FR6.2).
 *
 * This function is the only place that maps a configuration value to a vendor
 * adapter. Swapping providers is therefore one environment-variable change plus a
 * redeploy of the same artefact — no code change anywhere else.
 */

import type { Config } from '../config/config';
import { ConfigError } from '../domain/ports';
import { BedrockEmbeddingProvider, BedrockLlmProvider } from './bedrock';
import { OllamaEmbeddingProvider, OllamaLlmProvider } from './ollama';
import type { EmbeddingProvider, LlmProvider, ProviderDependencies } from './types';

export type LlmConfigSlice = Pick<
  Config,
  'llmProvider' | 'ollamaBaseUrl' | 'ollamaChatModel' | 'bedrockChatModel' | 'awsRegion'
>;

export type EmbeddingConfigSlice = Pick<
  Config,
  'embeddingProvider' | 'ollamaBaseUrl' | 'ollamaEmbedModel' | 'bedrockEmbedModel' | 'embeddingDimensions' | 'awsRegion'
>;

export function createLlmProvider(
  config: LlmConfigSlice,
  dependencies: ProviderDependencies = {},
): LlmProvider {
  switch (config.llmProvider) {
    case 'ollama':
      return new OllamaLlmProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaChatModel,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      });
    case 'bedrock':
      return new BedrockLlmProvider({
        region: config.awsRegion,
        model: config.bedrockChatModel,
        ...(dependencies.bedrockClient ? { client: dependencies.bedrockClient } : {}),
      });
    default:
      throw new ConfigError(
        `LLM_PROVIDER must be one of ollama, bedrock; received "${String(config.llmProvider)}".`,
      );
  }
}

export function createEmbeddingProvider(
  config: EmbeddingConfigSlice,
  dependencies: ProviderDependencies = {},
): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case 'ollama':
      return new OllamaEmbeddingProvider({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaEmbedModel,
        dimensions: config.embeddingDimensions,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      });
    case 'bedrock':
      return new BedrockEmbeddingProvider({
        region: config.awsRegion,
        model: config.bedrockEmbedModel,
        dimensions: config.embeddingDimensions,
        ...(dependencies.bedrockClient ? { client: dependencies.bedrockClient } : {}),
      });
    default:
      throw new ConfigError(
        `EMBEDDING_PROVIDER must be one of ollama, bedrock; received "${String(config.embeddingProvider)}".`,
      );
  }
}
