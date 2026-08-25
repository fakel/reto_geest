import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import schemaDDL from '../../api/prisma/schema.sql?raw';
import { PgMemDriverAdapter } from '../../api/tests/pg-mem-driver';
import { setPrisma } from '../src/index';

/**
 * Global Vitest setup for the worker package (T-16).
 *
 * Reuses the API's custom Prisma v7 driver adapter backed by pg-mem
 * (`packages/api/tests/pg-mem-driver.ts`) together with the shared Prisma DDL
 * (`packages/api/prisma/schema.sql`). The installed client is installed into
 * the worker's Prisma singleton via `setPrisma` so `handler()` can write
 * NotificationAttempt rows without a real database.
 */

const adapter = new PgMemDriverAdapter();

export const prisma: PrismaClient = new PrismaClient({ adapter });
setPrisma(prisma);

// Env vars the worker's config parser requires (env.ts).
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/test';
process.env.NOTIFY_URL = process.env.NOTIFY_URL || 'https://example.com/webhook';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

beforeAll(async () => {
  await adapter.executeScript(schemaDDL);
});

beforeEach(async () => {
  // Child tables first to satisfy FK constraints.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "notification_attempts" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "task_assignments" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "idempotency_keys" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "tasks" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});
