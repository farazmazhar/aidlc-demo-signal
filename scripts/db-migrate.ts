/**
 * `bun run db:migrate` — apply the rendered pgvector schema and report what it did.
 *
 * Reads the schema from configuration (FR6.2/FR7.2), executes each statement,
 * then verifies the extension, the table's vector width and both indexes before
 * exiting. Any Postgres failure is surfaced with the failing statement and exits
 * non-zero — never a silent skip.
 */

import { Client } from 'pg';

import { loadConfig } from '../src/config/config';
import { renderSchema, splitStatements } from '../src/persistence/pg-schema';

interface VerificationRow {
  readonly check_name: string;
  readonly result: string;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const sql = renderSchema(config);
  const statements = splitStatements(sql);

  console.log(`[db:migrate] target database: ${redact(config.databaseUrl)}`);
  console.log(`[db:migrate] embedding dimensions: ${config.embeddingDimensions}`);
  console.log(`[db:migrate] statements to apply: ${statements.length}`);

  const client = new Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
  } catch (error) {
    console.error(
      `[db:migrate] FAILED to connect to Postgres at ${redact(config.databaseUrl)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    console.error('[db:migrate] start the containers first: bun run emulator:up');
    process.exitCode = 1;
    return;
  }

  try {
    for (const statement of statements) {
      const label = statement.split('\n')[0]?.slice(0, 72) ?? statement.slice(0, 72);
      await client.query(statement);
      console.log(`[db:migrate] applied: ${label}`);
    }

    const { rows } = await client.query<VerificationRow>(`
      SELECT 'extension:vector' AS check_name,
             COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'vector'), 'MISSING') AS result
      UNION ALL
      SELECT 'column:feedback_vectors.embedding',
             COALESCE((
               SELECT format_type(a.atttypid, a.atttypmod)
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               WHERE c.relname = 'feedback_vectors' AND a.attname = 'embedding' AND a.attnum > 0
             ), 'MISSING')
      UNION ALL
      SELECT 'index:feedback_vectors_embedding_idx',
             COALESCE((SELECT indexdef FROM pg_indexes WHERE indexname = 'feedback_vectors_embedding_idx'), 'MISSING')
      UNION ALL
      SELECT 'index:feedback_vectors_created_at_idx',
             COALESCE((SELECT indexdef FROM pg_indexes WHERE indexname = 'feedback_vectors_created_at_idx'), 'MISSING')
    `);

    console.log('[db:migrate] verification:');
    let failed = false;
    for (const row of rows) {
      const missing = row.result === 'MISSING';
      if (missing) {
        failed = true;
      }
      console.log(`[db:migrate]   ${missing ? 'FAIL' : 'ok  '} ${row.check_name} = ${row.result}`);
    }

    const expectedWidth = `vector(${config.embeddingDimensions})`;
    const widthRow = rows.find((row) => row.check_name === 'column:feedback_vectors.embedding');
    if (widthRow && widthRow.result !== expectedWidth) {
      failed = true;
      console.error(
        `[db:migrate]   FAIL embedding column is ${widthRow.result}, expected ${expectedWidth} for EMBEDDING_DIMENSIONS=${config.embeddingDimensions} (drop the table or align the configuration).`,
      );
    }

    if (failed) {
      process.exitCode = 1;
      console.error('[db:migrate] verification failed — see FAIL lines above.');
    } else {
      console.log('[db:migrate] done: extension, table and indexes verified.');
    }
  } catch (error) {
    console.error(`[db:migrate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Never print a password, even for a local spike database. */
function redact(databaseUrl: string): string {
  return databaseUrl.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@');
}

void main();
