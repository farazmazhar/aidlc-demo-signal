/**
 * Route table for the API (FR1.5, FR5.1–FR5.3).
 *
 * There is deliberately **no authentication** anywhere in this table: ingestion
 * and the dashboard are unauthenticated for the spike, and the absence is a
 * requirement rather than an oversight.
 *
 * Path matching is a small ordered table of `:param` patterns — one API, one
 * Lambda, so a router dependency would add surface without capability.
 */

import { NotFoundError, ValidationError } from '../domain/ports';
import type { Clock, FeedbackRepository, VectorStore } from '../domain/ports';
import { schemaVersion, type FeedbackItem } from '../domain/types';
import type { EmbeddingProvider, LlmProvider } from '../providers/types';
import { loadDashboard, loadThemeDrilldown, parseFilters } from '../business/dashboard';
import { enrichFeedback } from '../business/enrichment';
import { jsonResult, textResult, toErrorResult } from './errors';
import type { ApiResult } from './errors';
import { contentTypeFor } from './static-assets';
import type { StaticAssets } from './static-assets';
import { parseFeedbackInput } from '../domain/validation';

export interface ApiConfig {
  readonly apiStageName: string;
  readonly dashboardTrendWeeks: number;
}

export interface ApiDependencies {
  readonly repository: FeedbackRepository;
  readonly vectors: VectorStore;
  readonly llm: LlmProvider;
  readonly embedder: EmbeddingProvider;
  readonly clock: Clock;
  readonly config: ApiConfig;
  readonly staticAssets: StaticAssets;
  /** Item id generator; injectable so request tests are deterministic. */
  readonly newId?: () => string;
}

export interface ApiRequest {
  readonly method: string;
  /** Path with the API Gateway stage prefix already removed. */
  readonly path: string;
  readonly query: Record<string, string | undefined>;
  readonly body: string | null;
  readonly requestId: string;
}

export const DEFAULT_ITEM_LIMIT = 50;
export const MAX_ITEM_LIMIT = 200;

function parseLimit(query: Record<string, string | undefined>): number {
  const raw = query.limit;
  if (raw === undefined || raw === '') {
    return DEFAULT_ITEM_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`Unsupported limit '${raw}'. Use a positive integer.`, [
      { field: 'limit', reason: 'must be a positive integer' },
    ]);
  }
  return Math.min(parsed, MAX_ITEM_LIMIT);
}

/** Match `/feedback/:id` style patterns; returns decoded params or null. */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter((part) => part.length > 0);
  const pathParts = path.split('/').filter((part) => part.length > 0);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index] ?? '';
    const pathPart = pathParts[index] ?? '';
    if (patternPart.startsWith(':')) {
      if (pathPart === '') {
        return null;
      }
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

interface Route {
  readonly method: 'GET' | 'POST';
  readonly pattern: string;
  readonly handle: (
    request: ApiRequest,
    params: Record<string, string>,
    dependencies: ApiDependencies,
  ) => Promise<ApiResult>;
}

async function ingestHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  if (request.body === null || request.body.trim() === '') {
    throw new ValidationError('Request body is required.', [{ field: '(body)', reason: 'must be JSON' }]);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    throw new ValidationError('Request body is not valid JSON.', [
      { field: '(body)', reason: 'must be valid JSON' },
    ]);
  }

  const input = parseFeedbackInput(payload);
  const { classification, vector, classifiedAt } = await enrichFeedback(
    { llm: dependencies.llm, embedder: dependencies.embedder, clock: dependencies.clock },
    input.text,
  );

  const item: FeedbackItem = {
    id: dependencies.newId ? dependencies.newId() : `item-${crypto.randomUUID()}`,
    ...input,
    createdAt: classifiedAt,
    classification,
    schemaVersion,
  };

  // Item first, then its vector: a rebroadcast of the same item is idempotent,
  // and the clustering job tolerates a vector whose item is not yet visible.
  await dependencies.repository.putItem(item);
  await dependencies.vectors.upsert(item.id, vector, { source: item.source });

  return jsonResult(201, item, request.requestId);
}

async function getItemHandler(
  request: ApiRequest,
  params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const item = await dependencies.repository.getItemById(params.id ?? '');
  return jsonResult(200, item, request.requestId);
}

async function dashboardThemesHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const view = await loadView(request, dependencies);
  return jsonResult(200, { themes: view.themes, run: view.run, filters: view.filters }, request.requestId);
}

async function dashboardTrendsHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const view = await loadView(request, dependencies);
  return jsonResult(200, { trends: view.trends, run: view.run, filters: view.filters }, request.requestId);
}

async function dashboardUrgentHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const view = await loadView(request, dependencies);
  return jsonResult(200, { urgent: view.urgent, run: view.run, filters: view.filters }, request.requestId);
}

/**
 * All three dashboard reads share one aggregation call: the filters and the
 * trend window must mean the same thing on every panel, and one code path is one
 * place for a bug to hide.
 */
function loadView(request: ApiRequest, dependencies: ApiDependencies) {
  const filters = parseFilters(request.query);
  return loadDashboard(dependencies.repository, {
    trendWeeks: dependencies.config.dashboardTrendWeeks,
    now: dependencies.clock.now(),
    filters,
    limit: parseLimit(request.query),
  });
}

async function themeItemsHandler(
  request: ApiRequest,
  params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const drilldown = await loadThemeDrilldown(
    dependencies.repository,
    params.id ?? '',
    parseLimit(request.query),
  );
  return jsonResult(200, drilldown, request.requestId);
}

async function healthHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  _dependencies: ApiDependencies,
): Promise<ApiResult> {
  return jsonResult(200, { status: 'ok', stage: 'local' }, request.requestId);
}

async function staticHandler(
  request: ApiRequest,
  _params: Record<string, string>,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  const name = request.path === '/' || request.path === '' ? 'index.html' : request.path.slice(1);
  const contentType = contentTypeFor(name);
  const content = contentType === null ? null : await dependencies.staticAssets.get(name);
  if (content === null || contentType === null) {
    throw new NotFoundError('StaticAsset', name);
  }
  return textResult(200, contentType, content, request.requestId);
}

export const ROUTES: readonly Route[] = [
  { method: 'POST', pattern: '/feedback', handle: ingestHandler },
  { method: 'GET', pattern: '/feedback/:id', handle: getItemHandler },
  { method: 'GET', pattern: '/dashboard/themes', handle: dashboardThemesHandler },
  { method: 'GET', pattern: '/dashboard/trends', handle: dashboardTrendsHandler },
  { method: 'GET', pattern: '/dashboard/urgent', handle: dashboardUrgentHandler },
  { method: 'GET', pattern: '/themes/:id/items', handle: themeItemsHandler },
  { method: 'GET', pattern: '/health', handle: healthHandler },
  { method: 'GET', pattern: '/', handle: staticHandler },
  { method: 'GET', pattern: '/:asset', handle: staticHandler },
];

/** Dispatch one request; every failure is mapped to the documented envelope. */
export async function dispatch(
  request: ApiRequest,
  dependencies: ApiDependencies,
): Promise<ApiResult> {
  try {
    for (const route of ROUTES) {
      if (route.method !== request.method.toUpperCase()) {
        continue;
      }
      const params = matchPath(route.pattern, request.path);
      if (params === null) {
        continue;
      }
      return await route.handle(request, params, dependencies);
    }
    return toErrorResult(
      new ValidationError(`No route for ${request.method} ${request.path}.`, [
        { field: '(route)', reason: 'unsupported method or path' },
      ]),
      request.requestId,
    );
  } catch (error) {
    return toErrorResult(error, request.requestId);
  }
}
