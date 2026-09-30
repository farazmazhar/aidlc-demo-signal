/**
 * API Gateway (REST, proxy integration) adapter.
 *
 * The handler is pure with respect to its dependencies: ports are injected, so a
 * unit test drives the whole request path with fakes and never touches a network.
 * The Lambda entrypoints are the only place that builds the real adapters.
 */

import { validateRequestBody } from './request-body';
import type { ApiDependencies, ApiRequest } from './routes';
import { dispatch } from './routes';
import type { ApiResult } from './errors';

/** The subset of a REST-API proxy event this handler reads. */
export interface ProxyEvent {
  readonly httpMethod?: string | null;
  readonly path?: string | null;
  readonly queryStringParameters?: Record<string, string | null> | null;
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean | null;
  readonly headers?: Record<string, string | null> | null;
  readonly requestContext?: {
    readonly requestId?: string | null;
    readonly stage?: string | null;
  } | null;
}

export type ApiHandler = (event: ProxyEvent, context?: unknown) => Promise<ApiResult>;

/**
 * Strip the API Gateway stage prefix.
 *
 * A REST API passes the stage in `event.path` (for example `/local/feedback`),
 * while the route table is written without it. `requestContext.stage` is the
 * source of truth; the fallback covers an event shape that omits it.
 */
export function stripStage(path: string, stage: string | null | undefined): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  if (!stage) {
    return normalised;
  }
  const prefix = `/${stage}`;
  if (normalised === prefix) {
    return '/';
  }
  return normalised.startsWith(`${prefix}/`) ? normalised.slice(prefix.length) : normalised;
}

function decodeQuery(
  query: Record<string, string | null> | null | undefined,
): Record<string, string | undefined> {
  const decoded: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    decoded[key] = value === null ? undefined : value;
  }
  return decoded;
}

export function createHandler(dependencies: ApiDependencies): ApiHandler {
  return async (event) => {
    const path = stripStage(event.path ?? '/', event.requestContext?.stage ?? null);
    const request: ApiRequest = {
      method: event.httpMethod ?? 'GET',
      path,
      query: decodeQuery(event.queryStringParameters),
      body: validateRequestBody(event),
      requestId: event.requestContext?.requestId ?? crypto.randomUUID(),
    };
    return dispatch(request, dependencies);
  };
}

export type { ApiResult, ApiDependencies };
