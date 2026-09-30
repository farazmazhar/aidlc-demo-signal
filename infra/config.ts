/**
 * Infrastructure configuration (FR7.1, FR7.2, NFR1).
 *
 * `config/config.env` is the single source: host scripts load it with
 * `bun --env-file`, and this module parses the same file to build each Lambda's
 * environment. Container-internal endpoints differ from host endpoints, so the
 * `_LAMBDA` variants are substituted explicitly here rather than derived by a
 * hidden rule (risk R9).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../src/config/config';
import type { Config } from '../src/config/config';

export const DEFAULT_ENV_FILE = path.resolve(process.cwd(), 'config', 'config.env');

export interface StackConfig {
  readonly config: Config;
  /** Environment for both Lambda functions. */
  readonly lambdaEnvironment: Record<string, string>;
  readonly stackName: string;
  /** Lambda runtime for both functions; see LAMBDA_RUNTIME in config/config.env. */
  readonly lambdaRuntime: string;
  readonly account: string;
  readonly region: string;
  readonly restartApiId: string;
  readonly apiCodeS3Bucket: string;
  readonly apiCodeS3Key: string;
  readonly clusteringCodeS3Bucket: string;
  readonly clusteringCodeS3Key: string;
  readonly scheduleName: string;
}

/** Parse a dotenv file without sourcing it in a shell (values contain `(`, `)` and spaces). */
export function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    parsed[key] = value;
  }
  return parsed;
}

export function loadStackConfig(envFile: string = DEFAULT_ENV_FILE): StackConfig {
  const fileValues = parseEnvFile(readFileSync(envFile, 'utf8'));
  // The file wins over the ambient environment: it is the committed single source.
  const config = loadConfig({ ...process.env, ...fileValues });

  const lambdaEnvironment: Record<string, string> = {
    LLM_PROVIDER: config.llmProvider,
    EMBEDDING_PROVIDER: config.embeddingProvider,
    OLLAMA_BASE_URL: fileValues.OLLAMA_BASE_URL_LAMBDA ?? config.ollamaBaseUrl,
    OLLAMA_CHAT_MODEL: config.ollamaChatModel,
    OLLAMA_EMBED_MODEL: config.ollamaEmbedModel,
    BEDROCK_CHAT_MODEL: config.bedrockChatModel,
    BEDROCK_EMBED_MODEL: config.bedrockEmbedModel,
    // AWS_REGION is reserved by the Lambda runtime and set automatically; only
    // the endpoint override is ours to supply.
    AWS_ENDPOINT_URL: fileValues.AWS_ENDPOINT_URL_LAMBDA ?? config.awsEndpointUrl,
    EMBEDDING_DIMENSIONS: String(config.embeddingDimensions),
    FEEDBACK_TABLE: config.feedbackTable,
    DATABASE_URL: fileValues.DATABASE_URL_LAMBDA ?? config.databaseUrl,
    CLUSTER_SIMILARITY_THRESHOLD: String(config.clusterSimilarityThreshold),
    CLUSTER_MIN_SIZE: String(config.clusterMinSize),
    CLUSTER_WINDOW_DAYS: String(config.clusterWindowDays),
    DASHBOARD_TREND_WEEKS: String(config.dashboardTrendWeeks),
    SCHEDULE_CRON: config.scheduleCron,
    SES_SENDER: config.sesSender,
    API_STAGE_NAME: config.apiStageName,
    LOCAL_API_URL_STYLE: config.localApiUrlStyle,
  };

  return {
    config,
    lambdaEnvironment,
    stackName: fileValues.STACK_NAME ?? 'signal-stack',
    lambdaRuntime: fileValues.LAMBDA_RUNTIME ?? 'nodejs20.x',
    account: fileValues.AWS_ACCOUNT_ID ?? '000000000000',
    region: config.awsRegion,
    restartApiId: fileValues.REST_API_ID ?? '',
    apiCodeS3Bucket: fileValues.ARTIFACT_BUCKET ?? 'signal-artifacts',
    apiCodeS3Key: fileValues.API_CODE_KEY ?? 'api.zip',
    clusteringCodeS3Bucket: fileValues.ARTIFACT_BUCKET ?? 'signal-artifacts',
    clusteringCodeS3Key: fileValues.CLUSTERING_CODE_KEY ?? 'clustering.zip',
    scheduleName: fileValues.SCHEDULE_NAME ?? 'signal-weekly-clustering',
  };
}
