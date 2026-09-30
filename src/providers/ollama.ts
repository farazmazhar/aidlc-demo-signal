/**
 * Ollama adapter — the default local provider (FR2.1, FR3.1, NFR5).
 *
 * Chat uses `/api/chat` with a JSON answer requested where the caller needs one.
 * Embeddings prefer the current `/api/embed` endpoint and fall back to the older
 * `/api/embeddings` when the running Ollama build does not serve it, because the
 * endpoint was renamed upstream and a spike must not depend on one build.
 *
 * Every transport failure — timeout, connection error, non-2xx — surfaces as
 * `ProviderError`; a 2xx answer with an unusable body surfaces as
 * `ProviderOutputError`. Nothing is retried silently here: the caller decides.
 */

import { ProviderError, ProviderOutputError } from '../domain/ports';
import type { CompleteOptions, EmbeddingProvider, LlmProvider } from './types';

export interface OllamaConnectionOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface OllamaChatOptions extends OllamaConnectionOptions {
  readonly model: string;
}

export interface OllamaEmbeddingOptions extends OllamaConnectionOptions {
  readonly model: string;
  readonly dimensions: number;
}

interface OllamaChatResponse {
  readonly message?: { readonly content?: unknown };
}

interface OllamaEmbedResponse {
  readonly embedding?: unknown;
  readonly embeddings?: unknown;
}

function decodeEmbedding(payload: OllamaEmbedResponse): number[] | null {
  const candidate =
    payload.embedding ?? (Array.isArray(payload.embeddings) ? payload.embeddings[0] : undefined);
  if (!Array.isArray(candidate)) {
    return null;
  }
  const values = candidate.map(Number);
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

/** Shared POST-with-timeout transport for both Ollama ports. */
class OllamaHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, fetchImpl: typeof fetch | undefined, timeoutMs: number | undefined) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = timeoutMs ?? 60_000;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError('ollama', `POST ${path} to ${this.baseUrl} failed: ${reason}`, error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        'ollama',
        `POST ${path} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderOutputError('ollama', `POST ${path} returned a body that is not JSON`);
    }
  }
}

export class OllamaLlmProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly http: OllamaHttp;

  constructor(options: OllamaChatOptions) {
    this.model = options.model;
    this.http = new OllamaHttp(options.baseUrl, options.fetchImpl, options.timeoutMs);
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: options.temperature ?? 0 },
    };
    if (options.json) {
      body.format = 'json';
    }
    const payload = await this.http.post<OllamaChatResponse>('/api/chat', body);
    const content = payload.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ProviderOutputError(this.name, 'chat response contained no message content');
    }
    return content;
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dimensions: number;
  private readonly http: OllamaHttp;

  constructor(options: OllamaEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.http = new OllamaHttp(options.baseUrl, options.fetchImpl, options.timeoutMs);
  }

  async embed(text: string): Promise<number[]> {
    try {
      const payload = await this.http.post<OllamaEmbedResponse>('/api/embed', {
        model: this.model,
        input: text,
      });
      const embedding = decodeEmbedding(payload);
      if (embedding) {
        return embedding;
      }
      throw new ProviderOutputError(this.name, '/api/embed returned no embedding array');
    } catch (error) {
      // Only a missing endpoint justifies the legacy path; anything else stands.
      if (!(error instanceof ProviderError) || !error.message.includes('HTTP 404')) {
        throw error;
      }
    }

    const legacy = await this.http.post<OllamaEmbedResponse>('/api/embeddings', {
      model: this.model,
      prompt: text,
    });
    const embedding = decodeEmbedding(legacy);
    if (!embedding) {
      throw new ProviderOutputError(this.name, '/api/embeddings returned no embedding array');
    }
    return embedding;
  }
}
