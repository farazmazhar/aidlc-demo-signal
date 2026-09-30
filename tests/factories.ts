/**
 * Shared test factories.
 *
 * Every builder takes an overrides object so a test states only what it cares
 * about. Nothing here holds mutable module state: each call returns a fresh
 * value, so test order can never matter. Randomness is a seeded generator, and
 * time always comes from a `fixedClock` — no test reads the wall clock or
 * `Math.random()` (FR1.3 determinism).
 */

import {
  CATEGORIES,
  SENTIMENTS,
  URGENCIES,
  schemaVersion,
  type Classification,
  type FeedbackInput,
  type FeedbackItem,
  type Theme,
  type VectorRecord,
  type WeeklyRun,
} from '../src/domain/types';

/** Structural twin of the `Clock` port, so factories stay independent of it. */
export interface TestClock {
  now(): Date;
}

/** A clock frozen at one instant; the returned object is safe to share. */
export function fixedClock(instant: string): TestClock {
  const frozen = new Date(instant);
  return {
    now() {
      return new Date(frozen.getTime());
    },
  };
}

export const TEST_NOW = '2026-09-28T12:00:00.000Z';

/** Deterministic 32-bit PRNG (mulberry32) — same seed, same sequence, everywhere. */
export function deterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic unit-length vector; `seed` makes it reproducible across runs. */
export function makeVector(dimensions = 768, seed = 1): number[] {
  const rng = deterministicRng(seed);
  const raw = Array.from({ length: dimensions }, () => rng() * 2 - 1);
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
  return raw.map((value) => value / norm);
}

/** A nearby vector: the planted centroid plus `spread`-scaled deterministic noise. */
export function makeNeighbourVector(centroid: number[], spread: number, seed: number): number[] {
  const rng = deterministicRng(seed);
  const raw = centroid.map((value) => value + (rng() * 2 - 1) * spread);
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
  return raw.map((value) => value / norm);
}

export function makeFeedbackInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    source: 'api',
    text: 'Checkout fails when the coupon field is left empty',
    ...overrides,
  };
}

export function makeClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    category: CATEGORIES[0],
    sentiment: 'negative',
    urgency: URGENCIES[0],
    ...overrides,
  };
}

export function makeFeedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'item-1',
    source: 'api',
    text: 'Checkout fails when the coupon field is left empty',
    createdAt: TEST_NOW,
    classification: makeClassification(),
    schemaVersion,
    ...overrides,
  };
}

export function makeVectorRecord(overrides: Partial<VectorRecord> = {}): VectorRecord {
  return {
    itemId: 'item-1',
    vector: makeVector(8, 1),
    meta: { source: 'api' },
    createdAt: TEST_NOW,
    ...overrides,
  };
}

export function makeTheme(overrides: Partial<Theme> = {}): Theme {
  return {
    id: 'theme-1',
    runId: 'run-1',
    label: 'Theme 1',
    summary: 'Checkout coupon handling regressed this week.',
    memberIds: ['item-1'],
    createdAt: TEST_NOW,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<WeeklyRun> = {}): WeeklyRun {
  return {
    id: 'run-1',
    ranAt: TEST_NOW,
    windowStart: '2026-09-21T12:00:00.000Z',
    itemCount: 1,
    themeCount: 1,
    summary: 'One theme: checkout coupon handling.',
    ...overrides,
  };
}

/** The minimum surface `plantCluster` needs from a vector store. */
export interface VectorPlanter {
  upsert(itemId: string, vector: number[], meta?: Record<string, unknown>): Promise<void>;
}

export interface PlantClusterOptions {
  /** How many planted items to write. */
  count: number;
  /** Cosine-similarity spread around the planted centroid; small means one theme. */
  spread?: number;
  /** Seed for the deterministic generator. */
  seed?: number;
  /** Vector width; must match the store's schema. */
  dimensions?: number;
  /** Item id prefix, so several clusters can coexist in one store. */
  prefix?: string;
}

/**
 * Plant a deterministic group of near-identical embeddings, simulating a
 * recurring theme. Returns the planted item ids in order.
 */
export async function plantCluster(
  store: VectorPlanter,
  options: PlantClusterOptions,
): Promise<string[]> {
  const { count, spread = 0.02, seed = 7, dimensions = 768, prefix = 'item' } = options;
  const centroid = makeVector(dimensions, seed);
  const itemIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const itemId = `${prefix}-${index + 1}`;
    const vector =
      index === 0 ? centroid : makeNeighbourVector(centroid, spread, seed + index + 1);
    await store.upsert(itemId, vector, { prefix });
    itemIds.push(itemId);
  }
  return itemIds;
}

/** Environment for `loadConfig` in tests: complete, credential-free, emulator-only. */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {
    LLM_PROVIDER: 'ollama',
    EMBEDDING_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_CHAT_MODEL: 'llama3.2:3b',
    OLLAMA_EMBED_MODEL: 'nomic-embed-text',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://localhost:4566',
    EMBEDDING_DIMENSIONS: '768',
    FEEDBACK_TABLE: 'signal-feedback',
    DATABASE_URL: 'postgres://signal:signal@localhost:5432/signal',
    CLUSTER_SIMILARITY_THRESHOLD: '0.82',
    CLUSTER_MIN_SIZE: '2',
    CLUSTER_WINDOW_DAYS: '7',
    DASHBOARD_TREND_WEEKS: '8',
    SCHEDULE_CRON: 'cron(0 6 ? * MON *)',
    SES_SENDER: 'signal@example.com',
    API_STAGE_NAME: 'local',
    LOCAL_API_URL_STYLE: '_aws_execute_api',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

export const ALL_CATEGORIES = CATEGORIES;
export const ALL_SENTIMENTS = SENTIMENTS;
export const ALL_URGENCIES = URGENCIES;
