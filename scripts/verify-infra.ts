/**
 * `bun run verify:infra` — assert against the emulator that every mandated
 * service exists and is wired (FR7.1).
 *
 * Each check is a read against the deployed resource, not against the template:
 * a template that synthesises is not a stack that deployed. An emulator that
 * refuses a resource type is printed as a failure, never replaced by a different
 * resource (risk R5).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { APIGatewayClient, GetResourcesCommand, GetRestApiCommand, GetStageCommand } from '@aws-sdk/client-api-gateway';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetFunctionCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { ListIdentitiesCommand, SESClient } from '@aws-sdk/client-ses';

import { loadStackConfig } from '../infra/config';
import { GSI_DEFINITIONS } from '../src/persistence/dynamo-keys';

interface StackRecord {
  readonly stackName?: string;
  readonly RestApiId?: string;
  readonly StageName?: string;
  readonly ApiFunctionName?: string;
  readonly ClusteringFunctionName?: string;
  readonly FeedbackTableName?: string;
  readonly ScheduleName?: string;
  readonly SesSenderIdentity?: string;
  readonly ConfigurationSetName?: string;
}

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function main(): Promise<void> {
  const stackConfig = loadStackConfig();
  const { region } = stackConfig;
  const endpoint = stackConfig.config.awsEndpointUrl;

  const recordPath = path.resolve(process.cwd(), '.signal-stack.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8')) as StackRecord;

  console.log(`[verify] endpoint ${endpoint}, stack ${record.stackName ?? stackConfig.stackName}`);

  const clientOptions = {
    region,
    endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
  const dynamo = new DynamoDBClient(clientOptions);
  const lambda = new LambdaClient(clientOptions);
  const apiGateway = new APIGatewayClient(clientOptions);
  const scheduler = new SchedulerClient(clientOptions);
  const ses = new SESClient(clientOptions);
  const cloudformation = new CloudFormationClient(clientOptions);

  const checks: Check[] = [];

  const stack = await cloudformation.send(new DescribeStacksCommand({ StackName: record.stackName }));
  const stackStatus = stack.Stacks?.[0]?.StackStatus ?? 'MISSING';
  checks.push({
    name: 'cloudformation:stack',
    ok: stackStatus === 'CREATE_COMPLETE' || stackStatus === 'UPDATE_COMPLETE',
    detail: `status ${stackStatus}`,
  });

  const described = await dynamo.send(new DescribeTableCommand({ TableName: record.FeedbackTableName }));
  const indexNames = (described.Table?.GlobalSecondaryIndexes ?? []).map((index) => index.IndexName).sort();
  const expectedIndexes = GSI_DEFINITIONS.map((definition) => definition.name).sort();
  checks.push({
    name: 'dynamodb:table+gsis',
    ok:
      described.Table?.TableStatus === 'ACTIVE' &&
      JSON.stringify(indexNames) === JSON.stringify(expectedIndexes),
    detail: `table ${record.FeedbackTableName} is ${described.Table?.TableStatus}; GSIs [${indexNames.join(', ')}]`,
  });

  for (const functionName of [record.ApiFunctionName, record.ClusteringFunctionName]) {
    const fetched = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    checks.push({
      name: `lambda:${functionName}`,
      ok: fetched.Configuration?.State === 'Active',
      detail: `state ${fetched.Configuration?.State ?? 'MISSING'}, runtime ${fetched.Configuration?.Runtime ?? 'unknown'}`,
    });
  }

  const restApi = await apiGateway.send(new GetRestApiCommand({ restApiId: record.RestApiId }));
  const resources = await apiGateway.send(new GetResourcesCommand({ restApiId: record.RestApiId }));
  const proxy = (resources.items ?? []).find((item) => item.pathPart === '{proxy+}');
  const rootHasMethod = (resources.items ?? []).some(
    (item) => item.path === '/' && item.resourceMethods !== undefined,
  );
  checks.push({
    name: 'apigateway:restapi+proxy',
    ok: restApi.id === record.RestApiId && proxy !== undefined && rootHasMethod,
    detail: `restApi ${restApi.id ?? 'MISSING'}, proxy resource ${proxy?.id ?? 'MISSING'}, root proxy method ${rootHasMethod}`,
  });

  const stage = await apiGateway.send(
    new GetStageCommand({ restApiId: record.RestApiId, stageName: record.StageName }),
  );
  checks.push({
    name: 'apigateway:stage',
    ok: stage.stageName === record.StageName,
    detail: `stage ${stage.stageName ?? 'MISSING'} (deployment ${stage.deploymentId ?? 'unknown'})`,
  });

  const schedule = await scheduler.send(new GetScheduleCommand({ Name: record.ScheduleName }));
  checks.push({
    name: 'scheduler:weekly-schedule',
    ok: schedule.Name === record.ScheduleName && schedule.Target !== undefined,
    detail: `schedule ${schedule.Name ?? 'MISSING'}, expression ${schedule.ScheduleExpression ?? 'unknown'}, target ${schedule.Target?.Arn ?? 'MISSING'}`,
  });

  // `AWS::SES::EmailIdentity` is a SES v2 resource while `ListIdentities` reads the
  // SES v1 store, and this emulator build implements no sesv2 API at all (checked:
  // `GetEmailIdentity` is rejected as "not yet implemented"). The deployed identity
  // is therefore asserted from the stack's own resource list, and the v1 identity
  // store is reported beside it for what it does prove: the SES endpoint serves the
  // configured sender.
  const stackResources = await cloudformation.send(
    new ListStackResourcesCommand({ StackName: record.stackName }),
  );
  const summaries = stackResources.StackResourceSummaries ?? [];
  const sesIdentity = summaries.find((entry) => entry.ResourceType === 'AWS::SES::EmailIdentity');
  const configurationSet = summaries.find(
    (entry) => entry.ResourceType === 'AWS::SES::ConfigurationSet',
  );
  const sender = stackConfig.config.sesSender;
  const v1Identities = await ses.send(new ListIdentitiesCommand({}));
  checks.push({
    name: 'ses:sender-identity',
    ok: sesIdentity?.ResourceStatus === 'CREATE_COMPLETE',
    detail: `AWS::SES::EmailIdentity ${sesIdentity?.LogicalResourceId ?? 'MISSING'} is ${sesIdentity?.ResourceStatus ?? 'MISSING'} for ${sender}; sesv1 identities [${(v1Identities.Identities ?? []).join(', ')}]; sesv2 read API is not implemented by this emulator build`,
  });
  checks.push({
    name: 'ses:configuration-set',
    ok: configurationSet?.ResourceStatus === 'CREATE_COMPLETE',
    detail: `AWS::SES::ConfigurationSet ${configurationSet?.LogicalResourceId ?? 'MISSING'} is ${configurationSet?.ResourceStatus ?? 'MISSING'}`,
  });

  const width = Math.max(...checks.map((check) => check.name.length));
  console.log('[verify] resource checks:');
  for (const check of checks) {
    console.log(`[verify]  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failures = checks.filter((check) => !check.ok);
  if (failures.length > 0) {
    console.error(
      `[verify] ${failures.length} check(s) failed: ${failures.map((failure) => failure.name).join(', ')}. An emulator capability gap is reported here, not substituted.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('[verify] every mandated resource exists and is wired.');
}

void main().catch((error: unknown) => {
  console.error(`[verify] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
