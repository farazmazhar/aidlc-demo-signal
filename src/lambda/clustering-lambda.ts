/**
 * `signal-clustering` Lambda entrypoint (FR4.1).
 *
 * EventBridge Scheduler invokes it weekly with a scheduler event; the payload is
 * not inspected, so the same entrypoint also serves the smoke test's direct
 * `Invoke` — which matters because the emulator's scheduler is mocked and never
 * triggers a target (risk R2).
 */

import { runWeeklyClustering } from '../business/job';
import type { WeeklyRun } from '../domain/types';
import { loadConfig } from '../config/config';
import { buildRepository, buildProviders, buildVectorStore } from './dependencies';

export interface SchedulerEvent {
  readonly source?: string;
  readonly 'detail-type'?: string;
  readonly [key: string]: unknown;
}

export async function handler(event: SchedulerEvent): Promise<WeeklyRun> {
  const config = loadConfig(process.env);
  const { llm } = buildProviders(config);

  const run = await runWeeklyClustering({
    repository: buildRepository(config),
    vectors: buildVectorStore(config),
    llm,
    clock: { now: () => new Date() },
    config,
  });

  console.log(
    JSON.stringify({
      level: 'INFO',
      message: 'weekly clustering run complete',
      runId: run.id,
      itemCount: run.itemCount,
      themeCount: run.themeCount,
      trigger: typeof event['detail-type'] === 'string' ? event['detail-type'] : 'direct-invoke',
    }),
  );

  return run;
}

export default handler;
