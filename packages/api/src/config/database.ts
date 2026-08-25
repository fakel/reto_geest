import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getEnv } from './env';

/**
 * Prisma client singleton + factory (design §6.2).
 *
 * Prisma ORM v7 requires a driver adapter in the constructor (the schema
 * datasource no longer carries a URL). In production we point the adapter at a
 * real `pg` pool; in tests the setup installs a pg-mem-backed client via
 * `setPrismaClient`.
 */

/** Build a PrismaClient backed by a `pg`-compatible pool (real or pg-mem). */
export function createPrismaClient(pool: Pool): PrismaClient {
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/** Lazily-resolved application singleton using the real database. */
let singleton: PrismaClient | undefined;

/**
 * pg Pool options. RDS PostgreSQL requires SSL (`rds.force_ssl`); without it
 * the server rejects the connection ("no pg_hba.conf entry ... no encryption").
 * `rejectUnauthorized: false` is required for RDS's self-signed-style CA chain
 * (traffic is still encrypted). Tests inject their own pool/client.
 */
function buildPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

export function getPrisma(): PrismaClient {
  if (!singleton) {
    singleton = createPrismaClient(buildPool(getEnv().databaseUrl));
  }
  return singleton;
}

/** Install a client into the singleton (used by the pg-mem test setup). */
export function setPrismaClient(client: PrismaClient): PrismaClient {
  singleton = client;
  return client;
}

/** Disconnect and clear the singleton (used at teardown). */
export async function disconnectPrisma(): Promise<void> {
  if (!singleton) return;
  const client = singleton;
  singleton = undefined;
  await client.$disconnect();
}

// Re-export the type for DI/testing convenience.
export type { PrismaClient };