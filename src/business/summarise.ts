/**
 * Weekly run summary (FR4.2).
 *
 * One chat call produces the short "what changed / what needs attention" text
 * that is stored on the run record and shown at the top of the dashboard. The
 * answer is prose, not JSON, so it is only trimmed and length-bounded — an empty
 * answer is an error rather than a blank panel.
 */

import { ProviderOutputError } from '../domain/ports';
import type { FeedbackItem, Theme } from '../domain/types';
import type { LlmProvider } from '../providers/types';

export const MAX_SUMMARY_LENGTH = 2000;

export interface SummaryInput {
  readonly runId: string;
  readonly themes: readonly Theme[];
  readonly items: readonly FeedbackItem[];
  readonly windowStart: string;
}

export function buildSummaryPrompt(input: SummaryInput): string {
  const urgencyCounts = input.items.reduce<Record<string, number>>((counts, item) => {
    const key = item.classification.urgency;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const themeLines = input.themes.map(
    (theme) => `- ${theme.label} (${theme.memberIds.length} items): ${theme.summary}`,
  );

  return [
    'You write the weekly feedback digest for an internal product team.',
    'Write 2-4 short sentences covering what changed since the last run and what needs attention.',
    'Plain prose only: no markdown, no headings, no bullet characters.',
    `Window start: ${input.windowStart}`,
    `Items in the window: ${input.items.length}`,
    `Urgency counts: ${JSON.stringify(urgencyCounts)}`,
    'Themes:',
    themeLines.length > 0 ? themeLines.join('\n') : '- none reached the minimum size',
  ].join('\n');
}

export async function summariseRun(llm: LlmProvider, input: SummaryInput): Promise<string> {
  const answer = await llm.complete(buildSummaryPrompt(input), { temperature: 0.2 });
  const summary = answer.trim();
  if (summary === '') {
    throw new ProviderOutputError(llm.name, 'summary answer was empty');
  }
  return summary.length > MAX_SUMMARY_LENGTH ? summary.slice(0, MAX_SUMMARY_LENGTH) : summary;
}
