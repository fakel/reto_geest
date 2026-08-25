import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  createTestUser,
  createTestTask,
  createTestAssignment,
} from './helpers';
import { prisma } from './setup';

describe('US-03: POST /tasks/:idTask/assign', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the updated assignments when assigning users', async () => {
    const task = await createTestTask(prisma, { title: 'Assignable' });
    const u1 = await createTestUser(prisma, { email: 'u1@example.com' });
    const u2 = await createTestUser(prisma, { email: 'u2@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: { userIds: [u1.id, u2.id] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    const userIds = body.map((a: { userId: string }) => a.userId);
    expect(userIds).toEqual(expect.arrayContaining([u1.id, u2.id]));
    expect(body.every((a: { completed: boolean }) => a.completed === false)).toBe(true);
  });

  it('returns 404 when the task is not found', async () => {
    const user = await createTestUser(prisma, { email: 'nt@example.com' });
    const res = await app.inject({
      method: 'POST',
      url: '/tasks/00000000-0000-4000-8000-000000000000/assign',
      payload: { userIds: [user.id] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TASK_NOT_FOUND');
  });

  it('returns 404 when any userId is not found (with detail)', async () => {
    const task = await createTestTask(prisma, { title: 'T' });
    const user = await createTestUser(prisma, { email: 'exists@example.com' });
    const missing = '00000000-0000-4000-8000-000000000000';

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: { userIds: [user.id, missing] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('USER_NOT_FOUND');
    expect(res.json().error.message).toContain(missing);
  });

  it('returns 409 when the task is already archived', async () => {
    const task = await createTestTask(prisma, { title: 'Archived', status: 'archived' });
    const user = await createTestUser(prisma, { email: 'arch@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: { userIds: [user.id] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TASK_ALREADY_ARCHIVED');
  });

  it('returns 409 when a user is already assigned (duplicate)', async () => {
    const task = await createTestTask(prisma, { title: 'Dup' });
    const user = await createTestUser(prisma, { email: 'dup@example.com' });
    await createTestAssignment(prisma, user.id, task.id);

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: { userIds: [user.id] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USER_ALREADY_ASSIGNED');
  });

  it('returns 400 when userIds is an empty array', async () => {
    const task = await createTestTask(prisma, { title: 'Empty' });
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: { userIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('EMPTY_USER_LIST');
  });

  it('returns 400 when userIds is missing', async () => {
    const task = await createTestTask(prisma, { title: 'Missing' });
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/assign`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});