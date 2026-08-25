import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';
import { prisma } from './setup';
import { generateKeyHash } from '../src/services/idempotency.service';

function postUser(
  app: FastifyInstance,
  key: string | undefined,
  email?: string,
) {
  return app.inject({
    method: 'POST',
    url: '/users',
    headers: key ? { 'idempotency-key': key } : undefined,
    payload: {
      name: 'Idem',
      lastName: 'User',
      email: email ?? `idem-${Math.random().toString(36).slice(2)}@example.com`,
    },
  });
}

describe('US-12: idempotency plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST with Idempotency-Key → 201, second identical request returns the cached response', async () => {
    const key = 'createl-user-key';

    const first = await postUser(app, key, 'dup1@example.com');
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    // First request is persisted in the idempotency table.
    expect(await prisma.idempotencyKey.count()).toBe(1);

    const second = await postUser(app, key, 'dup1@example.com');
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(firstBody);

    // Only one user was created (the second was served from cache).
    const users = await prisma.user.findMany({ where: { email: 'dup1@example.com' } });
    expect(users).toHaveLength(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it('POST with a different Idempotency-Key processes normally (new record)', async () => {
    const r1 = await postUser(app, 'key-a', 'a@example.com');
    const r2 = await postUser(app, 'key-b', 'b@example.com');

    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().id).not.toBe(r2.json().id);
    expect(await prisma.idempotencyKey.count()).toBe(2);
  });

  it('POST without an Idempotency-Key processes normally', async () => {
    const res = await postUser(app, undefined, 'nokey@example.com');
    expect(res.statusCode).toBe(201);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it('concurrent requests with the same key → one succeeds, the other gets 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = 'concurrent-key';
    const run = () => postUser(app, key, `concurrent@example.com`);

    const results = await Promise.all([run(), run()]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);

    const conflict = results.find((r) => r.statusCode === 409)!;
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await prisma.idempotencyKey.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it('an expired idempotency key creates a new record on the next request', async () => {
    const key = 'expired-key';
    const keyHash = generateKeyHash('POST', '/users', key);

    // Pre-seed an expired row for this key.
    await prisma.idempotencyKey.create({
      data: {
        id: '00000000-0000-4000-8000-000000000000',
        keyHash,
        method: 'POST',
        path: '/users',
        responseStatus: 201,
        responseBody: '{}',
        createdAt: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await postUser(app, key, 'expired@example.com');
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();

    // The expired row was removed and a fresh one stored.
    const rows = await prisma.idempotencyKey.findMany({ where: { keyHash } });
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('different methods/paths with the same key are processed independently', async () => {
    const key = 'shared-key';

    const u = await postUser(app, key, 'path@example.com');
    expect(u.statusCode).toBe(201);

    // Same key on a different path (POST /tasks) → independent keyHash.
    const task = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'idempotency-key': key },
      payload: { title: 'Independent task' },
    });
    expect(task.statusCode).toBe(201);

    expect(await prisma.idempotencyKey.count()).toBe(2);
  });

  it('POST /admin/idempotency/cleanup purges expired keys and reports the count', async () => {
    const expiredHash = generateKeyHash('POST', '/users', 'expired-sweep');
    await prisma.idempotencyKey.create({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        keyHash: expiredHash,
        method: 'POST',
        path: '/users',
        responseStatus: 201,
        responseBody: '{}',
        createdAt: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    // A non-expired key that must survive the sweep.
    const liveKey = generateKeyHash('POST', '/users', 'live-sweep');
    await prisma.idempotencyKey.create({
      data: {
        id: '00000000-0000-4000-8000-000000000002',
        keyHash: liveKey,
        method: 'POST',
        path: '/users',
        responseStatus: 201,
        responseBody: '{}',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/idempotency/cleanup',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 1 });

    expect(await prisma.idempotencyKey.count()).toBe(1); // only the live key remains
    expect(await prisma.idempotencyKey.findUnique({ where: { id: '00000000-0000-4000-8000-000000000002' } })).not.toBeNull();
  });
});