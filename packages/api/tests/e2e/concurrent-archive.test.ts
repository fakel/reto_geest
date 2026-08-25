import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers';
import { completeTask } from '../../src/services/complete.service';

/**
 * T-18: Concurrency / OCC archive.
 *
 * Two layers of coverage for the archival race:
 *   1. Unit-level OCC conflict: a second writer bumping the task version mid-
 *      flight makes the conditional archive `updateMany` affect 0 rows, which
 *      must surface as `VERSION_CONFLICT` (409). Deterministic under pg-mem
 *      (no real transaction isolation), matching the T-08 unit convention.
 *   2. Real concurrent HTTP: two users complete the last pending assignment at
 *      once. Verifies that exactly ONE request archives the task, exactly one
 *      SQS notification is enqueued, and the loser gets a 409 (race safety).
 */

describe('T-18: Concurrent archive (OCC)', () => {
  let app: FastifyInstance;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendSpy = vi.fn().mockResolvedValue({ MessageId: 'mock-conc' });
    app = await buildTestApp();
    (app as unknown as { sqs: { sendMessage: unknown } }).sqs.sendMessage = sendSpy;
  });

  afterEach(async () => {
    await app.close();
  });

  it('throws VERSION_CONFLICT (409) when the archive update affects 0 rows', async () => {
    const taskId = 'task-occ';
    const userId = 'user-occ';
    const sqs = { sendMessage: vi.fn().mockResolvedValue({ MessageId: 'm' }) };

    // Simulates a concurrent writer having already incremented the version, so
    // this request's `WHERE id=X AND version=Y` matches nothing.
    const fakePrisma = {
      task: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: taskId, title: 't', status: 'open', version: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: userId }) },
      taskAssignment: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ userId, taskId, completed: false }),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(async (cb: (tx: never) => Promise<unknown>) => cb(fakePrisma as never)),
    } as never;

    await expect(
      completeTask(taskId, userId, { prisma: fakePrisma, sqs: sqs as never }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', statusCode: 409 });

    // A conflicted archive must not enqueue a notification.
    expect(sqs.sendMessage).not.toHaveBeenCalled();
  });

  it('allows only one concurrent completer to archive (HTTP race safety)', async () => {
    // One task with a single assigned user = the archive happens on completion.
    const userRes = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'C', lastName: 'U', email: 'cu@example.com' }),
    });
    const userId = (userRes.json() as { id: string }).id;

    const taskRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'Race' }),
    });
    const taskId = (taskRes.json() as { id: string }).id;

    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/assign`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ userIds: [userId] }),
    });

    // Fire two completes for the same (last) user at once.
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/tasks/${taskId}/complete`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ userId }),
      }),
      app.inject({
        method: 'POST',
        url: `/tasks/${taskId}/complete`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ userId }),
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    // Exactly one success (200, archived:true); the other is a 409 — either
    // the task is already archived or the user already completed it.
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    const success = a.statusCode === 200 ? a : b;
    expect((success.json() as { archived: boolean }).archived).toBe(true);

    // Exactly one notification enqueued, even with two racing completions.
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
