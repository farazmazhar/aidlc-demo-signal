/**
 * `bun run emulator:probe` — ask the running emulator, service by service, what
 * it can actually do.
 *
 * Every mandated service gets one real API call at `http://localhost:4566`; the
 * result is printed as a capability table. Nothing here assumes a service works
 * because the endpoint answers (risk R1/R5/R8), and nothing is substituted
 * silently when a call fails — a gap is printed as a gap and the script exits
 * non-zero, so the demo's runbook records what really happened.
 */

import { APIGatewayClient, CreateRestApiCommand, DeleteRestApiCommand } from '@aws-sdk/client-api-gateway';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  type Runtime,
} from '@aws-sdk/client-lambda';
import { CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { ListIdentitiesCommand, SESClient, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';

import { loadConfig } from '../src/config/config';
import { loadStackConfig } from '../infra/config';
import { GSI_DEFINITIONS, TABLE_ATTRIBUTE_DEFINITIONS } from '../src/persistence/dynamo-keys';
import { createZip } from './zip';

interface ProbeResult {
  readonly service: string;
  readonly operation: string;
  readonly ok: boolean;
  readonly detail: string;
}

const PROBE_ACCOUNT = '000000000000';

async function probe(
  service: string,
  operation: string,
  run: () => Promise<string>,
): Promise<ProbeResult> {
  try {
    const detail = await run();
    return { service, operation, ok: true, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { service, operation, ok: false, detail: message.replace(/\s+/g, ' ').slice(0, 160) };
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  // The same source as the stack, so the probe tests the runtime actually deployed.
  const lambdaRuntime = loadStackConfig().lambdaRuntime;
  const endpoint = config.awsEndpointUrl;
  const region = config.awsRegion;
  const clientOptions = { region, endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };

  console.log(`[probe] emulator endpoint: ${endpoint}`);
  console.log(`[probe] region: ${region}`);
  console.log(`[probe] lambda runtime: ${lambdaRuntime}`);

  const dynamo = new DynamoDBClient(clientOptions);
  const apiGateway = new APIGatewayClient(clientOptions);
  const lambda = new LambdaClient(clientOptions);
  const scheduler = new SchedulerClient(clientOptions);
  const ses = new SESClient(clientOptions);
  const cloudformation = new CloudFormationClient(clientOptions);
  const s3 = new S3Client({ ...clientOptions, forcePathStyle: true });

  const tableName = 'signal-probe-table';
  const functionName = 'signal-probe-function';
  const apiName = 'signal-probe-api';
  const scheduleName = 'signal-probe-schedule';
  const bucketName = 'signal-probe-bucket';
  const roleArn = `arn:aws:iam::${PROBE_ACCOUNT}:role/signal-probe`;

  const results: ProbeResult[] = [];

  results.push(
    await probe('dynamodb', 'CreateTable/DescribeTable', async () => {
      await dynamo.send(
        new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: TABLE_ATTRIBUTE_DEFINITIONS.map((definition) => ({
            AttributeName: definition.name,
            AttributeType: definition.type,
          })),
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          GlobalSecondaryIndexes: GSI_DEFINITIONS.map((definition) => ({
            IndexName: definition.name,
            KeySchema: [
              { AttributeName: definition.partitionKey, KeyType: 'HASH' as const },
              { AttributeName: definition.sortKey, KeyType: 'RANGE' as const },
            ],
            Projection: { ProjectionType: 'ALL' as const },
          })),
        }),
      );
      const described = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
      const gsiCount = described.Table?.GlobalSecondaryIndexes?.length ?? 0;
      await dynamo.send(new DeleteTableCommand({ TableName: tableName })).catch(() => undefined);
      return `table created with ${gsiCount} GSIs`;
    }),
  );

  results.push(
    await probe('apigateway', 'CreateRestApi/DeleteRestApi', async () => {
      const created = await apiGateway.send(new CreateRestApiCommand({ name: apiName }));
      await apiGateway.send(new DeleteRestApiCommand({ restApiId: created.id }));
      return `REST API created (id ${created.id ?? 'unknown'})`;
    }),
  );

  results.push(
    await probe('lambda', 'CreateFunction/GetFunction/DeleteFunction', async () => {
      const zip = createZip([{ name: 'index.js', data: 'exports.handler = async () => ({ statusCode: 200 });' }]);
      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: functionName,
          // Config supplies the runtime as a string; the SDK models it as an enum.
          Runtime: lambdaRuntime as Runtime,
          Role: roleArn,
          Handler: 'index.handler',
          Code: { ZipFile: zip },
          Timeout: 10,
        }),
      );
      const fetched = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
      await lambda.send(new DeleteFunctionCommand({ FunctionName: functionName })).catch(() => undefined);
      return `function ${fetched.Configuration?.FunctionName ?? functionName} is ${fetched.Configuration?.State ?? 'created'}`;
    }),
  );

  results.push(
    await probe('scheduler', 'CreateSchedule/GetSchedule/DeleteSchedule', async () => {
      await scheduler.send(
        new CreateScheduleCommand({
          Name: scheduleName,
          ScheduleExpression: 'rate(1 day)',
          FlexibleTimeWindow: { Mode: 'OFF' },
          Target: { Arn: `arn:aws:lambda:${region}:${PROBE_ACCOUNT}:function:${functionName}`, RoleArn: roleArn },
        }),
      );
      const fetched = await scheduler.send(new GetScheduleCommand({ Name: scheduleName }));
      await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName })).catch(() => undefined);
      return `schedule ${fetched.Name ?? scheduleName} present with expression ${fetched.ScheduleExpression ?? 'unknown'}`;
    }),
  );

  results.push(
    await probe('ses', 'VerifyEmailIdentity/ListIdentities', async () => {
      await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: config.sesSender }));
      const identities = await ses.send(new ListIdentitiesCommand({}));
      return `${identities.Identities?.length ?? 0} identities, sender ${config.sesSender}`;
    }),
  );

  results.push(
    await probe('s3', 'CreateBucket/ListBuckets/DeleteBucket', async () => {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
      const listed = await s3.send(new ListBucketsCommand({}));
      await s3.send(new DeleteBucketCommand({ Bucket: bucketName })).catch(() => undefined);
      return `${listed.Buckets?.length ?? 0} bucket(s) visible`;
    }),
  );

  results.push(
    await probe('cloudformation', 'DescribeStacks', async () => {
      const stacks = await cloudformation.send(new DescribeStacksCommand({}));
      return `${stacks.Stacks?.length ?? 0} stack(s) visible`;
    }),
  );

  // Bedrock has no local endpoint and the spike forbids cloud credentials, so it
  // is recorded as unverified rather than probed (risk R7).
  results.push({
    service: 'bedrock',
    operation: '(not probed)',
    ok: false,
    detail: 'no local Bedrock endpoint; live path cannot be exercised without AWS credentials (risk R7)',
  });

  const width = Math.max(...results.map((result) => result.service.length));
  console.log('');
  console.log('[probe] capability table (service / operation / result)');
  for (const result of results) {
    console.log(`[probe] ${result.ok ? 'OK  ' : 'GAP '} ${result.service.padEnd(width)} ${result.operation} — ${result.detail}`);
  }

  const coreGaps = results.filter((result) => !result.ok && result.service !== 'bedrock');
  console.log('');
  if (coreGaps.length > 0) {
    console.error(
      `[probe] ${coreGaps.length} mandated service(s) unavailable: ${coreGaps
        .map((gap) => gap.service)
        .join(', ')}. This is reported as a gap, not worked around.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('[probe] every mandated emulator service answered; Bedrock remains unverifiable locally.');
}

void main();
