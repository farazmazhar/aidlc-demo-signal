/**
 * Classification enrichment (FR2.1–FR2.3, FR3.1, FR1.3).
 *
 * One model answer decides the three FR2.2 values, and only values that are
 * *exactly* in those vocabularies (after case/whitespace normalisation) may be
 * stored — a free-form category never reaches the item. If the first answer is
 * unusable the model gets exactly one repair attempt that shows it the rejected
 * answer and the allowed values; after that the call fails with
 * `ProviderOutputError` rather than persisting a guess.
 *
 * The server-side timestamp also comes from here, from the injected `Clock`, so
 * every accepted item is timestamped by the server and tests can freeze it.
 */

import { ProviderOutputError } from '../domain/ports';
import type { Clock } from '../domain/ports';
import {
  CATEGORIES,
  SENTIMENTS,
  URGENCIES,
  isCategory,
  isSentiment,
  isUrgency,
  type Classification,
} from '../domain/types';
import type { EmbeddingProvider, LlmProvider } from '../providers/types';

export interface EnrichmentProviders {
  readonly llm: LlmProvider;
  readonly embedder: EmbeddingProvider;
  readonly clock: Clock;
}

export interface EnrichmentResult {
  readonly classification: Classification;
  readonly vector: number[];
  /** Server-side timestamp (FR1.3), assigned once and reused as `createdAt`. */
  readonly classifiedAt: string;
}

/** Read one property from a value the compiler only knows as `unknown`. */
function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null || !(key in source)) {
    return undefined;
  }
  // Proven to be an object and to carry the key, so a string-keyed read is safe.
  const record: Record<string, unknown> = source as Record<string, unknown>;
  return record[key];
}

function normalise(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Strip a markdown code fence if the model wrapped its JSON. */
function stripFence(answer: string): string {
  const trimmed = answer.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function buildClassificationPrompt(text: string): string {
  return [
    'You classify customer feedback for an internal product team.',
    'Answer with a single JSON object and nothing else — no prose, no markdown.',
    'The object must have exactly these three string fields:',
    `"category": one of ${CATEGORIES.map((value) => JSON.stringify(value)).join(', ')}`,
    `"sentiment": one of ${SENTIMENTS.map((value) => JSON.stringify(value)).join(', ')}`,
    `"urgency": one of ${URGENCIES.map((value) => JSON.stringify(value)).join(', ')}`,
    'Use the values exactly as written; never invent a new label.',
    'Feedback:',
    text,
  ].join('\n');
}

export function buildRepairPrompt(text: string, rejectedAnswer: string, reason: string): string {
  return [
    buildClassificationPrompt(text),
    'Your previous answer was rejected.',
    `Previous answer: ${rejectedAnswer.slice(0, 400)}`,
    `Problem: ${reason}`,
    'Reply with the corrected JSON object only.',
  ].join('\n');
}

/**
 * Parse and validate one model answer. The thrown error names the offending
 * field so a repair prompt can quote it; the caller converts it into a
 * `ProviderOutputError` when no further attempt is allowed.
 */
export function parseClassificationAnswer(answer: string): Classification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(answer));
  } catch {
    throw new ProviderOutputError('llm', `answer was not JSON: ${answer.slice(0, 160)}`);
  }

  const rawCategory = normalise(readProperty(parsed, 'category'));
  const rawSentiment = normalise(readProperty(parsed, 'sentiment'));
  const rawUrgency = normalise(readProperty(parsed, 'urgency'));

  const invalid: string[] = [];
  if (rawCategory === null || !isCategory(rawCategory)) {
    invalid.push(`"category" must be one of ${CATEGORIES.join(', ')} (received ${JSON.stringify(rawCategory)})`);
  }
  if (rawSentiment === null || !isSentiment(rawSentiment)) {
    invalid.push(`"sentiment" must be one of ${SENTIMENTS.join(', ')} (received ${JSON.stringify(rawSentiment)})`);
  }
  if (rawUrgency === null || !isUrgency(rawUrgency)) {
    invalid.push(`"urgency" must be one of ${URGENCIES.join(', ')} (received ${JSON.stringify(rawUrgency)})`);
  }
  if (invalid.length > 0) {
    throw new ProviderOutputError('llm', `invalid classification: ${invalid.join('; ')}`);
  }
  // The guards above proved membership; re-assert so the values narrow to the
  // FR2.2 unions and no free-form string can reach a caller.
  if (
    rawCategory === null ||
    rawSentiment === null ||
    rawUrgency === null ||
    !isCategory(rawCategory) ||
    !isSentiment(rawSentiment) ||
    !isUrgency(rawUrgency)
  ) {
    throw new ProviderOutputError('llm', 'classification values were not in the FR2.2 vocabularies');
  }

  return { category: rawCategory, sentiment: rawSentiment, urgency: rawUrgency };
}

/**
 * Classify and embed one feedback text.
 *
 * @throws ProviderError when a provider cannot be reached (transport level).
 * @throws ProviderOutputError when neither the answer nor its repair is usable,
 *   or the embedder returns a vector of the wrong width.
 */
export async function enrichFeedback(
  providers: EnrichmentProviders,
  text: string,
): Promise<EnrichmentResult> {
  const classification = await classifyWithRepair(providers.llm, text);

  const vector = await providers.embedder.embed(text);
  if (vector.length !== providers.embedder.dimensions) {
    throw new ProviderOutputError(
      providers.embedder.name,
      `expected ${providers.embedder.dimensions} dimensions but received ${vector.length}; check EMBEDDING_DIMENSIONS against the embedding model`,
    );
  }

  return {
    classification,
    vector,
    classifiedAt: providers.clock.now().toISOString(),
  };
}

async function classifyWithRepair(llm: LlmProvider, text: string): Promise<Classification> {
  const firstAnswer = await llm.complete(buildClassificationPrompt(text), {
    json: true,
    temperature: 0,
  });
  try {
    return parseClassificationAnswer(firstAnswer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const repaired = await llm.complete(buildRepairPrompt(text, firstAnswer, reason), {
      json: true,
      temperature: 0,
    });
    try {
      return parseClassificationAnswer(repaired);
    } catch (repairError) {
      const detail = repairError instanceof Error ? repairError.message : String(repairError);
      throw new ProviderOutputError(
        llm.name,
        `classification failed after one repair attempt — first: ${reason}; repaired: ${detail}`,
      );
    }
  }
}
