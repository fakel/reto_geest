import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../config/database';
import { ConflictError } from './errors';

/**
 * Idempotency service (US-12).
 *
 * The `IdempotencyKey.keyHash` column is globally `@unique` in the schema, so
 * to let the same client key be safely reused across different methods/paths
 * (per the T-12 test "different methods/paths with same key → processed
 * independently") the hash is scoped by `method + path + key`. `method` and
 * `path` are still stored on the row for the `(keyHash, method, path)` index.
 */

export interface IdempotencyDeps {
  prisma?: PrismaClient;
}

export interface CachedResponse {
  id: string;
  statusCode: number;
  body: unknown;
}

/** SHA-256 of `method|path|key` — the idempotency cache key. */
export function generateKeyHash(
  method: string,
  path: string,
  idempotencyKey: string,
): string {
  return createHash('sha256')
    .update(`${method}|${path}|${idempotencyKey}`)
    .digest('hex');
}

/**
 * Look up a non-expired cached response. Expired rows with the same key are
 * deleted so the key can be used again. Returns null when there is no usable
 * cached response.
 */
export async function findCachedResponse(
  keyHash: string,
  method: string,
  path: string,
  deps: IdempotencyDeps = {},
): Promise<CachedResponse | null> {
  const prisma = deps.prisma ?? getPrisma();
  const now = new Date();

  const rec = await prisma.idempotencyKey.findFirst({
    where: { keyHash, method, path },
  });
  if (!rec) return null;

  if (rec.expiresAt <= now) {
    await prisma.idempotencyKey.delete({ where: { id: rec.id } });
    return null;
  }

  let body: unknown = rec.responseBody;
  try {
    body = rec.responseBody ? JSON.parse(rec.responseBody) : null;
  } catch {
    body = rec.responseBody;
  }

  return { id: rec.id, statusCode: rec.responseStatus, body };
}

/**
 * Persist a cached response. Throws `IDEMPOTENCY_CONFLICT` (409) when the
 * `keyHash` already exists — which happens when two requests with the same key
 * race: one inserts, the concurrent one collides on the unique constraint.
 */
export async function storeResponse(
  id: string,
  keyHash: string,
  method: string,
  path: string,
  statusCode: number,
  body: string | unknown,
  ttlSeconds: number,
  deps: IdempotencyDeps = {},
): Promise<void> {
  const prisma = deps.prisma ?? getPrisma();
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    await prisma.idempotencyKey.create({
      data: { id, keyHash, method, path, responseStatus: statusCode, responseBody, expiresAt },
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'P2002' || /duplicate key|unique constraint/i.test(e.message ?? '')) {
      throw new ConflictError(
        'IDEMPOTENCY_CONFLICT',
        'A concurrent request with the same Idempotency-Key was already processed',
      );
    }
    throw err;
  }
}

/** Delete all expired idempotency records. Returns the number removed. */
export async function cleanupExpiredKeys(
  deps: IdempotencyDeps = {},
): Promise<number> {
  const prisma = deps.prisma ?? getPrisma();
  const res = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}