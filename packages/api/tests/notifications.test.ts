import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createTestTask } from './helpers';
import { prisma } from './setup';

describe('US-09: GET /tasks/:idTask/notifications', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the list of notification attempts', async () => {
    const task = await createTestTask(prisma, { title: 'Notify history' });

    await prisma.notificationAttempt.create({
      data: {
        id: 'att-1',
        taskId: task.id,
        status: 'success',
        statusCode: 200,
        responseBody: '{"ok":true}',
        attemptNumber: 1,
      },
    });
    await prisma.notificationAttempt.create({
      data: {
        id: 'att-2',
        taskId: task.id,
        status: 'failed',
        statusCode: 500,
        responseBody: 'Server error',
        attemptNumber: 2,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}/notifications`,
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveLength(2);

    // Each attempt includes the required fields.
    for (const attempt of body) {
      expect(attempt).toHaveProperty('id');
      expect(attempt).toHaveProperty('taskId', task.id);
      expect(['pending', 'success', 'failed']).toContain(attempt.status);
      expect(attempt).toHaveProperty('statusCode');
      expect(attempt).toHaveProperty('responseBody');
      expect(attempt).toHaveProperty('attemptNumber');
      expect(attempt).toHaveProperty('createdAt');
    }
  });

  it('returns 200 with an empty array when the task has no attempts', async () => {
    const task = await createTestTask(prisma, { title: 'No attempts yet' });
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}/notifications`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 when the task is not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tasks/00000000-0000-4000-8000-000000000000/notifications',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TASK_NOT_FOUND');
  });
});