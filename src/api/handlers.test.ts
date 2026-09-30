/**
 * T10–T12 — API / endpoint layer.
 *
 * T10 happy: an unauthenticated `POST /feedback` carrying the web-form payload
 *            returns 201 with a server-side timestamp and the classification, and
 *            `GET /feedback/{id}` returns the same item.
 * T11 error: every documented payload violation returns the 400 envelope.
 * T12 happy+edge: the three dashboard reads answer, accept the FR2.2 filter
 *            values, and reject an unknown filter value with 400.
 */

import { describe, expect, test } from 'bun:test';

import { createStaticAssetsFromMap } from './static-assets';
import type { ApiDependencies } from './routes';
import { createHandler, stripStage } from './handler';
import type { ProxyEvent } from './handler';
import { InMemoryFeedbackRepository, InMemoryVectorStore } from '../persistence/in-memory';
import type { ErrorEnvelope } from './errors';
import { TEST_NOW, fixedClock, makeFeedbackItem } from '../../tests/factories';
import { FakeEmbeddingProvider, FakeLlmProvider } from '../../tests/fakes';

const VALID_ANSWER = '{"category":"usability","sentiment":"negative","urgency":"high"}';

let idCounter = 0;

/** A fresh dependency set per test: no shared mutable state between cases. */
interface TestDependencies {
  readonly deps: ApiDependencies;
  readonly repository: InMemoryFeedbackRepository;
  readonly vectors: InMemoryVectorStore;
}

function dependencies(llmAnswers: string[] = [VALID_ANSWER]): TestDependencies {
  idCounter = 0;
  const repository = new InMemoryFeedbackRepository();
  const vectors = new InMemoryVectorStore();
  const deps: ApiDependencies = {
    repository,
    vectors,
    llm: new FakeLlmProvider(llmAnswers),
    embedder: new FakeEmbeddingProvider(768),
    clock: fixedClock(TEST_NOW),
    config: { apiStageName: 'local', dashboardTrendWeeks: 8 },
    staticAssets: createStaticAssetsFromMap({
      'index.html': '<html><body data-testid="dashboard-root"></body></html>',
      'app.js': 'export const marker = "build-signal-app";',
      'styles.css': 'body { font-family: sans-serif; }',
    }),
    newId: () => `item-${(idCounter += 1)}`,
  };
  return { deps, repository, vectors };
}

function post(body: unknown, overrides: Partial<ProxyEvent> = {}): ProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/local/feedback',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: { requestId: 'req-1', stage: 'local' },
    ...overrides,
  };
}

function get(path: string, query: Record<string, string | null> = {}): ProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/local${path}`,
    queryStringParameters: query,
    requestContext: { requestId: 'req-get', stage: 'local' },
  };
}

describe('API endpoints', () => {
  test('T10 unauthenticated ingest returns 201 with a server timestamp and is retrievable', async () => {
    const { deps, vectors } = dependencies();
    const handler = createHandler(deps);

    const created = await handler(
      post({ source: 'web', text: 'Checkout fails when the coupon field is empty', submitter_email: 'tester@example.com' }),
    );

    // No credentials were sent or required (FR1.5).
    expect(created.statusCode).toBe(201);
    const item = JSON.parse(created.body) as Record<string, unknown>;
    expect(item.id).toBe('item-1');
    expect(item.source).toBe('web');
    expect(item.createdAt).toBe(TEST_NOW);
    expect(item.classification).toEqual({ category: 'usability', sentiment: 'negative', urgency: 'high' });

    // The vector is associated with the same item (FR3.2).
    const stored = await vectors.querySimilar(new Array(768).fill(0), 1);
    expect(stored.map((record) => record.itemId)).toEqual(['item-1']);

    const fetched = await handler(get('/feedback/item-1'));
    expect(fetched.statusCode).toBe(200);
    expect(JSON.parse(fetched.body)).toEqual(item);

    const missing = await handler(get('/feedback/nope'));
    expect(missing.statusCode).toBe(404);
    expect((JSON.parse(missing.body) as ErrorEnvelope).error.code).toBe('NOT_FOUND');

    // The stage prefix is stripped from the proxy path.
    expect(stripStage('/local/feedback/item-1', 'local')).toBe('/feedback/item-1');
  });

  test('T11 payload violations return the documented 400 envelope', async () => {
    const { deps, repository, vectors } = dependencies();
    const handler = createHandler(deps);

    const cases: Array<{ name: string; body: unknown }> = [
      { name: 'blank text', body: { source: 'api', text: '   ' } },
      { name: 'unknown field', body: { source: 'api', text: 'ok', urgency: 'high' } },
      { name: 'invalid source', body: { source: 'email', text: 'ok' } },
      { name: 'over-long text', body: { source: 'api', text: 'x'.repeat(4001) } },
      { name: 'invalid email', body: { source: 'api', text: 'ok', submitter_email: 'not-an-email' } },
      { name: 'malformed JSON', body: '{not json' },
    ];

    for (const testCase of cases) {
      const response = await handler(post(testCase.body));
      expect(response.statusCode, testCase.name).toBe(400);
      const envelope = JSON.parse(response.body) as ErrorEnvelope;
      expect(envelope.error.code, testCase.name).toBe('VALIDATION_FAILED');
      expect(envelope.error.requestId, testCase.name).toBe('req-1');
      expect(envelope.error.message.length, testCase.name).toBeGreaterThan(0);
    }

    // Nothing was persisted by any rejected request.
    expect(repository.size()).toBe(0);
    expect(vectors.size()).toBe(0);
  });

  test('T12 dashboard reads answer, apply FR2.2 filters and reject unknown filter values', async () => {
    const { deps, repository } = dependencies();
    await repository.putItem(
      makeFeedbackItem({
        id: 'item-high',
        createdAt: TEST_NOW,
        classification: { category: 'bug', sentiment: 'negative', urgency: 'high' },
      }),
    );
    await repository.putItem(
      makeFeedbackItem({
        id: 'item-low',
        createdAt: '2026-09-21T12:00:00.000Z',
        classification: { category: 'pricing', sentiment: 'neutral', urgency: 'low' },
      }),
    );
    await repository.putTheme({
      id: 'run-1-theme-1',
      runId: 'run-1',
      label: 'Theme 1: bug',
      summary: '2 items, mostly bug',
      memberIds: ['item-high', 'item-low'],
      createdAt: TEST_NOW,
    });
    await repository.putRun({
      id: 'run-1',
      ranAt: TEST_NOW,
      windowStart: '2026-09-21T12:00:00.000Z',
      itemCount: 2,
      themeCount: 1,
      summary: 'One theme: checkout bugs.',
    });

    const handler = createHandler(deps);

    const themes = await handler(get('/dashboard/themes'));
    expect(themes.statusCode).toBe(200);
    expect((JSON.parse(themes.body) as { themes: unknown[] }).themes).toHaveLength(1);

    const trends = await handler(get('/dashboard/trends'));
    expect(trends.statusCode).toBe(200);
    const trendBody = JSON.parse(trends.body) as { trends: Array<{ weekStart: string; itemCount: number }> };
    expect(trendBody.trends).toHaveLength(8);
    expect(trendBody.trends.at(-1)?.weekStart).toBe('2026-09-28T00:00:00.000Z');
    expect(trendBody.trends.reduce((total, point) => total + point.itemCount, 0)).toBe(2);

    const urgent = await handler(get('/dashboard/urgent'));
    expect(urgent.statusCode).toBe(200);
    expect((JSON.parse(urgent.body) as { urgent: Array<{ id: string }> }).urgent.map((item) => item.id)).toEqual([
      'item-high',
    ]);

    // A valid FR2.2 filter narrows the read.
    const filtered = await handler(get('/dashboard/urgent', { urgency: 'low' }));
    expect(filtered.statusCode).toBe(200);
    expect((JSON.parse(filtered.body) as { urgent: Array<{ id: string }> }).urgent.map((item) => item.id)).toEqual([
      'item-low',
    ]);

    // An unknown filter value is rejected, not ignored.
    const rejected = await handler(get('/dashboard/themes', { category: 'infrastructure' }));
    expect(rejected.statusCode).toBe(400);
    expect((JSON.parse(rejected.body) as ErrorEnvelope).error.code).toBe('VALIDATION_FAILED');

    const filteredThemes = await handler(get('/dashboard/themes', { category: 'bug' }));
    expect(filteredThemes.statusCode).toBe(200);

    // Drill-down resolves a theme and its raw items (FR5.2).
    const drilldown = await handler(get('/themes/run-1-theme-1/items'));
    expect(drilldown.statusCode).toBe(200);
    expect((JSON.parse(drilldown.body) as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([
      'item-high',
      'item-low',
    ]);

    const unknownTheme = await handler(get('/themes/missing-theme/items'));
    expect(unknownTheme.statusCode).toBe(404);

    // The dashboard itself is served by the same origin (FR5.1).
    const root = await handler(get('/'));
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('dashboard-root');
    const appJs = await handler(get('/app.js'));
    expect(appJs.statusCode).toBe(200);
    expect(appJs.body).toContain('build-signal-app');
    const missingAsset = await handler(get('/nope.js'));
    expect(missingAsset.statusCode).toBe(404);
  });
});
