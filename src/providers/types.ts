/**
 * Provider ports (FR2.1, FR3.1, FR6.1).
 *
 * The rest of the system knows only these two interfaces. Adapters for Ollama
 * and Bedrock live beside this file and are chosen by configuration alone, so a
 * provider swap never touches business code.
 */

export interface CompleteOptions {
  /** Ask the provider for a JSON-only answer where the backend supports it. */
  readonly json?: boolean;
  readonly temperature?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/** Structural view of the Bedrock runtime client, so tests can inject a fake. */
export interface BedrockRuntimeLike {
  send(command: { readonly input: Record<string, unknown> }): Promise<unknown>;
}

export interface ProviderDependencies {
  /** Injected `fetch`, so HTTP mapping can be tested against a real local stub. */
  readonly fetchImpl?: typeof fetch;
  /** Injected Bedrock client; the live client is constructed only when needed. */
  readonly bedrockClient?: BedrockRuntimeLike;
}
