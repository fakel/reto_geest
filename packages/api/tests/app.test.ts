import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { randomUUID } from 'node:crypto';

// The module-level `prisma` (pg-mem) shared by services is reset between each
// test by the global `tests/setup.ts`.

/**
 * T-14 smoke test: `buildApp()` must return a fully-wired instance and the
 * complete happy-path workflow (create users → create task → assign → complete)
 * must work through the real factory, exactly as it will in production/Lambda.
 */

async function jsonInject(app: FastifyInstance, opts: {
  method: 'GET' | 'POST';
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}) {
  const res = await app.inject({
    method: opts.method,
    url: opts.url,
    headers: { 'content-type': 'application/json', ...opts.headers },
    payload: opts.payload === undefined ? undefined : JSON.stringify(opts.payload),
  });
  const body = JSON.parse(res.body);
  return { res, body };
}

describe('App factory (T-14)', () => {
  let app: FastifyInstance;
  let sendSpy: ReturnType<typeof vi.fn>;

  const ROUTES_TO_EXPECT = [
    'POST /users',
    'GET /users',
    'GET /users/:idUser/tasks',
    'POST /tasks',
    'GET /tasks',
    'GET /tasks/:idTask',
    'POST /tasks/:idTask/assign',
    'POST /tasks/:idTask/complete',
    'GET /tasks/:idTask/notifications',
    'POST /admin/idempotency/cleanup',
  ];

  beforeEach(async () => {
    sendSpy = vi.fn().mockResolvedValue({ MessageId: `msg-${randomUUID()}` });
    app = await buildApp({
      logger: false,
      sqs: { sendMessage: sendSpy },
    });
  });

  it('registers all 10 documented routes', async () => {
    for (const [method, url] of ROUTES_TO_EXPECT.map((r) => r.split(' '))) {
      expect(app.hasRoute({ method: method as 'GET' | 'POST', url })).toBe(true);
    }
    // Health route is present too.
    expect(app.hasRoute({ method: 'GET', url: '/health' })).toBe(true);
  });

  it('returns a healthy instance that responds to requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('runs the full happy-path workflow end to end', async () => {
    // 1. Create two users.
    const u1 = await jsonInject(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'Ana', lastName: 'Perez', email: 'ana@example.com' },
    });
    const u2 = await jsonInject(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'Luis', lastName: 'Gomez', email: 'luis@example.com' },
    });
    expect(u1.res.statusCode).toBe(201);
    expect(u2.res.statusCode).toBe(201);

    // 2. Create a task.
    const task = await jsonInject(app, {
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Tarea T-14' },
    });
    expect(task.res.statusCode).toBe(201);
    const taskId = task.body.id as string;

    // 3. Assign both users.
    const assign = await jsonInject(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [u1.body.id, u2.body.id] },
    });
    expect(assign.res.statusCode).toBe(200);

    // 4. Complete user 1 → not archived yet.
    const c1 = await jsonInject(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: u1.body.id },
    });
    expect(c1.res.statusCode).toBe(200);
    expect(c1.body.archived).toBe(false);

    // 5. Complete user 2 (last) → archived + SQS notification sent.
    const c2 = await jsonInject(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: u2.body.id },
    });
    expect(c2.res.statusCode).toBe(200);
    expect(c2.body.archived).toBe(true);

    // 6. Task is now archived.
    const detail = await jsonInject(app, { method: 'GET', url: `/tasks/${taskId}` });
    expect(detail.res.statusCode).toBe(200);
    expect(detail.body.status).toBe('archived');

    // 7. Notifications endpoint reflects an attempt was queued.
    const notif = await jsonInject(app, {
      method: 'GET',
      url: `/tasks/${taskId}/notifications`,
    });
    expect(notif.res.statusCode).toBe(200);

    // 8. The SQS mock was invoked exactly once (on the archive).
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendSpy.mock.calls[0][0].MessageBody as string);
    expect(payload.taskId).toBe(taskId);
    expect(payload.status).toBe('archived');
  });
});