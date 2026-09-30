/**
 * Shared CDK application factory.
 *
 * Both `infra/bin/app.ts` (the standalone `bun run cdk:synth` entry) and
 * `scripts/deploy.ts` build the same app, so the synthesised template and the
 * deployed template can never diverge.
 */

import { App } from 'aws-cdk-lib';

import { loadStackConfig } from '../config';
import type { StackConfig } from '../config';
import { SignalStack } from './signal-stack';

export interface SignalApp {
  readonly app: App;
  readonly stack: SignalStack;
  readonly stackConfig: StackConfig;
}

/**
 * Build the app and synthesise it.
 *
 * `outdir` defaults to `cdk.out` in the working directory, which is where the
 * template is read from for the emulator deploy.
 */
export function createSignalApp(options: { outdir?: string; stackConfig?: StackConfig } = {}): SignalApp {
  const stackConfig = options.stackConfig ?? loadStackConfig();
  const app = new App({
    outdir: options.outdir ?? 'cdk.out',
    context: { '@aws-cdk/core:stackRelativeExports': false },
  });
  const stack = new SignalStack(app, 'SignalStack', {
    stackConfig,
    env: { account: stackConfig.account, region: stackConfig.region },
    description: 'Build Signal — local feasibility spike (emulator only)',
  });
  app.synth();
  return { app, stack, stackConfig };
}
