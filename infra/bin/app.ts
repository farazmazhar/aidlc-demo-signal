/**
 * `bun run cdk:synth` — synthesise the CloudFormation template into `cdk.out/`.
 *
 * The CDK CLI is not installed on this machine and is not needed: `aws-cdk-lib`
 * ships the synthesizer, so the app is built and synthesised programmatically.
 */

import path from 'node:path';

import { createSignalApp } from '../lib/signal-app';

const outdir = process.argv[2] ?? path.resolve(process.cwd(), 'cdk.out');
const { stack, stackConfig } = createSignalApp({ outdir });

console.log(`[cdk] synthesised ${stack.stackName} into ${outdir}`);
console.log(`[cdk] lambda ${stackConfig.config.apiStageName} stage, table ${stackConfig.config.feedbackTable}`);
console.log(`[cdk] next: bun run deploy`);
