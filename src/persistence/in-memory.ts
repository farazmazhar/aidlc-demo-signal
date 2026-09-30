/**
 * In-memory implementations of both persistence ports.
 *
 * They exist for two reasons: unit tests must run with no Docker, no Postgres,
 * no emulator and no credentials (Minimal strategy prerequisites), and the
 * semantics they enforce are the ones the real adapters must match — typed
 * not-found, descending `createdAt` for the GSI-style queries, idempotent vector
 * upsert and per-run theme membership. Where a fake and a real adapter disagree,
 * the fake is the bug.
 */

import { NotFoundError, ValidationError } from '../domain/ports';
import type { FeedbackRepository, VectorStore } from '../domain/ports';
import type { Category, FeedbackItem, Theme, Urgency, VectorRecord, WeeklyRun } from '../domain/types';
import { cosineSimilarity } from '../domain/vector-math';

function byCreatedAtDescending(left: { createdAt: string }, right: { createdAt: string }): number {
  return right.createdAt.localeCompare(left.createdAt);
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly items = new Map<string, FeedbackItem>();
  private readonly themes = new Map<string, Theme>();
  private readonly runs = new Map<string, WeeklyRun>();

  async putItem(item: FeedbackItem): Promise<void> {
    this.items.set(item.id, structuredClone(item));
  }

  async getItemById(id: string): Promise<FeedbackItem> {
    const item = this.items.get(id);
    if (!item) {
      throw new NotFoundError('FeedbackItem', id);
    }
    return structuredClone(item);
  }

  async queryUrgent(limit: number, urgency: Urgency = 'high'): Promise<FeedbackItem[]> {
    return this.sortedItems((item) => item.classification.urgency === urgency).slice(0, limit);
  }

  async queryByCategory(category: Category, limit: number): Promise<FeedbackItem[]> {
    return this.sortedItems((item) => item.classification.category === category).slice(0, limit);
  }

  async queryByTheme(themeId: string, limit: number): Promise<Theme[]> {
    return [...this.themes.values()]
      .filter((theme) => theme.id === themeId)
      .sort(byCreatedAtDescending)
      .slice(0, limit)
      .map((theme) => structuredClone(theme));
  }

  async putTheme(theme: Theme): Promise<void> {
    this.themes.set(`${theme.runId}#${theme.id}`, structuredClone(theme));
  }

  async putRun(run: WeeklyRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async listRuns(limit: number): Promise<WeeklyRun[]> {
    return [...this.runs.values()]
      .sort((left, right) => right.ranAt.localeCompare(left.ranAt))
      .slice(0, limit)
      .map((run) => structuredClone(run));
  }

  async listThemes(runId: string): Promise<Theme[]> {
    return [...this.themes.values()]
      .filter((theme) => theme.runId === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((theme) => structuredClone(theme));
  }

  /** Test convenience: total stored items, without exposing the map. */
  size(): number {
    return this.items.size;
  }

  private sortedItems(predicate: (item: FeedbackItem) => boolean): FeedbackItem[] {
    return [...this.items.values()]
      .filter(predicate)
      .sort(byCreatedAtDescending)
      .map((item) => structuredClone(item));
  }
}

export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(itemId: string, vector: number[], meta: Record<string, unknown> = {}): Promise<void> {
    const existing = this.records.get(itemId);
    this.records.set(itemId, {
      itemId,
      vector: [...vector],
      meta: { ...meta },
      createdAt: existing?.createdAt ?? new Date(0).toISOString(),
    });
  }

  /** Test seam: plant a record with an explicit creation time for window queries. */
  seed(record: VectorRecord): void {
    this.records.set(record.itemId, structuredClone(record));
  }

  async listWindow(since: Date, limit = 2000): Promise<VectorRecord[]> {
    return [...this.records.values()]
      .filter((record) => new Date(record.createdAt).getTime() >= since.getTime())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async querySimilar(vector: number[], limit: number): Promise<VectorRecord[]> {
    if (vector.length === 0) {
      throw new ValidationError('Cannot query by similarity with an empty vector.');
    }
    return [...this.records.values()]
      .map((record) => ({ record, score: cosineSimilarity(record.vector, vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => structuredClone(entry.record));
  }

  size(): number {
    return this.records.size;
  }
}
