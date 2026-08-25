import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import schemaDDL from '../prisma/schema.sql?raw';
import { PgMemDriverAdapter } from './pg-mem-driver';
import { setPrismaClient } from '../src/config/database';

/**
 * Global Vitest setup (design §6.2).
 *
 * Uses a custom Prisma v7 driver adapter backed by pg-mem (`pg-mem-driver.ts`)
 * because the stock @prisma/adapter-pg is incompatible with pg-mem in Prisma v7
 * (see the adapter's module comment). Applies the Prisma DDL once and resets
 * all tables between tests. No real PostgreSQL/Docker is required.
 */

const adapter = new PgMemDriverAdapter();

// PrismaClient + pg-mem-backed adapter = the singleton helpers/services share.
export const prisma: PrismaClient = new PrismaClient({ adapter });
setPrismaClient(prisma);

/** 4. Push the schema into pg-mem once per test file. */
beforeAll(async () => {
  await adapter.executeScript(schemaDDL);
});

/** 5. Reset all tables between tests (child tables first to satisfy FKs). */
beforeEach(async () => {
  const tableNames = [
    'notification_attempts',
    'task_assignments',
    'idempotency_keys',
    'tasks',
    'users',
  ];
  for (const table of tableNames) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
});

/** 6. Clean up. */
afterAll(async () => {
  await prisma.$disconnect();
});