/**
 * Dashboard aggregation (FR5.1–FR5.3).
 *
 * The dashboard needs three reads: the current themes, a per-week trend and the
 * urgent items. Filtering accepts only the FR2.2 vocabularies — an unknown filter
 * value is a 400, not a silently ignored parameter — and the values are used
 * verbatim, so the dashboard cannot drift from what classification stored.
 *
 * "All recent items" is answered by querying each category index in turn and
 * merging, because the approved single-table design has no index over *all*
 * items. Six bounded queries beat a full table Scan at this cardinality, and
 * NFR4 waives scale beyond it.
 */

import { NotFoundError, ValidationError } from '../domain/ports';
import type { FeedbackRepository } from '../domain/ports';
import {
  CATEGORIES,
  SENTIMENTS,
  URGENCIES,
  isCategory,
  isSentiment,
  isUrgency,
  type Category,
  type FeedbackItem,
  type Sentiment,
  type Theme,
  type Urgency,
  type WeeklyRun,
} from '../domain/types';

/** Validated dashboard filters; every field is an FR2.2 value or absent. */
export interface DashboardFilters {
  readonly category?: Category;
  readonly sentiment?: Sentiment;
  readonly urgency?: Urgency;
}

export interface TrendPoint {
  readonly weekStart: string;
  readonly itemCount: number;
  readonly themeCount: number;
}

export interface DashboardView {
  readonly themes: Theme[];
  readonly trends: TrendPoint[];
  readonly urgent: FeedbackItem[];
  readonly filters: DashboardFilters;
  /** Latest weekly run, so the dashboard can show its written summary (FR4.2). */
  readonly run: WeeklyRun | null;
}

export interface ThemeDrilldown {
  readonly theme: Theme;
  readonly items: FeedbackItem[];
}

/** Monday 00:00:00Z of the ISO week containing `instant`. */
export function weekStartOf(instant: Date): string {
  const start = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  const dayOfWeek = start.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start.toISOString();
}

/**
 * Validate the query string of a dashboard read.
 *
 * @throws ValidationError naming the offending parameter and the allowed values.
 */
export function parseFilters(query: Record<string, string | undefined>): DashboardFilters {
  const filters: {
    category?: Category;
    sentiment?: Sentiment;
    urgency?: Urgency;
  } = {};

  const raw = {
    category: query.category,
    sentiment: query.sentiment,
    urgency: query.urgency,
  };

  if (raw.category !== undefined && raw.category !== '') {
    if (!isCategory(raw.category)) {
      throw new ValidationError(
        `Unsupported category filter '${raw.category}'. Allowed values: ${CATEGORIES.join(', ')}.`,
        [{ field: 'category', reason: `must be one of ${CATEGORIES.join(', ')}` }],
      );
    }
    filters.category = raw.category;
  }
  if (raw.sentiment !== undefined && raw.sentiment !== '') {
    if (!isSentiment(raw.sentiment)) {
      throw new ValidationError(
        `Unsupported sentiment filter '${raw.sentiment}'. Allowed values: ${SENTIMENTS.join(', ')}.`,
        [{ field: 'sentiment', reason: `must be one of ${SENTIMENTS.join(', ')}` }],
      );
    }
    filters.sentiment = raw.sentiment;
  }
  if (raw.urgency !== undefined && raw.urgency !== '') {
    if (!isUrgency(raw.urgency)) {
      throw new ValidationError(
        `Unsupported urgency filter '${raw.urgency}'. Allowed values: ${URGENCIES.join(', ')}.`,
        [{ field: 'urgency', reason: `must be one of ${URGENCIES.join(', ')}` }],
      );
    }
    filters.urgency = raw.urgency;
  }

  return filters;
}

/** Per-week item and theme counts across the configured trend window, oldest first. */
export function buildTrends(
  items: readonly FeedbackItem[],
  themes: readonly Theme[],
  weeks: number,
  now: Date,
): TrendPoint[] {
  const countByWeek = (instants: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const instant of instants) {
      const key = weekStartOf(new Date(instant));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const itemCounts = countByWeek(items.map((item) => item.createdAt));
  const themeCounts = countByWeek(themes.map((theme) => theme.createdAt));
  const currentWeekStart = weekStartOf(now);

  const buckets: TrendPoint[] = [];
  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const start = new Date(currentWeekStart);
    start.setUTCDate(start.getUTCDate() - offset * 7);
    const weekStart = start.toISOString();
    buckets.push({
      weekStart,
      itemCount: itemCounts.get(weekStart) ?? 0,
      themeCount: themeCounts.get(weekStart) ?? 0,
    });
  }
  return buckets;
}

/** Every item inside the filter scope, newest first, merged across category indexes. */
export async function listRecentItems(
  repository: FeedbackRepository,
  filters: DashboardFilters,
  limit: number,
): Promise<FeedbackItem[]> {
  const categories = filters.category ? [filters.category] : [...CATEGORIES];
  const batches = await Promise.all(
    categories.map((category) => repository.queryByCategory(category, limit)),
  );

  const byId = new Map<string, FeedbackItem>();
  for (const batch of batches) {
    for (const item of batch) {
      byId.set(item.id, item);
    }
  }

  return [...byId.values()]
    .filter((item) => !filters.sentiment || item.classification.sentiment === filters.sentiment)
    .filter((item) => !filters.urgency || item.classification.urgency === filters.urgency)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export interface DashboardLoadOptions {
  readonly trendWeeks: number;
  readonly now: Date;
  readonly filters: DashboardFilters;
  readonly limit: number;
}

export async function loadDashboard(
  repository: FeedbackRepository,
  options: DashboardLoadOptions,
): Promise<DashboardView> {
  const runs = await repository.listRuns(Math.max(options.trendWeeks, 1));
  const themeBatches = await Promise.all(runs.map((run) => repository.listThemes(run.id)));
  const themesByRun = themeBatches.flat();
  const latestRun = runs[0];
  const currentThemes = latestRun
    ? themesByRun.filter((theme) => theme.runId === latestRun.id)
    : [];

  const items = await listRecentItems(repository, options.filters, options.limit);
  const urgentUrgency = options.filters.urgency ?? 'high';
  const urgent = items
    .filter((item) => item.classification.urgency === urgentUrgency)
    .slice(0, options.limit);

  return {
    themes: currentThemes,
    trends: buildTrends(items, themesByRun, options.trendWeeks, options.now),
    urgent,
    filters: options.filters,
    run: latestRun ?? null,
  };
}

/** Resolve one theme and the raw items behind it (FR5.2). */
export async function loadThemeDrilldown(
  repository: FeedbackRepository,
  themeId: string,
  limit: number,
): Promise<ThemeDrilldown> {
  const matches = await repository.queryByTheme(themeId, 1);
  const theme = matches[0];
  if (!theme) {
    throw new NotFoundError('Theme', themeId);
  }

  const members = await Promise.all(
    theme.memberIds.slice(0, limit).map(async (itemId) => {
      try {
        return await repository.getItemById(itemId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return null;
        }
        throw error;
      }
    }),
  );

  return {
    theme,
    items: members.filter((item): item is FeedbackItem => item !== null),
  };
}
