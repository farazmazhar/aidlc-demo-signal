/**
 * `bun run deploy` — synthesise with CDK, publish the artefacts, and create the
 * stack on the local emulator (FR7.1, NFR1).
 *
 * No AWS CLI and no `cdklocal` exists on this machine, so the transport is the
 * AWS SDK: the synthesised template is sent with `CreateStack`, the Lambda zips
 * are uploaded to the emulator's S3, and the stack's progress is polled with
 * `DescribeStacks`. A stack-level failure prints the failing events verbatim and
 * exits non-zero — it is never retried away.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { createSignalApp } from '../infra/lib/signal-app';
import { loadStackConfig } from '../infra/config';

const STACK_RECORD = path.resolve(process.cwd(), '.signal-stack.json');
const ROOT = process.cwd();

/**
 * CDK's synthesised template declares an `AWS::SSM::Parameter::Value<String>`
 * parameter resolved from `/cdk-bootstrap/hnb659fds/version`, which only exists
 * after `cdk bootstrap`. Creating that one parameter is the emulator's whole
 * bootstrap step, and it keeps the template exactly as CDK synthesised it rather
 * than editing the artefact before deploying.
 */
const BOOTSTRAP_PARAMETER = '/cdk-bootstrap/hnb659fds/version';
const BOOTSTRAP_VERSION = '5';

async function run(command: string, args: string[]): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    }
  });
  return promise;
}

async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    // Missing bucket is expected on a fresh emulator.
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}

interface StackOutput {
  readonly OutputKey?: string;
  readonly OutputValue?: string;
}

async function waitForStack(
  cloudformation: CloudFormationClient,
  stackName: string,
  target: string,
): Promise<StackOutput[]> {
  const deadline = Date.now() + 5 * 60 * 1000;
  let lastStatus = 'UNKNOWN';
  while (Date.now() < deadline) {
    const described = await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = described.Stacks?.[0];
    lastStatus = stack?.StackStatus ?? 'UNKNOWN';
    if (lastStatus === target) {
      return stack?.Outputs ?? [];
    }
    if (lastStatus.endsWith('_FAILED') || lastStatus === 'ROLLBACK_COMPLETE') {
      throw new Error(`Stack ${stackName} entered ${lastStatus}: ${stack?.StackStatusReason ?? 'no reason given'}`);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 2000);
    await promise;
  }
  throw new Error(`Stack ${stackName} did not reach ${target} within the deadline (last status ${lastStatus}).`);
}

async function main(): Promise<void> {
  const stackConfig = loadStackConfig();
  const { region, account, stackName } = stackConfig;
  const endpoint = stackConfig.config.awsEndpointUrl;

  console.log('[deploy] 1/4 bundling Lambda artefacts');
  await run('bun', ['scripts/build-lambda.ts']);

  console.log('[deploy] 2/4 synthesising the CDK stack');
  const outdir = path.resolve(ROOT, 'cdk.out');
  createSignalApp({ outdir, stackConfig });
  const templatePath = path.join(outdir, 'SignalStack.template.json');
  const template = await readFile(templatePath, 'utf8');
  console.log(`[deploy]     template: ${templatePath} (${template.length} bytes)`);

  const clientOptions = {
    region,
    endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
  const s3 = new S3Client({ ...clientOptions, forcePathStyle: true });
  const cloudformation = new CloudFormationClient(clientOptions);

  console.log('[deploy] 3/4 bootstrapping the emulator and uploading artefacts');
  await new SSMClient(clientOptions).send(
    new PutParameterCommand({
      Name: BOOTSTRAP_PARAMETER,
      Value: BOOTSTRAP_VERSION,
      Type: 'String',
      Overwrite: true,
    }),
  );
  console.log(`[deploy]     ${BOOTSTRAP_PARAMETER} = ${BOOTSTRAP_VERSION} (the template's BootstrapVersion parameter)`);

  await ensureBucket(s3, stackConfig.apiCodeS3Bucket);
  for (const [key, file] of [
    [stackConfig.apiCodeS3Key, 'build/api.zip'],
    [stackConfig.clusteringCodeS3Key, 'build/clustering.zip'],
  ] as const) {
    const body = await readFile(path.resolve(ROOT, file));
    await s3.send(new PutObjectCommand({ Bucket: stackConfig.apiCodeS3Bucket, Key: key, Body: body }));
    console.log(`[deploy]     uploaded ${file} → s3://${stackConfig.apiCodeS3Bucket}/${key} (${body.length} bytes)`);
  }

  console.log(`[deploy] 4/4 deploying stack ${stackName} (account ${account}, region ${region})`);
  let outputs: StackOutput[];
  try {
    await cloudformation.send(
      new CreateStackCommand({
        StackName: stackName,
        TemplateBody: template,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND'],
      }),
    );
    outputs = await waitForStack(cloudformation, stackName, 'CREATE_COMPLETE');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('AlreadyExistsException') && !message.includes('already exists')) {
      throw error;
    }
    console.log('[deploy]     stack already exists — updating it');
    await cloudformation.send(
      new UpdateStackCommand({
        StackName: stackName,
        TemplateBody: template,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND'],
      }),
    );
    outputs = await waitForStack(cloudformation, stackName, 'UPDATE_COMPLETE');
  }

  const record: Record<string, string> = { stackName, endpoint, region, account };
  for (const output of outputs) {
    if (output.OutputKey && output.OutputValue) {
      record[output.OutputKey] = output.OutputValue;
    }
  }
  await writeFile(STACK_RECORD, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`[deploy] stack outputs written to ${STACK_RECORD}:`);
  for (const [key, value] of Object.entries(record)) {
    console.log(`[deploy]   ${key} = ${value}`);
  }
  console.log('[deploy] done — next: bun run verify:infra');
}

void main().catch(async (error: unknown) => {
  console.error(`[deploy] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
