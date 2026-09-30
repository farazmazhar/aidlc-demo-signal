/**
 * Configuration loading for Build Signal.
 *
 * Every value is read from the environment at call time: `loadConfig` is
 * invoked once per Lambda invocation / script run and performs no module-level
 * `process.env` capture, so the same deployment can be switched between
 * providers by changing one environment file (FR6.2) — no code change.
 *
 * Failure policy: a required variable that is missing, or a numeric variable
 * that is present but not a usable number, raises `ConfigError` naming the
 * variable. No value is silently invented for a required setting (NFR5).
 */

/** Selectable model providers (FR6.1). */
export type ProviderName = 'ollama' | 'bedrock';

export const PROVIDER_NAMES: readonly ProviderName[] = ['ollama', 'bedrock'];

/** Which local form of the emulated REST API URL the host scripts build (R10). */
export type LocalApiUrlStyle = '_aws_execute_api' | 'execute_api_hostname' | '_user_request_';

export const LOCAL_API_URL_STYLES: readonly LocalApiUrlStyle[] = [
  '_aws_execute_api',
  'execute_api_hostname',
  '_user_request_',
];

/** Resolved, validated, immutable runtime configuration. */
export interface Config {
  readonly llmProvider: ProviderName;
  readonly embeddingProvider: ProviderName;
  readonly ollamaBaseUrl: string;
  readonly ollamaChatModel: string;
  readonly ollamaEmbedModel: string;
  readonly bedrockChatModel: string;
  readonly bedrockEmbedModel: string;
  readonly awsRegion: string;
  readonly awsEndpointUrl: string;
  readonly embeddingDimensions: number;
  readonly feedbackTable: string;
  readonly databaseUrl: string;
  readonly clusterSimilarityThreshold: number;
  readonly clusterMinSize: number;
  readonly clusterWindowDays: number;
  readonly dashboardTrendWeeks: number;
  readonly scheduleCron: string;
  readonly sesSender: string;
  readonly apiStageName: string;
  readonly localApiUrlStyle: LocalApiUrlStyle;
}

/** Raised when configuration is missing or unusable; always names the variable. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(message: string) {
    super(message);
  }
}

type Env = Record<string, string | undefined>;

function readOptional(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return raw.trim();
}

function readRequired(env: Env, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(
      `Missing required configuration variable ${key}. Set it in config/config.env (or the Lambda environment) — no default is invented.`,
    );
  }
  return raw.trim();
}

function readPositiveInteger(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(
      `Configuration variable ${key} must be a positive integer, received "${raw}". Fix it in config/config.env — it is not defaulted silently.`,
    );
  }
  return parsed;
}

function readUnitInterval(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new ConfigError(
      `Configuration variable ${key} must be a number greater than 0 and at most 1, received "${raw}".`,
    );
  }
  return parsed;
}

function readProvider(env: Env, key: string, fallback: ProviderName): ProviderName {
  const raw = readOptional(env, key, fallback);
  if ((PROVIDER_NAMES as readonly string[]).includes(raw)) {
    return raw as ProviderName;
  }
  throw new ConfigError(
    `Configuration variable ${key} must be one of ${PROVIDER_NAMES.join(', ')}, received "${raw}".`,
  );
}

function readUrlStyle(env: Env, key: string, fallback: LocalApiUrlStyle): LocalApiUrlStyle {
  const raw = readOptional(env, key, fallback);
  if ((LOCAL_API_URL_STYLES as readonly string[]).includes(raw)) {
    return raw as LocalApiUrlStyle;
  }
  throw new ConfigError(
    `Configuration variable ${key} must be one of ${LOCAL_API_URL_STYLES.join(', ')}, received "${raw}".`,
  );
}

/**
 * Resolve configuration from an environment object.
 *
 * @param env environment to read; defaults to `process.env`, but every caller
 *   that is testable passes an explicit object so no test touches the real
 *   developer environment.
 */
export function loadConfig(env: Env = process.env): Config {
  const config: Config = {
    llmProvider: readProvider(env, 'LLM_PROVIDER', 'ollama'),
    embeddingProvider: readProvider(env, 'EMBEDDING_PROVIDER', 'ollama'),
    ollamaBaseUrl: readOptional(env, 'OLLAMA_BASE_URL', 'http://localhost:11434'),
    ollamaChatModel: readOptional(env, 'OLLAMA_CHAT_MODEL', 'llama3.2:3b'),
    ollamaEmbedModel: readOptional(env, 'OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
    bedrockChatModel: readOptional(
      env,
      'BEDROCK_CHAT_MODEL',
      'anthropic.claude-3-haiku-20240307-v1:0',
    ),
    bedrockEmbedModel: readOptional(env, 'BEDROCK_EMBED_MODEL', 'amazon.titan-embed-text-v2:0'),
    awsRegion: readOptional(env, 'AWS_REGION', 'us-east-1'),
    awsEndpointUrl: readOptional(env, 'AWS_ENDPOINT_URL', 'http://localhost:4566'),
    embeddingDimensions: readPositiveInteger(env, 'EMBEDDING_DIMENSIONS', 768),
    feedbackTable: readOptional(env, 'FEEDBACK_TABLE', 'signal-feedback'),
    databaseUrl: readRequired(env, 'DATABASE_URL'),
    clusterSimilarityThreshold: readUnitInterval(env, 'CLUSTER_SIMILARITY_THRESHOLD', 0.82),
    clusterMinSize: readPositiveInteger(env, 'CLUSTER_MIN_SIZE', 2),
    clusterWindowDays: readPositiveInteger(env, 'CLUSTER_WINDOW_DAYS', 7),
    dashboardTrendWeeks: readPositiveInteger(env, 'DASHBOARD_TREND_WEEKS', 8),
    scheduleCron: readOptional(env, 'SCHEDULE_CRON', 'cron(0 6 ? * MON *)'),
    sesSender: readOptional(env, 'SES_SENDER', 'signal@example.com'),
    apiStageName: readOptional(env, 'API_STAGE_NAME', 'local'),
    localApiUrlStyle: readUrlStyle(env, 'LOCAL_API_URL_STYLE', '_aws_execute_api'),
  };
  return Object.freeze(config);
}
