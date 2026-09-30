/**
 * DynamoDB adapter for `FeedbackRepository`.
 *
 * One table, one item collection per entity, three sparse GSIs (see
 * `dynamo-keys.ts` for the design and its rationale). Endpoint and region come
 * from configuration so the same code targets the emulator (FR7.1/NFR1).
 *
 * `listRuns` and `listThemes` use a bounded `Scan`: the approved single-table
 * key design puts every run and every theme in its own partition, and DynamoDB
 * cannot Query across partitions. The spike's cardinality is a handful of weekly
 * runs and a few themes per run, and NFR4 explicitly waives scale, so the
 * cheapest correct read wins over a second index.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { NotFoundError } from '../domain/ports';
import type { FeedbackRepository } from '../domain/ports';
import type { Category, FeedbackItem, Theme, Urgency, WeeklyRun } from '../domain/types';
import {
  CREATED_AT_ATTRIBUTE,
  GSI_CATEGORY_CREATED,
  GSI_THEME_CREATED,
  GSI_URGENCY_CREATED,
  META_SORT_KEY,
  RUN_PREFIX,
  TABLE_PARTITION_KEY,
  TABLE_SORT_KEY,
  THEME_PREFIX,
  itemPartitionKey,
  runPartitionKey,
  themePartitionKey,
} from './dynamo-keys';

export interface DynamoRepositoryOptions {
  readonly tableName: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly documentClient?: DynamoDBDocumentClient;
}

type Attributes = Record<string, unknown>;

function readString(attributes: Attributes, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(attributes: Attributes, key: string, fallback: number): number {
  const value = attributes[key];
  return typeof value === 'number' ? value : fallback;
}

function readStringArray(attributes: Attributes, key: string): string[] {
  const value = attributes[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Encode a feedback item, including its sparse GSI projections. */
export function encodeItem(item: FeedbackItem): Attributes {
  return {
    [TABLE_PARTITION_KEY]: itemPartitionKey(item.id),
    [TABLE_SORT_KEY]: META_SORT_KEY,
    entityType: 'item',
    id: item.id,
    source: item.source,
    text: item.text,
    [CREATED_AT_ATTRIBUTE]: item.createdAt,
    category: item.classification.category,
    sentiment: item.classification.sentiment,
    urgency: item.classification.urgency,
    // Sparse GSI projections: only items carry these, so themes and runs stay
    // out of the urgency and category indexes.
    [GSI_URGENCY_CREATED]: item.classification.urgency,
    [GSI_CATEGORY_CREATED]: item.classification.category,
    schemaVersion: item.schemaVersion,
    submitter_email: item.submitter_email,
    product_area: item.product_area,
  };
}

export function encodeTheme(theme: Theme): Attributes {
  return {
    [TABLE_PARTITION_KEY]: themePartitionKey(theme.runId, theme.id),
    [TABLE_SORT_KEY]: META_SORT_KEY,
    entityType: 'theme',
    id: theme.id,
    runId: theme.runId,
    label: theme.label,
    summary: theme.summary,
    memberIds: theme.memberIds,
    [CREATED_AT_ATTRIBUTE]: theme.createdAt,
    [GSI_THEME_CREATED]: theme.id,
  };
}

export function encodeRun(run: WeeklyRun): Attributes {
  return {
    [TABLE_PARTITION_KEY]: runPartitionKey(run.id),
    [TABLE_SORT_KEY]: META_SORT_KEY,
    entityType: 'run',
    id: run.id,
    ranAt: run.ranAt,
    windowStart: run.windowStart,
    itemCount: run.itemCount,
    themeCount: run.themeCount,
    summary: run.summary,
  };
}

/**
 * Decode a stored item. Returns `null` for a record that is not a feedback item
 * (a theme, a run) so a caller cannot mistake one entity for another.
 */
export function decodeItem(attributes: Attributes): FeedbackItem | null {
  if (attributes.entityType !== 'item') {
    return null;
  }
  const id = readString(attributes, 'id');
  const text = readString(attributes, 'text');
  const createdAt = readString(attributes, CREATED_AT_ATTRIBUTE);
  const category = readString(attributes, 'category');
  const sentiment = readString(attributes, 'sentiment');
  const urgency = readString(attributes, 'urgency');
  const source = readString(attributes, 'source');
  if (!id || text === undefined || !createdAt || !category || !sentiment || !urgency || !source) {
    return null;
  }
  return {
    id,
    source: source === 'web' ? 'web' : 'api',
    text,
    ...(readString(attributes, 'submitter_email')
      ? { submitter_email: readString(attributes, 'submitter_email') as string }
      : {}),
    ...(readString(attributes, 'product_area')
      ? { product_area: readString(attributes, 'product_area') as string }
      : {}),
    createdAt,
    classification: {
      category: category as Category,
      sentiment: sentiment as FeedbackItem['classification']['sentiment'],
      urgency: urgency as Urgency,
    },
    schemaVersion: readNumber(attributes, 'schemaVersion', 0),
  };
}

export function decodeTheme(attributes: Attributes): Theme | null {
  if (attributes.entityType !== 'theme') {
    return null;
  }
  const id = readString(attributes, 'id');
  const runId = readString(attributes, 'runId');
  const label = readString(attributes, 'label');
  const summary = readString(attributes, 'summary');
  const createdAt = readString(attributes, CREATED_AT_ATTRIBUTE);
  if (!id || !runId || label === undefined || summary === undefined || !createdAt) {
    return null;
  }
  return { id, runId, label, summary, memberIds: readStringArray(attributes, 'memberIds'), createdAt };
}

export function decodeRun(attributes: Attributes): WeeklyRun | null {
  if (attributes.entityType !== 'run') {
    return null;
  }
  const id = readString(attributes, 'id');
  const ranAt = readString(attributes, 'ranAt');
  const windowStart = readString(attributes, 'windowStart');
  const summary = readString(attributes, 'summary');
  if (!id || !ranAt || !windowStart || summary === undefined) {
    return null;
  }
  return {
    id,
    ranAt,
    windowStart,
    summary,
    itemCount: readNumber(attributes, 'itemCount', 0),
    themeCount: readNumber(attributes, 'themeCount', 0),
  };
}

export class DynamoFeedbackRepository implements FeedbackRepository {
  private readonly tableName: string;
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(options: DynamoRepositoryOptions) {
    this.tableName = options.tableName;
    this.documentClient =
      options.documentClient ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({
          region: options.region,
          ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        }),
        { marshallOptions: { removeUndefinedValues: true } },
      );
  }

  async putItem(item: FeedbackItem): Promise<void> {
    await this.documentClient.send(
      new PutCommand({ TableName: this.tableName, Item: encodeItem(item) }),
    );
  }

  async getItemById(id: string): Promise<FeedbackItem> {
    const { Item } = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { [TABLE_PARTITION_KEY]: itemPartitionKey(id), [TABLE_SORT_KEY]: META_SORT_KEY },
      }),
    );
    const item = Item ? decodeItem(Item) : null;
    if (!item) {
      throw new NotFoundError('FeedbackItem', id);
    }
    return item;
  }

  async queryUrgent(limit: number, urgency: Urgency = 'high'): Promise<FeedbackItem[]> {
    return this.queryItemsByIndex(GSI_URGENCY_CREATED, urgency, limit);
  }

  async queryByCategory(category: Category, limit: number): Promise<FeedbackItem[]> {
    return this.queryItemsByIndex(GSI_CATEGORY_CREATED, category, limit);
  }

  async queryByTheme(themeId: string, limit: number): Promise<Theme[]> {
    const { Items } = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI_THEME_CREATED,
        KeyConditionExpression: '#partition = :value',
        ExpressionAttributeNames: { '#partition': GSI_THEME_CREATED },
        ExpressionAttributeValues: { ':value': themeId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (Items ?? [])
      .map((attributes) => decodeTheme(attributes as Attributes))
      .filter((theme): theme is Theme => theme !== null);
  }

  async putTheme(theme: Theme): Promise<void> {
    await this.documentClient.send(
      new PutCommand({ TableName: this.tableName, Item: encodeTheme(theme) }),
    );
  }

  async putRun(run: WeeklyRun): Promise<void> {
    await this.documentClient.send(
      new PutCommand({ TableName: this.tableName, Item: encodeRun(run) }),
    );
  }

  async listRuns(limit: number): Promise<WeeklyRun[]> {
    const { Items } = await this.documentClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(#partition, :prefix)',
        ExpressionAttributeNames: { '#partition': TABLE_PARTITION_KEY },
        ExpressionAttributeValues: { ':prefix': RUN_PREFIX },
      }),
    );
    return (Items ?? [])
      .map((attributes) => decodeRun(attributes as Attributes))
      .filter((run): run is WeeklyRun => run !== null)
      .sort((left, right) => right.ranAt.localeCompare(left.ranAt))
      .slice(0, limit);
  }

  async listThemes(runId: string): Promise<Theme[]> {
    const { Items } = await this.documentClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'begins_with(#partition, :prefix)',
        ExpressionAttributeNames: { '#partition': TABLE_PARTITION_KEY },
        ExpressionAttributeValues: { ':prefix': `${THEME_PREFIX}${runId}#` },
      }),
    );
    return (Items ?? [])
      .map((attributes) => decodeTheme(attributes as Attributes))
      .filter((theme): theme is Theme => theme !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async queryItemsByIndex(
    indexName: string,
    value: string,
    limit: number,
  ): Promise<FeedbackItem[]> {
    const { Items } = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: '#partition = :value',
        ExpressionAttributeNames: { '#partition': indexName },
        ExpressionAttributeValues: { ':value': value },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (Items ?? [])
      .map((attributes) => decodeItem(attributes as Attributes))
      .filter((item): item is FeedbackItem => item !== null);
  }
}
