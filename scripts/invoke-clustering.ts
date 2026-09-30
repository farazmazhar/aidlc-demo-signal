/**
 * `bun run invoke:clustering` — run the deployed clustering Lambda through the
 * emulator's Invoke API.
 *
 * The emulator's EventBridge Scheduler is documented as mock-only and never
 * triggers its target (risk R2), so the demo does not wait for the schedule: it
 * invokes the function the schedule points at and asserts the returned run. The
 * schedule resource itself is asserted separately by `bun run verify:infra`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { loadStackConfig } from '../infra/config';
import type { WeeklyRun } from '../src/domain/types';

interface StackRecord {
  readonly stackName?: string;
  readonly ClusteringFunctionName?: string;
}

export async function invokeClustering(
  stackRecordPath = path.resolve(process.cwd(), '.signal-stack.json'),
): Promise<{ run: WeeklyRun; durationMs: number }> {
  const stackConfig = loadStackConfig();
  const record = JSON.parse(await readFile(stackRecordPath, 'utf8')) as StackRecord;
  const functionName = record.ClusteringFunctionName;
  if (!functionName) {
    throw new Error(`${stackRecordPath} does not name ClusteringFunctionName; run bun run deploy first.`);
  }

  const client = new LambdaClient({
    region: stackConfig.region,
    endpoint: stackConfig.config.awsEndpointUrl,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  const startedAt = performance.now();
  const response = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: new TextEncoder().encode(
        JSON.stringify({ source: 'aidlc.signal.scheduler', 'detail-type': 'WeeklyClustering' }),
      ),
    }),
  );
  const durationMs = performance.now() - startedAt;

  if (response.FunctionError) {
    const payload = response.Payload ? new TextDecoder().decode(response.Payload) : '';
    throw new Error(`clustering Lambda reported ${response.FunctionError}: ${payload.slice(0, 500)}`);
  }
  const payload = response.Payload ? new TextDecoder().decode(response.Payload) : '{}';
  const parsed: unknown = JSON.parse(payload);
  const run = typeof parsed === 'string' ? (JSON.parse(parsed) as WeeklyRun) : (parsed as WeeklyRun);
  return { run, durationMs };
}

/** True when this file is the process entrypoint (Bun sets argv[1] to the script). */
const invokedDirectly = (process.argv[1] ?? '').includes('invoke-clustering');

if (invokedDirectly) {
  void invokeClustering()
    .then(({ run, durationMs }) => {
      console.log(`[invoke:clustering] run ${run.id} in ${durationMs.toFixed(0)} ms (NFR3 budget: minutes)`);
      console.log(`[invoke:clustering] items ${run.itemCount}, themes ${run.themeCount}`);
      console.log(`[invoke:clustering] summary: ${run.summary}`);
    })
    .catch((error: unknown) => {
      console.error(`[invoke:clustering] FAILED: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
