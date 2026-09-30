/**
 * `bun run smoke` — the end-to-end demo against the emulator (NFR1–NFR3, NFR5).
 *
 * What it proves, in order:
 *  1. the environment holds no cloud credentials and every endpoint is local;
 *  2. `POST /feedback` through the emulated API Gateway accepts both the API and
 *     the web payload, stamps them server-side, and classifies them with FR2.2
 *     values; `GET /feedback/{id}` returns the stored item;
 *  3. the measured classification + embedding latency per item (NFR2);
 *  4. the deployed clustering Lambda runs, persists a run and themes with a
 *     summary, and finishes inside the NFR3 budget;
 *  5. the dashboard reads answer and the dashboard assets are served.
 *
 * Every failed assertion is printed and the process exits non-zero. Nothing is
 * substituted: if a provider or the emulator will not serve the demo, that is the
 * result.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../src/config/config';
import type { Classification, FeedbackItem, Theme, WeeklyRun } from '../src/domain/types';
import { CATEGORIES, SENTIMENTS, URGENCIES } from '../src/domain/types';
import { invokeClustering } from './invoke-clustering';

const NFR2_BUDGET_MS = 10_000;
const NFR3_BUDGET_MS = 120_000;

interface StackRecord {
  readonly RestApiId?: string;
  readonly StageName?: string;
}

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** Build the local invoke URL for the configured URL style (risk R10). */
export function buildBaseUrl(
  style: string,
  endpoint: string,
  apiId: string,
  stage: string,
): string {
  if (style === 'execute_api_hostname') {
    const parsed = new URL(endpoint);
    const port = parsed.port.length > 0 ? `:${parsed.port}` : '';
    return `http://${apiId}.execute-api.localhost.localstack.cloud${port}/${stage}`;
  }
  if (style === '_user_request_') {
    return `${endpoint}/restapis/${apiId}/${stage}/_user_request_`;
  }
  return `${endpoint}/_aws/execute-api/${apiId}/${stage}`;
}

async function request(
  baseUrl: string,
  method: 'GET' | 'POST',
  routePath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; latencyMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const latencyMs = performance.now() - startedAt;
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON bodies (the static assets) are returned as text.
  }
  return { status: response.status, body: parsed, latencyMs };
}

function assertLocalEnvironment(): void {
  const credentialKeys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE'];
  const present = credentialKeys.filter((key) => (process.env[key] ?? '').length > 0);
  check(
    'env:no-cloud-credentials',
    present.length === 0,
    present.length === 0 ? 'no AWS credential variables in the environment' : `present: ${present.join(', ')}`,
  );

  const config = loadConfig(process.env);
  const endpoint = new URL(config.awsEndpointUrl);
  const database = new URL(config.databaseUrl);
  const ollama = new URL(config.ollamaBaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', 'emulator', 'postgres', 'ollama']);
  check(
    'env:local-endpoints-only',
    localHosts.has(endpoint.hostname) &&
      localHosts.has(database.hostname) &&
      localHosts.has(ollama.hostname) &&
      endpoint.port === '4566',
    `emulator ${config.awsEndpointUrl}, postgres ${database.hostname}:${database.port}, ollama ${config.ollamaBaseUrl}`,
  );
}

function classificationIsFr22(classification: Classification | undefined): boolean {
  return (
    classification !== undefined &&
    (CATEGORIES as readonly string[]).includes(classification.category) &&
    (SENTIMENTS as readonly string[]).includes(classification.sentiment) &&
    (URGENCIES as readonly string[]).includes(classification.urgency)
  );
}

const SEED_TEXTS = [
  'Checkout fails when the coupon field is left empty',
  'Checkout keeps failing if I do not fill in the coupon field',
  'The coupon field on checkout makes the whole order fail',
  'The pricing page is confusing and I cannot tell which plan I am on',
  'Pricing page layout is confusing, the plan names are unclear',
  'I find the pricing page confusing and cannot compare plans',
];

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  assertLocalEnvironment();

  const record = JSON.parse(
    await readFile(path.resolve(process.cwd(), '.signal-stack.json'), 'utf8'),
  ) as StackRecord;
  if (!record.RestApiId || !record.StageName) {
    throw new Error('.signal-stack.json has no RestApiId/StageName; run bun run deploy first.');
  }

  const baseUrl = buildBaseUrl(
    config.localApiUrlStyle,
    config.awsEndpointUrl,
    record.RestApiId,
    record.StageName,
  );
  console.log(`[smoke] local API URL (style ${config.localApiUrlStyle}): ${baseUrl}`);

  // --- 2. ingest both payload shapes -------------------------------------------
  const apiPayload = { source: 'api', text: SEED_TEXTS[0] };
  const webPayload = {
    source: 'web',
    text: 'Checkout fails when the coupon field is empty, this is blocking orders',
    submitter_email: 'tester@example.com',
    product_area: 'checkout',
  };

  const latencies: number[] = [];
  const created: FeedbackItem[] = [];
  const payloads = [apiPayload, webPayload, ...SEED_TEXTS.slice(1).map((text) => ({ source: 'api', text }))];
  for (const payload of payloads) {
    const response = await request(baseUrl, 'POST', '/feedback', payload);
    if (response.status !== 201) {
      check(
        'ingest:post-201',
        false,
        `expected 201, received ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`,
      );
      finish();
      return;
    }
    created.push(response.body as FeedbackItem);
    latencies.push(response.latencyMs);
  }

  const first = created[0];
  check(
    'ingest:post-201',
    created.length === payloads.length && first !== undefined,
    `${created.length} items accepted with 201`,
  );
  check(
    'ingest:server-timestamp',
    created.every((item) => typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))),
    `createdAt values start at ${created[0]?.createdAt ?? 'n/a'}`,
  );
  check(
    'ingest:fr22-classification',
    created.every((item) => classificationIsFr22(item.classification)),
    `first item classified as ${JSON.stringify(first?.classification)}`,
  );

  const fetched = await request(baseUrl, 'GET', `/feedback/${first?.id ?? 'missing'}`);
  check(
    'ingest:retrieve-by-id',
    fetched.status === 200 && (fetched.body as FeedbackItem).id === first?.id,
    `GET /feedback/${first?.id ?? 'missing'} returned ${fetched.status}`,
  );

  // --- 3. NFR2 latency ----------------------------------------------------------
  const worstLatency = Math.max(...latencies);
  check(
    'nfr2:classify-and-embed-latency',
    worstLatency < NFR2_BUDGET_MS,
    `worst per-item latency ${worstLatency.toFixed(0)} ms over ${latencies.length} items (budget ${NFR2_BUDGET_MS} ms)`,
  );

  // --- 4. weekly clustering ----------------------------------------------------
  const { run, durationMs } = await invokeClustering();
  check(
    'fr4:run-persisted-with-summary',
    typeof run.summary === 'string' && run.summary.trim().length > 0 && run.itemCount > 0,
    `run ${run.id}: ${run.itemCount} items, ${run.themeCount} themes, summary "${run.summary.slice(0, 120)}"`,
  );
  check('fr4:themes-persisted', run.themeCount >= 1, `${run.themeCount} theme(s) persisted`);
  check(
    'nfr3:weekly-job-duration',
    durationMs < NFR3_BUDGET_MS,
    `job finished in ${durationMs.toFixed(0)} ms (budget ${NFR3_BUDGET_MS} ms)`,
  );

  // --- 5. dashboard reads ------------------------------------------------------
  const themes = await request(baseUrl, 'GET', '/dashboard/themes');
  const themeBody = themes.body as { themes?: Theme[]; run?: WeeklyRun };
  check('fr5:themes-endpoint', themes.status === 200, `GET /dashboard/themes returned ${themes.status}`);
  check(
    'fr4:themes-readable-by-dashboard',
    (themeBody.themes ?? []).length >= 1 && (themeBody.run?.summary ?? '').length > 0,
    `${(themeBody.themes ?? []).length} theme(s) and a run summary are readable`,
  );

  const firstThemeId = themeBody.themes?.[0]?.id;
  const drilldown = await request(baseUrl, 'GET', `/themes/${firstThemeId ?? 'missing'}/items`);
  check(
    'fr5:drilldown',
    drilldown.status === 200 && ((drilldown.body as { items?: unknown[] }).items ?? []).length >= 1,
    `drill-down for ${firstThemeId ?? 'missing'} returned ${drilldown.status}`,
  );

  const trends = await request(baseUrl, 'GET', '/dashboard/trends');
  const urgent = await request(baseUrl, 'GET', '/dashboard/urgent');
  check(
    'fr5:trends-and-urgent',
    trends.status === 200 && urgent.status === 200,
    `GET /dashboard/trends ${trends.status}, /dashboard/urgent ${urgent.status}`,
  );

  const filterRejected = await request(baseUrl, 'GET', '/dashboard/themes?category=infrastructure');
  check('fr5:filter-validation', filterRejected.status === 400, `unknown filter value returned ${filterRejected.status}`);

  const index = await request(baseUrl, 'GET', '/');
  const appJs = await request(baseUrl, 'GET', '/app.js');
  check(
    'fr5:dashboard-assets-served',
    typeof index.body === 'string' &&
      index.body.includes('dashboard-root') &&
      typeof appJs.body === 'string' &&
      appJs.body.includes('buildSubmitPayload'),
    `GET / ${index.status} and /app.js ${appJs.status} served by the same origin`,
  );

  finish();
}

function finish(): void {
  const failures = checks.filter((entry) => !entry.ok);
  console.log('');
  console.log(`[smoke] ${checks.length - failures.length}/${checks.length} checks passed`);
  if (failures.length > 0) {
    console.error(`[smoke] FAILED: ${failures.map((failure) => failure.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[smoke] end-to-end demo verified against the local emulator.');
}

void main().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
