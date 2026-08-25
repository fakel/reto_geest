import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp,
  createTestUser,
  createTestTask,
  createTestAssignment,
} from './helpers';
import { prisma } from './setup';

describe('US-02: POST /tasks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 201 with a title (defaults to open, version 0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Write specs' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body).toMatchObject({
      title: 'Write specs',
      status: 'open',
      version: 0,
    });
  });

  it('returns 201 with title and optional description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Design', description: 'API design doc' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: 'Design',
      description: 'API design doc',
      version: 0,
    });
  });

  it('returns 400 when title is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when title is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('US-05: GET /tasks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with all tasks including their assignments', async () => {
    const user = await createTestUser(prisma, { email: 'assign@example.com' });
    const task = await createTestTask(prisma, { title: 'Assigned task' });
    await createTestAssignment(prisma, user.id, task.id);
    await createTestTask(prisma, { title: 'Unassigned task' });

    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveLength(2);
    const found = body.find((t: { id: string }) => t.id === task.id);
    expect(found.taskAssignments).toHaveLength(1);
    expect(found.taskAssignments[0]).toMatchObject({
      userId: user.id,
      taskId: task.id,
      completed: false,
    });
    expect(found.taskAssignments[0].user).toMatchObject({ id: user.id, email: user.email });
  });

  it('returns 200 with only open tasks when ?status=open', async () => {
    await createTestTask(prisma, { title: 'Open 1' });
    await createTestTask(prisma, { title: 'Open 2' });
    await createTestTask(prisma, { title: 'Archived', status: 'archived' });

    const res = await app.inject({ method: 'GET', url: '/tasks?status=open' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.every((t: { status: string }) => t.status === 'open')).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('returns 200 with only archived tasks when ?status=archived', async () => {
    await createTestTask(prisma, { title: 'Open' });
    await createTestTask(prisma, { title: 'Archived 1', status: 'archived' });
    await createTestTask(prisma, { title: 'Archived 2', status: 'archived' });

    const res = await app.inject({ method: 'GET', url: '/tasks?status=archived' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.every((t: { status: string }) => t.status === 'archived')).toBe(true);
    expect(body).toHaveLength(2);
  });

  it('returns 400 INVALID_STATUS_FILTER when ?status=invalid', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks?status=invalid' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_STATUS_FILTER');
  });

  it('returns 200 with an empty array when no tasks exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('US-08: GET /tasks/:idTask', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the task, its assignments, and user data', async () => {
    const user = await createTestUser(prisma, { email: 'detail@example.com' });
    const task = await createTestTask(prisma, { title: 'Detail task' });
    await createTestAssignment(prisma, user.id, task.id);

    const res = await app.inject({ method: 'GET', url: `/tasks/${task.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: task.id, title: 'Detail task', version: 0 });
    expect(body.taskAssignments).toHaveLength(1);
    expect(body.taskAssignments[0].user).toMatchObject({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  });

  it('returns 404 when the task is not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tasks/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TASK_NOT_FOUND');
  });
});