import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers';

/**
 * T-18: End-to-end full workflow.
 *
 * Drives the real app factory (`buildApp`) entirely over HTTP via
 * `app.inject()`, exercising the complete business flow the way a client would:
 *   users → task → assignment → completion → auto-archive → notification.
 * Also covers the main regressions (archived rejection, duplicate assignment,
 * duplicate completion). pg-mem backs Prisma; SQS is the factory's mock.
 */

const NO_ID = '00000000-0000-4000-8000-000000000000';

interface JsonResult {
  status: number;
  body: Record<string, unknown>;
}

async function json(
  app: FastifyInstance,
  opts: {
    method: 'GET' | 'POST';
    url: string;
    payload?: unknown;
  },
): Promise<JsonResult> {
  const res = await app.inject({
    method: opts.method,
    url: opts.url,
    headers: { 'content-type': 'application/json' },
    payload: opts.payload === undefined ? undefined : JSON.stringify(opts.payload),
  });
  return { status: res.statusCode, body: res.json() };
}

describe('T-18: Full workflow (E2E)', () => {
  let app: FastifyInstance;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendSpy = vi.fn().mockResolvedValue({ MessageId: 'mock-e2e' });
    app = await buildTestApp();
    // Swap the SQS sender with a spy so we can assert the notification enqueue.
    (app as unknown as { sqs: { sendMessage: unknown } }).sqs.sendMessage = sendSpy;
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the complete happy path end to end', async () => {
    // 1. Create two users.
    const u1 = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'Ana', lastName: 'Perez', email: 'ana@example.com' },
    });
    const u2 = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'Luis', lastName: 'Gomez', email: 'luis@example.com' },
    });
    expect(u1.status).toBe(201);
    expect(u2.status).toBe(201);
    expect(u1.body.id).toBeTruthy();
    expect(u2.body.id).toBeTruthy();
    const [u1Id, u2Id] = [u1.body.id as string, u2.body.id as string];

    // 2. Create a task (defaults to open, version 0).
    const task = await json(app, {
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Tarea E2E' },
    });
    expect(task.status).toBe(201);
    const taskId = task.body.id as string;
    expect(task.body.status).toBe('open');
    expect(task.body.version).toBe(0);

    // 3. Assign both users.
    const assign = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [u1Id, u2Id] },
    });
    expect(assign.status).toBe(200);
    expect(assign.body).toHaveLength(2);

    // 4. User 1 completes → not archived yet, no SQS send.
    const c1 = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: u1Id },
    });
    expect(c1.status).toBe(200);
    expect(c1.body).toEqual({ archived: false });
    expect(sendSpy).not.toHaveBeenCalled();

    // 5. User 2 completes (last) → archived + SQS notification enqueued.
    const c2 = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: u2Id },
    });
    expect(c2.status).toBe(200);
    expect(c2.body).toEqual({ archived: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendSpy.mock.calls[0][0].MessageBody as string);
    expect(sent).toMatchObject({ taskId, title: 'Tarea E2E', status: 'archived' });

    // 6. Task is now archived with version bumped.
    const detail = await json(app, { method: 'GET', url: `/tasks/${taskId}` });
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('archived');
    expect(detail.body.version).toBe(1);

    // 7. Notifications endpoint reachable (worker not run, so empty).
    const notif = await json(app, {
      method: 'GET',
      url: `/tasks/${taskId}/notifications`,
    });
    expect(notif.status).toBe(200);
    expect(notif.body).toEqual([]);
  });

  it('rejects completion of an already archived task (409)', async () => {
    const user = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'X', lastName: 'Y', email: 'xy@example.com' },
    });
    const task = await json(app, {
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Already done' },
    });
    const taskId = task.body.id as string;
    await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [user.body.id] },
    });
    await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: user.body.id },
    });

    // Second completion attempt → already archived.
    const res = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: user.body.id },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'TASK_ALREADY_ARCHIVED' } });
  });

  it('rejects a duplicate assignment of the same user (409)', async () => {
    const user = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'D', lastName: 'E', email: 'de@example.com' },
    });
    const task = await json(app, {
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Dup' },
    });
    const taskId = task.body.id as string;

    await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [user.body.id] },
    });

    const res = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [user.body.id] },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'USER_ALREADY_ASSIGNED' } });
  });

  it('rejects completing a task twice by the same user (409)', async () => {
    const user = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'R', lastName: 'R', email: 'rr@example.com' },
    });
    const other = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'O', lastName: 'O', email: 'oo@example.com' },
    });
    const task = await json(app, {
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Repeat' },
    });
    const taskId = task.body.id as string;

    // Two users so the task stays open after the first completion.
    await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [user.body.id, other.body.id] },
    });
    const first = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: user.body.id },
    });
    expect(first.body).toEqual({ archived: false });

    const second = await json(app, {
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId: user.body.id },
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'ALREADY_COMPLETED' } });
  });

  it('returns 404 when completing a non-existent task', async () => {
    const user = await json(app, {
      method: 'POST',
      url: '/users',
      payload: { name: 'N', lastName: 'F', email: 'nf@example.com' },
    });
    const res = await json(app, {
      method: 'POST',
      url: `/tasks/${NO_ID}/complete`,
      payload: { userId: user.body.id },
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'TASK_NOT_FOUND' } });
  });
});
