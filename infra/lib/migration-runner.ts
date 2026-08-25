// @ts-expect-error - esbuild text loader bundles *.sql as a default-exported string
import schemaSql from '../../packages/api/prisma/schema.sql';
import { Client } from 'pg';

/**
 * One-shot RDS schema migration runner (custom resource handler).
 *
 * Applies the canonical DDL (`packages/api/prisma/schema.sql`) to the deployed
 * RDS instance right after it is created. The CDK `custom-resources.Provider`
 * wrapper calls this handler; returning normally = success, throwing = the
 * deployment fails and rolls back.
 *
 * Retries the connection briefly, because RDS may not accept connections the
 * instant its CloudFormation resource reports CREATE_COMPLETE.
 *
 * Only the CREATE path applies the schema; UPDATE/DELETE are no-ops (we never
 * drop tables).
 */

const SCHEMA_SQL: string =
  typeof schemaSql === 'string' ? schemaSql : (schemaSql as { default: string }).default;

const MAX_ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;

interface EventPayload {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
}

async function applySchemaWithRetry(connectionString: string): Promise<void> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 20_000,
      // RDS requires SSL (`rds.force_ssl`); rejectUnauthorized:false keeps it
      // encrypted while accepting RDS's CA chain.
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      await client.query(SCHEMA_SQL);
      return;
    } catch (err) {
      lastErr = err as Error;
      console.log(`schema migration attempt ${attempt} failed: ${(err as Error).message}`);
    } finally {
      await client.end().catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  throw new Error(
    `Schema migration failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`,
  );
}

export async function handler(
  event: EventPayload,
): Promise<{ PhysicalResourceId: string; Data: Record<string, never> }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  if (event.RequestType === 'Update' || event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'schema', Data: {} };
  }

  await applySchemaWithRetry(url);
  return { PhysicalResourceId: event.PhysicalResourceId ?? 'schema', Data: {} };
}