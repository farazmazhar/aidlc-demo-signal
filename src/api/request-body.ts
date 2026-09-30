/**
 * Request-body decoding for the proxy event.
 *
 * Base64 is decoded when the platform says so, and the decoded size is bounded
 * before anything parses it: an unauthenticated ingest endpoint must not accept
 * an unbounded body (FR1.5, NFR5).
 */

import { ValidationError } from '../domain/ports';

export const MAX_BODY_BYTES = 64 * 1024;

interface BodyCarrier {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean | null;
}

export function validateRequestBody(event: BodyCarrier): string | null {
  const raw = event.body;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (event.isBase64Encoded !== true) {
    assertBodySize(raw.length);
    return raw;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    throw new ValidationError('Request body could not be base64-decoded.', [
      { field: '(body)', reason: 'must be valid base64' },
    ]);
  }
  assertBodySize(decoded.length);
  return decoded;
}

function assertBodySize(length: number): void {
  if (length > MAX_BODY_BYTES) {
    throw new ValidationError(
      `Request body is ${length} bytes; the limit is ${MAX_BODY_BYTES}.`,
      [{ field: '(body)', reason: `must be at most ${MAX_BODY_BYTES} bytes` }],
    );
  }
}
