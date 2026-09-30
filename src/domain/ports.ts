/**
 * Ports and domain errors.
 *
 * Every external boundary — DynamoDB, Postgres/pgvector, the model providers and
 * the clock — sits behind one of these interfaces. Adapters implement them;
 * unit tests inject in-memory fakes; nothing else in the codebase constructs a
 * client, reads an environment variable or calls `Date.now()` directly.
 */

import type {
  Category,
  FeedbackItem,
  Theme,
  Urgency,
  VectorRecord,
  WeeklyRun,
} from './types';

export { ConfigError } from '../config/config';

/** An entity the caller named does not exist; distinct from a transport failure. */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';

  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} '${id}' was not found.`);
  }
}

/** Input that crossed a trust boundary and failed validation (FR1.1). */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The provider could not be reached or answered with a transport-level failure. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`Provider '${provider}' failed: ${message}`);
  }
}

/** The provider answered, but not with a value this system is allowed to store. */
export class ProviderOutputError extends Error {
  override readonly name = 'ProviderOutputError';

  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`Provider '${provider}' returned an unusable answer: ${message}`);
  }
}

export interface Clock {
  now(): Date;
}

/** The real clock; the only place in the codebase that reads wall time. */
export function systemClock(): Clock {
  return {
    now: () => new Date(),
  };
}

/**
 * Item, theme and run persistence (FR1.4, FR4.3, FR5.2, FR5.3).
 *
 * `getItemById` throws `NotFoundError` for an unknown id — never `undefined`,
 * so a caller cannot accidentally persist a hole.
 */
export interface FeedbackRepository {
  putItem(item: FeedbackItem): Promise<void>;
  getItemById(id: string): Promise<FeedbackItem>;
  /** Newest first. `urgency` defaults to `high`, the dashboard's urgent panel. */
  queryUrgent(limit: number, urgency?: Urgency): Promise<FeedbackItem[]>;
  queryByCategory(category: Category, limit: number): Promise<FeedbackItem[]>;
  queryByTheme(themeId: string, limit: number): Promise<Theme[]>;
  putTheme(theme: Theme): Promise<void>;
  putRun(run: WeeklyRun): Promise<void>;
  listRuns(limit: number): Promise<WeeklyRun[]>;
  listThemes(runId: string): Promise<Theme[]>;
}

/** Embedding storage and similarity lookup (FR3.2, FR4.1). */
export interface VectorStore {
  /** Idempotent: a second upsert for the same item replaces the vector in place. */
  upsert(itemId: string, vector: number[], meta?: Record<string, unknown>): Promise<void>;
  listWindow(since: Date, limit?: number): Promise<VectorRecord[]>;
  querySimilar(vector: number[], limit: number): Promise<VectorRecord[]>;
}
