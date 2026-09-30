/**
 * T7–T9 — business logic.
 *
 * T7 happy: one item is classified into the FR2.2 vocabularies verbatim and
 *           embedded to the configured width; the same call site yields the
 *           Ollama adapter or the Bedrock adapter depending on configuration
 *           alone.
 * T8 happy: planted similar vectors cluster into the expected themes, a summary
 *           is produced and the run plus its themes reach the repository — and
 *           300 synthetic vectors stay far inside the job's sanity bound (NFR3).
 * T9 error: unusable provider output triggers exactly one repair attempt and then
 *           a typed error; a transport failure is typed and names the provider;
 *           a wrong-width embedding is rejected; a failed summary persists
 *           nothing.
 */

import { describe, expect, test } from 'bun:test';

import { ProviderError, ProviderOutputError } from '../domain/ports';
import { enrichFeedback, parseClassificationAnswer } from './enrichment';
import { clusterVectors } from './clustering';
import { runWeeklyClustering } from './job';
import { InMemoryFeedbackRepository, InMemoryVectorStore } from '../persistence/in-memory';
import { createEmbeddingProvider, createLlmProvider } from '../providers/factory';
import {
  TEST_NOW,
  fixedClock,
  makeFeedbackItem,
  makeNeighbourVector,
  makeVector,
} from '../../tests/factories';
import {
  FakeEmbeddingProvider,
  FakeLlmProvider,
  WrongDimensionEmbeddingProvider,
  fakeBedrockClient,
} from '../../tests/fakes';

const VALID_ANSWER = '{"category":"bug","sentiment":"negative","urgency":"high"}';
const JOB_CONFIG = { clusterSimilarityThreshold: 0.82, clusterMinSize: 2, clusterWindowDays: 7 };

interface TestProviderConfig {
  llmProvider: 'ollama' | 'bedrock';
  embeddingProvider: 'ollama' | 'bedrock';
  ollamaBaseUrl: string;
  ollamaChatModel: string;
  ollamaEmbedModel: string;
  bedrockChatModel: string;
  bedrockEmbedModel: string;
  embeddingDimensions: number;
  awsRegion: string;
}

/** A configuration slice for the provider factory; FR6.1 is a config-only swap. */
function providerConfig(overrides: Partial<TestProviderConfig> = {}): TestProviderConfig {
  return {
    llmProvider: 'ollama',
    embeddingProvider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaChatModel: 'llama3.2:3b',
    ollamaEmbedModel: 'nomic-embed-text',
    bedrockChatModel: 'anthropic.claude-3-haiku-20240307-v1:0',
    bedrockEmbedModel: 'amazon.titan-embed-text-v2:0',
    embeddingDimensions: 768,
    awsRegion: 'us-east-1',
    ...overrides,
  };
}

describe('business logic', () => {
  test('T7 classifies into the FR2.2 vocabularies verbatim and embeds to the configured width', async () => {
    const llm = new FakeLlmProvider(['{"category":" Bug ","sentiment":"NEGATIVE","urgency":"High"}']);
    const providers = {
      llm,
      embedder: new FakeEmbeddingProvider(768),
      clock: fixedClock(TEST_NOW),
    };

    const result = await enrichFeedback(providers, 'Checkout fails when the coupon field is empty');

    // Normalised for matching, stored as the vocabulary's own string (FR2.3).
    expect(result.classification).toEqual({ category: 'bug', sentiment: 'negative', urgency: 'high' });
    expect(result.vector).toHaveLength(768);
    expect(result.classifiedAt).toBe(TEST_NOW);
    expect(llm.calls).toBe(1);

    // The adapters come from configuration, and the same call site serves both.
    const ollamaProvider = createLlmProvider(providerConfig());
    expect(ollamaProvider.name).toBe('ollama');

    const bedrockFake = fakeBedrockClient({ content: [{ type: 'text', text: VALID_ANSWER }] });
    const bedrockProvider = createLlmProvider(providerConfig({ llmProvider: 'bedrock' }), {
      bedrockClient: bedrockFake.client,
    });
    expect(bedrockProvider.name).toBe('bedrock');
    expect(bedrockProvider.model).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    expect(await bedrockProvider.complete('classify this')).toBe(VALID_ANSWER);
    expect(bedrockFake.inputs[0]?.modelId).toBe('anthropic.claude-3-haiku-20240307-v1:0');

    const bedrockEmbedder = createEmbeddingProvider(
      providerConfig({
        embeddingProvider: 'bedrock',
        bedrockEmbedModel: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 1024,
      }),
      { bedrockClient: fakeBedrockClient({ embedding: makeVector(1024, 3) }).client },
    );
    expect(bedrockEmbedder.name).toBe('bedrock');
    expect(bedrockEmbedder.dimensions).toBe(1024);
    expect(await bedrockEmbedder.embed('anything')).toHaveLength(1024);
  });

  test('T8 planted vectors cluster into the expected themes and 300 vectors stay in the sanity bound', async () => {
    const dimensions = 768;
    const repository = new InMemoryFeedbackRepository();
    const vectors = new InMemoryVectorStore();

    // Two tight groups of three plus one lone item that must not become a theme.
    const seedGroup = async (prefix: string, centroidSeed: number, count: number): Promise<void> => {
      const centroid = makeVector(dimensions, centroidSeed);
      for (let index = 1; index <= count; index += 1) {
        const itemId = `${prefix}-${index}`;
        const vector = index === 1 ? centroid : makeNeighbourVector(centroid, 0.02, centroidSeed + index);
        vectors.seed({ itemId, vector, meta: {}, createdAt: TEST_NOW });
        await repository.putItem(makeFeedbackItem({ id: itemId, createdAt: TEST_NOW }));
      }
    };
    await seedGroup('checkout', 101, 3);
    await seedGroup('pricing', 707, 3);
    vectors.seed({ itemId: 'lone-item', vector: makeVector(dimensions, 4242), meta: {}, createdAt: TEST_NOW });
    await repository.putItem(makeFeedbackItem({ id: 'lone-item', createdAt: TEST_NOW }));

    const llm = new FakeLlmProvider(['Two themes this week: checkout failures and pricing confusion.']);
    const run = await runWeeklyClustering({
      repository,
      vectors,
      llm,
      clock: fixedClock(TEST_NOW),
      config: JOB_CONFIG,
    });

    expect(run.itemCount).toBe(7);
    expect(run.themeCount).toBe(2);
    expect(run.summary).toBe('Two themes this week: checkout failures and pricing confusion.');

    const storedThemes = await repository.listThemes(run.id);
    expect(storedThemes).toHaveLength(2);
    const membership = storedThemes.map((theme) =>
      theme.memberIds.map((itemId) => itemId.split('-')[0]).sort().join(','),
    );
    expect(membership.sort()).toEqual(['checkout,checkout,checkout', 'pricing,pricing,pricing']);
    for (const theme of storedThemes) {
      expect(theme.summary.length).toBeGreaterThan(0);
      expect(theme.label).toContain('bug');
    }
    expect(await repository.listRuns(5)).toHaveLength(1);

    // NFR3 sanity: a few hundred vectors complete in minutes — measured well below.
    const bigRepository = new InMemoryFeedbackRepository();
    const bigVectors = new InMemoryVectorStore();
    for (let group = 0; group < 100; group += 1) {
      const centroid = makeVector(64, 1000 + group);
      for (let index = 1; index <= 3; index += 1) {
        const itemId = `g${group}-${index}`;
        const vector = index === 1 ? centroid : makeNeighbourVector(centroid, 0.02, 1000 + group * 7 + index);
        bigVectors.seed({ itemId, vector, meta: {}, createdAt: TEST_NOW });
        await bigRepository.putItem(makeFeedbackItem({ id: itemId, createdAt: TEST_NOW }));
      }
    }
    const startedAt = performance.now();
    const bigRun = await runWeeklyClustering({
      repository: bigRepository,
      vectors: bigVectors,
      llm: new FakeLlmProvider(['One hundred themes.']),
      clock: fixedClock(TEST_NOW),
      config: JOB_CONFIG,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(bigRun.itemCount).toBe(300);
    expect(bigRun.themeCount).toBe(100);
    expect(elapsedMs).toBeLessThan(10_000);
    console.log(`[T8] 300 vectors / 100 themes clustered in ${elapsedMs.toFixed(0)} ms`);

    // The algorithm itself is deterministic and honours the minimum size.
    const seedVectors = [
      { itemId: 'b', vector: makeVector(16, 2) },
      { itemId: 'a', vector: makeVector(16, 2) },
      { itemId: 'c', vector: makeVector(16, 99) },
    ];
    const options = { runId: 'run-x', threshold: 0.9, minSize: 2, createdAt: TEST_NOW };
    const first = clusterVectors(seedVectors, options);
    expect(first).toEqual(clusterVectors([...seedVectors].reverse(), options));
    expect(first).toHaveLength(1);
    expect(first[0]?.memberIds).toEqual(['a', 'b']);
    expect(first[0]?.id).toBe('run-x-theme-1');
    expect(clusterVectors(seedVectors, { ...options, minSize: 5 })).toEqual([]);
  });

  test('T9 unusable provider output, transport failure and dimension mismatch are typed errors', async () => {
    const repository = new InMemoryFeedbackRepository();

    // Out-of-vocabulary answer, then an out-of-vocabulary repair: exactly one retry.
    const stubborn = new FakeLlmProvider([
      '{"category":"infrastructure","sentiment":"negative","urgency":"blocker"}',
      '{"category":"infrastructure","sentiment":"negative","urgency":"blocker"}',
    ]);
    const failure = await enrichFeedback(
      { llm: stubborn, embedder: new FakeEmbeddingProvider(768), clock: fixedClock(TEST_NOW) },
      'Something is wrong',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderOutputError);
    expect(stubborn.calls).toBe(2);
    expect((failure as Error).message).toContain('one repair attempt');
    expect(repository.size()).toBe(0);

    // The accepted vocabulary is the only one: an unknown label never survives.
    expect(() => parseClassificationAnswer('{"category":"infrastructure","sentiment":"negative","urgency":"high"}')).toThrow(
      ProviderOutputError,
    );

    // A transport failure is typed and names the provider.
    const unreachable = new FakeLlmProvider([new ProviderError('ollama', 'connect ECONNREFUSED')]);
    const transportFailure = await enrichFeedback(
      { llm: unreachable, embedder: new FakeEmbeddingProvider(768), clock: fixedClock(TEST_NOW) },
      'Anything',
    ).catch((error: unknown) => error);
    expect(transportFailure).toBeInstanceOf(ProviderError);
    expect((transportFailure as Error).message).toContain('ollama');

    // A wrong-width embedding is rejected at the boundary, not silently stored.
    const dimensionFailure = await enrichFeedback(
      { llm: new FakeLlmProvider([VALID_ANSWER]), embedder: new WrongDimensionEmbeddingProvider(), clock: fixedClock(TEST_NOW) },
      'Anything',
    ).catch((error: unknown) => error);
    expect(dimensionFailure).toBeInstanceOf(ProviderOutputError);
    expect((dimensionFailure as Error).message).toContain('dimensions');

    // A run whose summary fails persists no partial run and no themes.
    const vectors = new InMemoryVectorStore();
    vectors.seed({ itemId: 'item-1', vector: makeVector(32, 1), meta: {}, createdAt: TEST_NOW });
    await repository.putItem(makeFeedbackItem({ id: 'item-1', createdAt: TEST_NOW }));
    const jobFailure = await runWeeklyClustering({
      repository,
      vectors,
      llm: new FakeLlmProvider(['   ']),
      clock: fixedClock(TEST_NOW),
      config: JOB_CONFIG,
    }).catch((error: unknown) => error);
    expect(jobFailure).toBeInstanceOf(ProviderOutputError);
    expect(await repository.listRuns(5)).toEqual([]);
  });
});
