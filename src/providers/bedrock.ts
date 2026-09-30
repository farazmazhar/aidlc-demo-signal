/**
 * Amazon Bedrock adapter (FR2.1, FR3.1, FR6.1).
 *
 * Deliberately thin and shape-tolerant: it builds `InvokeModel` requests for the
 * model families the default configuration names and reads the answer back
 * without depending on a generated client per family. Request/response mapping is
 * unit-tested against an injected fake runtime, because Bedrock cannot be
 * exercised locally (the emulator does not serve it and the spike forbids cloud
 * credentials — risk R7). The live call is therefore explicitly not demonstrated.
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { ProviderError, ProviderOutputError } from '../domain/ports';
import type { BedrockRuntimeLike, CompleteOptions, EmbeddingProvider, LlmProvider } from './types';

export interface BedrockClientOptions {
  readonly region: string;
  readonly client?: BedrockRuntimeLike;
}

export interface BedrockChatOptions extends BedrockClientOptions {
  readonly model: string;
}

export interface BedrockEmbeddingOptions extends BedrockClientOptions {
  readonly model: string;
  readonly dimensions: number;
}

function isAnthropic(modelId: string): boolean {
  return modelId.startsWith('anthropic.');
}

function isCohere(modelId: string): boolean {
  return modelId.startsWith('cohere.');
}

/** Read one property from a value the compiler only knows as `unknown`. */
function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null || !(key in source)) {
    return undefined;
  }
  // Proven to be an object and to carry the key, so a string-keyed read is safe.
  const record: Record<string, unknown> = source as Record<string, unknown>;
  return record[key];
}

function readString(source: unknown, key: string): string | null {
  const value = readProperty(source, key);
  return typeof value === 'string' ? value : null;
}

/** Bedrock returns the body as bytes (or a pre-parsed object in some clients). */
function decodeBody(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) {
    throw new ProviderOutputError('bedrock', 'InvokeModel returned no body');
  }
  const text =
    typeof body === 'string'
      ? body
      : body instanceof Uint8Array
        ? new TextDecoder().decode(body)
        : JSON.stringify(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderOutputError('bedrock', `InvokeModel body is not JSON: ${text.slice(0, 120)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProviderOutputError('bedrock', 'InvokeModel body is not a JSON object');
  }
  const record: Record<string, unknown> = parsed as Record<string, unknown>;
  return record;
}

function extractAnthropicText(payload: Record<string, unknown>): string | null {
  const content = readProperty(payload, 'content');
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .map((entry) => readString(entry, 'text'))
    .filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join('') : null;
}

function extractTitanText(payload: Record<string, unknown>): string | null {
  const results = readProperty(payload, 'results');
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }
  return readString(results[0], 'outputText');
}

function buildClient(options: BedrockClientOptions): BedrockRuntimeLike {
  if (options.client) {
    return options.client;
  }
  // The SDK's command generics cannot unify with the structural seam; the seam
  // is what keeps this adapter testable without AWS credentials.
  const live: unknown = new BedrockRuntimeClient({ region: options.region });
  return live as BedrockRuntimeLike;
}

abstract class BedrockInvoker {
  readonly model: string;
  protected readonly client: BedrockRuntimeLike;

  constructor(options: BedrockClientOptions, model: string) {
    this.client = buildClient(options);
    this.model = model;
  }

  protected async invokeModel(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: unknown;
    try {
      response = await this.client.send({
        input: {
          modelId: this.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError('bedrock', `InvokeModel(${this.model}) failed: ${reason}`, error);
    }
    return decodeBody(readProperty(response, 'body'));
  }
}

export class BedrockLlmProvider extends BedrockInvoker implements LlmProvider {
  readonly name = 'bedrock';

  constructor(options: BedrockChatOptions) {
    super(options, options.model);
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const requestBody = isAnthropic(this.model)
      ? {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          temperature: options.temperature ?? 0,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }
      : {
          inputText: prompt,
          textGenerationConfig: { temperature: options.temperature ?? 0, maxTokenCount: 1024 },
        };

    const payload = await this.invokeModel(requestBody);
    const text = isAnthropic(this.model) ? extractAnthropicText(payload) : extractTitanText(payload);
    if (text === null || text.trim() === '') {
      throw new ProviderOutputError(
        this.name,
        `InvokeModel answer for ${this.model} contained no text`,
      );
    }
    return text;
  }
}

export class BedrockEmbeddingProvider extends BedrockInvoker implements EmbeddingProvider {
  readonly name = 'bedrock';
  readonly dimensions: number;

  constructor(options: BedrockEmbeddingOptions) {
    super(options, options.model);
    this.dimensions = options.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const body = isCohere(this.model)
      ? { texts: [text], input_type: 'search_document' }
      : { inputText: text, dimensions: this.dimensions };

    const payload = await this.invokeModel(body);
    const answers = readProperty(payload, isCohere(this.model) ? 'embeddings' : 'embedding');
    const candidate = isCohere(this.model) && Array.isArray(answers) ? answers[0] : answers;
    if (!Array.isArray(candidate)) {
      throw new ProviderOutputError(
        this.name,
        `embedding answer for ${this.model} contained no array`,
      );
    }
    return candidate.map(Number);
  }
}
