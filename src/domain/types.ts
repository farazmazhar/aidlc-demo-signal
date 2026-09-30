/**
 * Domain types for Build Signal.
 *
 * The three classification value sets are the fixed vocabularies from FR2.2.
 * They are stored as strings and reused verbatim as dashboard filter values
 * (FR2.3 / FR5.3), so nothing in the system may widen them.
 */

/** FR2.2 — category vocabulary. */
export const CATEGORIES = [
  'bug',
  'feature request',
  'usability',
  'performance',
  'pricing',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** FR2.2 — sentiment vocabulary. */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** FR2.2 — urgency vocabulary. */
export const URGENCIES = ['low', 'medium', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** FR1.1 — accepted ingestion entry points. */
export const SOURCES = ['api', 'web'] as const;
export type FeedbackSource = (typeof SOURCES)[number];

/** Stored on every DynamoDB item so a future reader can migrate it. */
export const schemaVersion = 1;

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function isSentiment(value: string): value is Sentiment {
  return (SENTIMENTS as readonly string[]).includes(value);
}

export function isUrgency(value: string): value is Urgency {
  return (URGENCIES as readonly string[]).includes(value);
}

/** Validated ingestion payload (FR1.1, FR1.2). */
export interface FeedbackInput {
  source: FeedbackSource;
  text: string;
  submitter_email?: string;
  product_area?: string;
}

/** Model-produced classification, restricted to the FR2.2 vocabularies. */
export interface Classification {
  category: Category;
  sentiment: Sentiment;
  urgency: Urgency;
}

/** Persisted feedback item; `createdAt` is the server-side timestamp (FR1.3). */
export interface FeedbackItem {
  id: string;
  source: FeedbackSource;
  text: string;
  submitter_email?: string;
  product_area?: string;
  createdAt: string;
  classification: Classification;
  schemaVersion: number;
}

/** A persisted weekly theme with its drill-down membership (FR4.3, FR5.2). */
export interface Theme {
  id: string;
  runId: string;
  label: string;
  summary: string;
  memberIds: string[];
  createdAt: string;
}

/** One weekly clustering run record (FR4.1–FR4.3). */
export interface WeeklyRun {
  id: string;
  ranAt: string;
  windowStart: string;
  itemCount: number;
  themeCount: number;
  summary: string;
}

/** A stored embedding and the item it belongs to (FR3.2). */
export interface VectorRecord {
  itemId: string;
  vector: number[];
  meta: Record<string, unknown>;
  createdAt: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
