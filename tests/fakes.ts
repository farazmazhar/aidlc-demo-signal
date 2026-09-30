/**
 * Hand-written fakes behind the provider and clock ports.
 *
 * The tests never construct a real adapter: no network, no credentials, no
 * model. A fake that answers with an FR2.2-valid classification while the case
 * under test is "invalid provider output" would hide the bug, so the scripted
 * answer is always exactly what the test means to exercise.
 */

import type { BedrockRuntimeLike, EmbeddingProvider, LlmProvider } from '../src/providers/types';
import { makeVector } from './factories';

/** A provider that returns a queued script of answers (or throws queued errors). */
export class FakeLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly prompts: string[] = [];
  private readonly script: Array<string | Error>;

  constructor(script: Array<string | Error>, name = 'ollama', model = 'fake-chat') {
    this.script = [...script];
    this.name = name;
    this.model = model;
  }

  get calls(): number {
    return this.prompts.length;
  }

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error('FakeLlmProvider script exhausted — the test queued too few answers.');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

/** Deterministic embedder: same text and seed always yield the same vector. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model = 'fake-embed';
  readonly dimensions: number;
  private readonly seed: number;

  constructor(dimensions = 768, seed = 5, name = 'ollama') {
    this.dimensions = dimensions;
    this.seed = seed;
    this.name = name;
  }

  async embed(text: string): Promise<number[]> {
    return makeVector(this.dimensions, this.seed + text.length);
  }
}

/** Deterministic embedder that answers with the wrong width, for the guard test. */
export class WrongDimensionEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model = 'fake-embed';
  readonly dimensions = 768;

  async embed(): Promise<number[]> {
    return makeVector(8, 1);
  }
}

export interface FakeBedrockClient {
  readonly client: BedrockRuntimeLike;
  readonly inputs: Record<string, unknown>[];
}

/**
 * A Bedrock runtime stand-in: records each InvokeModel request and answers with
 * the canned response body the test supplies.
 */
export function fakeBedrockClient(body: unknown): FakeBedrockClient {
  const inputs: Record<string, unknown>[] = [];
  return {
    inputs,
    client: {
      async send(command) {
        inputs.push(command.input);
        return { body: new TextEncoder().encode(JSON.stringify(body)) };
      },
    },
  };
}
