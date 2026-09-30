/**
 * T4–T6 — repository / data access.
 *
 * T4 happy: an item round-trips through the repository port with its
 *           classification intact, the DynamoDB marshalling preserves it too,
 *           and a repeated vector upsert for one item is idempotent.
 * T5 edge:  the access patterns the dashboard depends on — newest-first urgent
 *           items, category filtering and theme membership — including the index
 *           each real adapter query actually targets.
 * T6 error: an unknown identifier raises a typed not-found error, never
 *           `undefined`, and decoding cannot confuse one entity for another.
 */

import { describe, expect, test } from 'bun:test';

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { NotFoundError, ValidationError } from '../domain/ports';
import type { FeedbackItem } from '../domain/types';
import {
  DynamoFeedbackRepository,
  decodeItem,
  encodeItem,
} from './dynamo-repository';
import { InMemoryFeedbackRepository, InMemoryVectorStore } from './in-memory';
import {
  GSI_CATEGORY_CREATED,
  GSI_URGENCY_CREATED,
  GSI_THEME_CREATED,
} from './dynamo-keys';
import {
  makeClassification,
  makeFeedbackItem,
  makeTheme,
  makeVector,
  makeVectorRecord,
  plantCluster,
} from '../../tests/factories';

/** Captures the commands a real adapter would send, without a network. */
function recordingClient(): { client: DynamoDBDocumentClient; inputs: Record<string, unknown>[] } {
  const inputs: Record<string, unknown>[] = [];
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      inputs.push(command.input);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, inputs };
}

describe('repository and data access', () => {
  test('T4 item round-trip preserves classification and vector upsert is idempotent', async () => {
    const repository = new InMemoryFeedbackRepository();
    const item = makeFeedbackItem({
      id: 'item-42',
      submitter_email: 'tester@example.com',
      product_area: 'checkout',
      classification: makeClassification({ category: 'performance', sentiment: 'negative', urgency: 'high' }),
    });

    await repository.putItem(item);
    const loaded = await repository.getItemById('item-42');

    expect(loaded).toEqual(item);
    expect(loaded.classification).toEqual({
      category: 'performance',
      sentiment: 'negative',
      urgency: 'high',
    });

    // The DynamoDB marshalling is what the emulator will read back, so the same
    // round-trip is asserted on the adapter's own encode/decode pair.
    const encoded = encodeItem(item);
    expect(encoded.gsi_urgency_created).toBe('high');
    expect(encoded.gsi_category_created).toBe('performance');
    expect(decodeItem(encoded)).toEqual(item);

    // A re-submitted item keeps one vector keyed by item id (FR3.2).
    const vectors = new InMemoryVectorStore();
    await vectors.upsert('item-42', makeVector(8, 1), { source: 'api' });
    await vectors.upsert('item-42', makeVector(8, 2), { source: 'api' });

    expect(vectors.size()).toBe(1);
    const stored = await vectors.querySimilar(makeVector(8, 2), 10);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.itemId).toBe('item-42');
    expect(stored[0]?.vector).toEqual(makeVector(8, 2));
    expect(stored[0]?.meta).toEqual({ source: 'api' });
  });

  test('T5 dashboard access patterns: urgent newest-first, category filter, theme membership', async () => {
    const repository = new InMemoryFeedbackRepository();
    const older: FeedbackItem = makeFeedbackItem({
      id: 'item-old',
      createdAt: '2026-09-20T09:00:00.000Z',
      classification: makeClassification({ urgency: 'high', category: 'bug' }),
    });
    const newer: FeedbackItem = makeFeedbackItem({
      id: 'item-new',
      createdAt: '2026-09-27T09:00:00.000Z',
      classification: makeClassification({ urgency: 'high', category: 'pricing' }),
    });
    const calm: FeedbackItem = makeFeedbackItem({
      id: 'item-calm',
      createdAt: '2026-09-28T09:00:00.000Z',
      classification: makeClassification({ urgency: 'low', category: 'bug' }),
    });
    for (const item of [older, newer, calm]) {
      await repository.putItem(item);
    }

    const urgent = await repository.queryUrgent(10);
    expect(urgent.map((item) => item.id)).toEqual(['item-new', 'item-old']);
    expect(urgent.every((item) => item.classification.urgency === 'high')).toBe(true);

    const bugs = await repository.queryByCategory('bug', 10);
    expect(bugs.map((item) => item.id)).toEqual(['item-calm', 'item-old']);

    // Drill-down: the theme names its members, and each member is retrievable.
    await repository.putTheme(
      makeTheme({ id: 'theme-checkout', runId: 'run-1', memberIds: ['item-new', 'item-old'] }),
    );
    const themes = await repository.queryByTheme('theme-checkout', 10);
    expect(themes).toHaveLength(1);
    expect(themes[0]?.memberIds).toEqual(['item-new', 'item-old']);
    const members = await Promise.all(themes[0]!.memberIds.map((id) => repository.getItemById(id)));
    expect(members.map((member) => member.id)).toEqual(['item-new', 'item-old']);
    expect(await repository.listThemes('run-1')).toHaveLength(1);
    expect(await repository.listThemes('run-unknown')).toEqual([]);

    // The real adapter queries the intended index, newest first.
    const { client, inputs } = recordingClient();
    const adapter = new DynamoFeedbackRepository({
      tableName: 'signal-feedback',
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      documentClient: client,
    });
    await adapter.queryUrgent(5);
    expect(inputs[0]?.IndexName).toBe(GSI_URGENCY_CREATED);
    expect(inputs[0]?.ScanIndexForward).toBe(false);
    await adapter.queryByCategory('usability', 5);
    expect(inputs[1]?.IndexName).toBe(GSI_CATEGORY_CREATED);
    await adapter.queryByTheme('theme-checkout', 5);
    expect(inputs[2]?.IndexName).toBe(GSI_THEME_CREATED);

    // Planted vectors agree with the store's similarity ordering.
    const vectors = new InMemoryVectorStore();
    const planted = await plantCluster(vectors, { count: 3, dimensions: 8, seed: 11, prefix: 'cluster' });
    expect(planted).toEqual(['cluster-1', 'cluster-2', 'cluster-3']);
    const similar = await vectors.querySimilar(makeVector(8, 11), 2);
    expect(similar[0]?.itemId).toBe('cluster-1');
  });

  test('T6 unknown identifier raises a typed not-found error', async () => {
    const repository = new InMemoryFeedbackRepository();
    const failure = await repository.getItemById('does-not-exist').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotFoundError);
    expect((failure as NotFoundError).name).toBe('NotFoundError');
    expect((failure as NotFoundError).id).toBe('does-not-exist');
    expect((failure as Error).message).toContain('does-not-exist');

    // Entities cannot be confused, and a truncated record is not readable as one.
    expect(decodeItem({ entityType: 'theme', id: 'theme-1' })).toBeNull();
    expect(decodeItem(encodeItem(makeFeedbackItem()))).not.toBeNull();
    expect(decodeItem({ ...encodeItem(makeFeedbackItem()), category: undefined })).toBeNull();

    // A malformed similarity query is a boundary error, not a silent empty list.
    const vectors = new InMemoryVectorStore();
    vectors.seed(makeVectorRecord());
    await expect(vectors.querySimilar([], 1)).rejects.toThrow(ValidationError);
  });
});
