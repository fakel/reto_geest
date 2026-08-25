import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  createTestUser,
  createTestTask,
  createTestAssignment,
} from './helpers';
import { prisma } from './setup';
import { completeTask } from '../src/services/complete.service';

const NO_ID = '00000000-0000-4000-8000-000000000000';

describe('US-04: POST /tasks/:idTask/complete', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function complete(
    taskId: string,
    userId: string,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/complete`,
      payload: { userId },
    });
    return { status: res.statusCode, json: res.json() };
  }

  it('returns 200 { archived: false } when the completer is not the last user', async () => {
    const task = await createTestTask(prisma, { title: 'Two users' });
    const u1 = await createTestUser(prisma, { email: 'c1@example.com' });
    const u2 = await createTestUser(prisma, { email: 'c2@example.com' });
    await createTestAssignment(prisma, u1.id, task.id);
    await createTestAssignment(prisma, u2.id, task.id);

    const res = await complete(task.id, u1.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ archived: false });
  });

  it('returns 200 { archived: true } when the last user completes', async () => {
    const task = await createTestTask(prisma, { title: 'Solo' });
    const u1 = await createTestUser(prisma, { email: 'solo@example.com' });
    await createTestAssignment(prisma, u1.id, task.id);

    const res = await complete(task.id, u1.id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ archived: true });
  });

  it('archives the task in the DB when the last user completes', async () => {
    const task = await createTestTask(prisma, { title: 'Archive me' });
    const u1 = await createTestUser(prisma, { email: 'arch@example.com' });
    await createTestAssignment(prisma, u1.id, task.id);

    await complete(task.id, u1.id);

    const stored = await prisma.task.findUnique({ where: { id: task.id } });
    expect(stored?.status).toBe('archived');
    expect(stored?.version).toBe(task.version + 1);
  });

  it('calls SQS.sendMessage with the correct payload when archiving', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ MessageId: 'mock-1' });
    (app as unknown as { sqs: { sendMessage: typeof sendMessage } }).sqs.sendMessage =
      sendMessage;

    const task = await createTestTask(prisma, { title: 'Notify me' });
    const u1 = await createTestUser(prisma, { email: 'notify@example.com' });
    await createTestAssignment(prisma, u1.id, task.id);

    await complete(task.id, u1.id);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const params = sendMessage.mock.calls[0][0];
    expect(params.MessageBody).toBeTruthy();
    const body = JSON.parse(params.MessageBody);
    expect(body).toMatchObject({ taskId: task.id, title: 'Notify me', status: 'archived' });
    expect(typeof body.timestamp).toBe('string');
  });

  it('does NOT call SQS when not archiving', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ MessageId: 'mock-1' });
    (app as unknown as { sqs: { sendMessage: typeof sendMessage } }).sqs.sendMessage =
      sendMessage;

    const task = await createTestTask(prisma, { title: 'no send' });
    const u1 = await createTestUser(prisma, { email: 'n1@example.com' });
    const u2 = await createTestUser(prisma, { email: 'n2@example.com' });
    await createTestAssignment(prisma, u1.id, task.id);
    await createTestAssignment(prisma, u2.id, task.id);

    await complete(task.id, u1.id);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns 404 when the task is not found', async () => {
    const u1 = await createTestUser(prisma, { email: 'x1@example.com' });
    const res = await complete(NO_ID, u1.id);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('TASK_NOT_FOUND');
  });

  it('returns 404 when the user is not found', async () => {
    const task = await createTestTask(prisma, { title: 'T' });
    const res = await complete(task.id, NO_ID);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 409 when the task is already archived', async () => {
    const task = await createTestTask(prisma, { title: 'Done', status: 'archived' });
    const u1 = await createTestUser(prisma, { email: 'y1@example.com' });
    const res = await complete(task.id, u1.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('TASK_ALREADY_ARCHIVED');
  });

  it('returns 409 when the user is not assigned to the task', async () => {
    const task = await createTestTask(prisma, { title: 'Unassigned' });
    const u1 = await createTestUser(prisma, { email: 'z1@example.com' });
    const res = await complete(task.id, u1.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('USER_NOT_ASSIGNED');
  });

  it('returns 409 when the user already completed the task', async () => {
    const task = await createTestTask(prisma, { title: 'Repeat' });
    const u1 = await createTestUser(prisma, { email: 'r1@example.com' });
    await createTestAssignment(prisma, u1.id, task.id, { completed: true });
    const res = await complete(task.id, u1.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('ALREADY_COMPLETED');
  });

  it('returns 400 when userId is missing', async () => {
    const task = await createTestTask(prisma, { title: 'T' });
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/complete`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('US-04: completeTask VERSION_CONFLICT (OCC race)', () => {
  // pg-mem enforces no real transaction atomicity, so the concurrent race is
  // exercised at the unit level by injecting a prisma-like client whose archive
  // update many affects 0 rows (simulating a concurrent archive bump).
  it('throws VERSION_CONFLICT when the archive update affects 0 rows', async () => {
    const taskId = 'task-1';
    const userId = 'user-1';
    const sqs = { sendMessage: vi.fn().mockResolvedValue({ MessageId: 'm' }) };

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

    expect(sqs.sendMessage).not.toHaveBeenCalled();
  });
});