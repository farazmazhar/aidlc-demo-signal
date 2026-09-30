/**
 * Renders the pgvector migration from configuration (FR7.2).
 *
 * `db/migrations/001_init.sql` is the canonical template; this module fills its
 * single placeholder with the configured `EMBEDDING_DIMENSIONS` so the vector
 * column width always matches the selected embedding model. Switching
 * `EMBEDDING_PROVIDER`/`EMBEDDING_DIMENSIONS` in `config/config.env` therefore
 * changes the rendered schema with no code change (FR6.1, FR6.2).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../config/config';

export const EMBEDDING_DIMENSIONS_PLACEHOLDER = '{{EMBEDDING_DIMENSIONS}}';

/** Host scripts run from the workspace root, so this default is stable for them. */
export const DEFAULT_MIGRATION_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'db',
  'migrations',
  '001_init.sql',
);

/** Substitute the configured vector width into the canonical template. */
export function renderMigrationSql(template: string, embeddingDimensions: number): string {
  if (template.split(EMBEDDING_DIMENSIONS_PLACEHOLDER).length - 1 !== 1) {
    throw new Error(
      `Migration template must contain exactly one ${EMBEDDING_DIMENSIONS_PLACEHOLDER} placeholder.`,
    );
  }
  return template.replace(EMBEDDING_DIMENSIONS_PLACEHOLDER, String(embeddingDimensions));
}

export function readMigrationTemplate(
  templatePath: string = DEFAULT_MIGRATION_TEMPLATE_PATH,
): string {
  return readFileSync(templatePath, 'utf8');
}

/** Render the migration SQL for a resolved configuration. */
export function renderSchema(config: Pick<Config, 'embeddingDimensions'>, templatePath?: string): string {
  return renderMigrationSql(readMigrationTemplate(templatePath), config.embeddingDimensions);
}

/**
 * Split rendered SQL into executable statements.
 *
 * The template deliberately contains no semicolons inside literals, so a comment
 * strip followed by a semicolon split is exact and keeps `db:migrate` output
 * readable (one log line per statement).
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
