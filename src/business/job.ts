/**
 * The weekly clustering job (FR4.1–FR4.3).
 *
 * EventBridge Scheduler triggers the `signal-clustering` Lambda with a scheduler
 * event; this module is the whole job body:
 *
 * 1. read the embedding window from Postgres (FR4.1),
 * 2. cluster it by cosine similarity,
 * 3. describe each theme deterministically from its members' classifications,
 * 4. ask the chat provider for the run summary (FR4.2),
 * 5. persist the themes and the run so the dashboard can read them (FR4.3).
 *
 * An empty window still records a run — the dashboard reads the latest run, and a
 * silent week must be visible as a silent week rather than as a stale panel. No
 * model call is made in that case.
 */

import type { Config } from '../config/config';
import { NotFoundError } from '../domain/ports';
import type { Clock, FeedbackRepository, VectorStore } from '../domain/ports';
import { CATEGORIES, type Category, type FeedbackItem, type Theme, type WeeklyRun } from '../domain/types';
import type { LlmProvider } from '../providers/types';
import { clusterVectors } from './clustering';
import { summariseRun } from './summarise';

export type WeeklyJobConfig = Pick<
  Config,
  'clusterSimilarityThreshold' | 'clusterMinSize' | 'clusterWindowDays'
>;

export interface WeeklyJobDependencies {
  readonly repository: FeedbackRepository;
  readonly vectors: VectorStore;
  readonly llm: LlmProvider;
  readonly clock: Clock;
  readonly config: WeeklyJobConfig;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic theme description derived from member classifications — no extra
 * model call, same input always yields the same label and summary.
 */
export function describeTheme(
  theme: Theme,
  itemsById: ReadonlyMap<string, FeedbackItem>,
): Theme {
  const members = theme.memberIds
    .map((itemId) => itemsById.get(itemId))
    .filter((item): item is FeedbackItem => item !== undefined);

  const countByCategory = new Map<Category, number>();
  for (const member of members) {
    const category = member.classification.category;
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
  }

  let topCategory: Category = 'other';
  let topCount = -1;
  for (const category of CATEGORIES) {
    const count = countByCategory.get(category) ?? 0;
    if (count > topCount) {
      topCategory = category;
      topCount = count;
    }
  }

  const urgentCount = members.filter((member) => member.classification.urgency === 'high').length;
  const summary = [
    `${members.length} item${members.length === 1 ? '' : 's'}`,
    `mostly ${topCategory}`,
    urgentCount > 0 ? `${urgentCount} high urgency` : 'no high-urgency items',
  ].join(', ');

  return { ...theme, label: `${theme.label}: ${topCategory}`, summary };
}

export async function runWeeklyClustering(dependencies: WeeklyJobDependencies): Promise<WeeklyRun> {
  const { repository, vectors, llm, clock, config } = dependencies;
  const now = clock.now();
  const windowStart = new Date(now.getTime() - config.clusterWindowDays * DAY_IN_MS);
  const runId = `run-${now.toISOString().replace(/[:.]/g, '-')}`;

  const records = await vectors.listWindow(windowStart);
  const itemsById = new Map<string, FeedbackItem>();
  for (const record of records) {
    try {
      itemsById.set(record.itemId, await repository.getItemById(record.itemId));
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      // A vector without its item is a torn write from an interrupted ingest;
      // it is skipped rather than failing the whole run.
    }
  }
  const items = [...itemsById.values()];

  const clustered = clusterVectors(
    records
      .filter((record) => itemsById.has(record.itemId))
      .map((record) => ({ itemId: record.itemId, vector: record.vector })),
    {
      runId,
      threshold: config.clusterSimilarityThreshold,
      minSize: config.clusterMinSize,
      createdAt: now.toISOString(),
    },
  );
  const themes = clustered.map((theme) => describeTheme(theme, itemsById));

  const summary =
    items.length === 0
      ? `No feedback arrived in the last ${config.clusterWindowDays} day window (starting ${windowStart.toISOString()}); nothing needed attention.`
      : await summariseRun(llm, {
          runId,
          themes,
          items,
          windowStart: windowStart.toISOString(),
        });

  for (const theme of themes) {
    await repository.putTheme(theme);
  }

  const run: WeeklyRun = {
    id: runId,
    ranAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    itemCount: items.length,
    themeCount: themes.length,
    summary,
  };
  await repository.putRun(run);
  return run;
}
