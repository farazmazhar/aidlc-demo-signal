/**
 * Single-table key design for DynamoDB (`FR1.4`, `FR4.3`, `FR5.2`, `FR5.3`).
 *
 * One table holds three entity kinds, distinguished by the partition-key prefix:
 *
 * | Entity        | pk                        | sk     | GSIs populated             |
 * |---------------|---------------------------|--------|----------------------------|
 * | feedback item | `ITEM#<id>`               | `META` | urgency, category          |
 * | theme         | `THEME#<runId>#<themeId>` | `META` | theme                      |
 * | weekly run    | `RUN#<runId>`             | `META` | —                          |
 *
 * The GSIs are *sparse*: only items that carry the indexed attribute appear in
 * them, so themes and runs cost nothing in the urgency and category indexes.
 * Each GSI's partition-key attribute is named after the index itself
 * (`gsi_urgency_created`, …) and its sort key is always `createdAt`, descending,
 * which is what the dashboard's "newest first" access patterns need.
 *
 * `GSI_DEFINITIONS` is the single source shared by the CDK stack, `verify:infra`
 * and the unit tests, so the deployed table and the code can never drift apart.
 */

export const TABLE_PARTITION_KEY = 'pk';
export const TABLE_SORT_KEY = 'sk';

/** Sort-key value for the single record of an entity item collection. */
export const META_SORT_KEY = 'META';

export const CREATED_AT_ATTRIBUTE = 'createdAt';

/** Index over urgency, newest first — the dashboard's urgent-items panel (FR5.1). */
export const GSI_URGENCY_CREATED = 'gsi_urgency_created';
/** Index over category, newest first — the category filter (FR5.3). */
export const GSI_CATEGORY_CREATED = 'gsi_category_created';
/** Index over theme id — drill-down from a theme to its members (FR5.2). */
export const GSI_THEME_CREATED = 'gsi_theme_created';

export interface GsiDefinition {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey: string;
}

export const GSI_DEFINITIONS: readonly GsiDefinition[] = [
  { name: GSI_URGENCY_CREATED, partitionKey: GSI_URGENCY_CREATED, sortKey: CREATED_AT_ATTRIBUTE },
  { name: GSI_CATEGORY_CREATED, partitionKey: GSI_CATEGORY_CREATED, sortKey: CREATED_AT_ATTRIBUTE },
  { name: GSI_THEME_CREATED, partitionKey: GSI_THEME_CREATED, sortKey: CREATED_AT_ATTRIBUTE },
];

/**
 * Every attribute the table's key schema and indexes reference.
 *
 * DynamoDB rejects a table whose index keys are absent from
 * `AttributeDefinitions`, so the CDK stack and the emulator probe both build
 * their definitions from this list — the deployed table and the checks against
 * it cannot disagree.
 */
export const TABLE_ATTRIBUTE_DEFINITIONS: readonly { readonly name: string; readonly type: 'S' }[] = [
  { name: TABLE_PARTITION_KEY, type: 'S' },
  { name: TABLE_SORT_KEY, type: 'S' },
  { name: CREATED_AT_ATTRIBUTE, type: 'S' },
  ...GSI_DEFINITIONS.map((definition) => ({ name: definition.partitionKey, type: 'S' as const })),
];

export const ITEM_PREFIX = 'ITEM#';
export const THEME_PREFIX = 'THEME#';
export const RUN_PREFIX = 'RUN#';

export function itemPartitionKey(id: string): string {
  return `${ITEM_PREFIX}${id}`;
}

export function themePartitionKey(runId: string, themeId: string): string {
  return `${THEME_PREFIX}${runId}#${themeId}`;
}

export function runPartitionKey(runId: string): string {
  return `${RUN_PREFIX}${runId}`;
}
