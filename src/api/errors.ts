/**
 * HTTP error envelope and typed-error mapping.
 *
 * Every failure leaves the API in one documented shape:
 * `{ error: { code, message, details?, requestId } }`. The mapping is exhaustive
 * over the domain errors, so a new error type cannot silently become a 500:
 * unhandled errors are logged and still return the envelope.
 */

import { ConfigError, NotFoundError, ProviderError, ProviderOutputError, ValidationError } from '../domain/ports';

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId: string;
  };
}

export interface ApiResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly isBase64Encoded?: boolean;
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function jsonResult(statusCode: number, payload: unknown, requestId: string): ApiResult {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, 'x-request-id': requestId },
    body: JSON.stringify(payload),
  };
}

export function textResult(
  statusCode: number,
  contentType: string,
  body: string,
  requestId: string,
): ApiResult {
  return {
    statusCode,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-request-id': requestId,
    },
    body,
  };
}

interface MappedError {
  readonly statusCode: number;
  readonly code: string;
}

function classify(error: unknown): MappedError {
  if (error instanceof ValidationError) {
    return { statusCode: 400, code: 'VALIDATION_FAILED' };
  }
  if (error instanceof NotFoundError) {
    return { statusCode: 404, code: 'NOT_FOUND' };
  }
  if (error instanceof ProviderOutputError) {
    return { statusCode: 502, code: 'PROVIDER_OUTPUT_INVALID' };
  }
  if (error instanceof ProviderError) {
    return { statusCode: 502, code: 'PROVIDER_ERROR' };
  }
  if (error instanceof ConfigError) {
    return { statusCode: 500, code: 'CONFIG_ERROR' };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR' };
}

/** Map a thrown value onto the documented envelope. Unknown errors are logged, never swallowed. */
export function toErrorResult(error: unknown, requestId: string): ApiResult {
  const { statusCode, code } = classify(error);
  const isKnown =
    error instanceof ValidationError ||
    error instanceof NotFoundError ||
    error instanceof ProviderError ||
    error instanceof ProviderOutputError ||
    error instanceof ConfigError;

  if (!isKnown) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'unhandled API error',
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );
  }

  const details = error instanceof ValidationError ? error.details : undefined;
  const envelope: ErrorEnvelope = {
    error: {
      code,
      message: error instanceof Error ? error.message : 'Unexpected failure.',
      ...(details ? { details } : {}),
      requestId,
    },
  };
  return {
    statusCode,
    headers: { ...JSON_HEADERS, 'x-request-id': requestId },
    body: JSON.stringify(envelope),
  };
}
