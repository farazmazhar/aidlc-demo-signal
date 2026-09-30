/**
 * Ingestion payload validation (FR1.1).
 *
 * This is the spike's only untrusted boundary that carries a schema: the
 * dashboard and API clients both post the same shape, and the payload must be
 * rejected before anything reaches the model or the stores. Unknown fields are
 * rejected rather than ignored, so a client that sends `urgency` or a
 * client-supplied timestamp cannot silently believe it was honoured (those are
 * explicitly out of scope).
 */

import { z } from 'zod';

import { ValidationError } from './ports';
import type { FeedbackInput } from './types';

export const MAX_FEEDBACK_TEXT_LENGTH = 4000;
export const MAX_PRODUCT_AREA_LENGTH = 100;

export const feedbackInputSchema = z
  .object({
    source: z.enum(['api', 'web']),
    text: z
      .string({ required_error: 'text is required' })
      .trim()
      .min(1, 'text must not be blank')
      .max(
        MAX_FEEDBACK_TEXT_LENGTH,
        `text must be at most ${MAX_FEEDBACK_TEXT_LENGTH} characters`,
      ),
    submitter_email: z.string().trim().email('submitter_email must be a valid email address').optional(),
    product_area: z
      .string()
      .trim()
      .min(1, 'product_area must not be blank')
      .max(MAX_PRODUCT_AREA_LENGTH, `product_area must be at most ${MAX_PRODUCT_AREA_LENGTH} characters`)
      .optional(),
  })
  .strict();

export interface FieldIssue {
  readonly field: string;
  readonly reason: string;
}

/**
 * Parse a raw payload into a `FeedbackInput`, or throw `ValidationError` whose
 * details list the offending fields (the API maps those to the error envelope).
 */
export function parseFeedbackInput(payload: unknown): FeedbackInput {
  const result = feedbackInputSchema.safeParse(payload);
  if (result.success) {
    return result.data;
  }
  const issues: FieldIssue[] = result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
    reason: issue.message,
  }));
  return fail(issues);
}

function fail(issues: readonly FieldIssue[]): never {
  const summary = issues.map((issue) => `${issue.field}: ${issue.reason}`).join('; ');
  throw new ValidationError(`Invalid feedback payload — ${summary}`, issues);
}
