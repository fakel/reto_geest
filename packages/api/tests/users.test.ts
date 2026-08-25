import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createTestUser, createTestTask, createTestAssignment } from './helpers';
import { prisma } from './setup';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('US-01: POST /users', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 201 with valid data (includes a UUID id)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.id).toMatch(UUID_RE);
    expect(body).toMatchObject({
      name: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    expect(typeof body.createdAt).toBe('string');
    expect(body.pendingTasks).toBeUndefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { lastName: 'Lovelace', email: 'ada@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when lastName is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ada', email: 'ada@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when email is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ada', lastName: 'Lovelace' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ada', lastName: 'Lovelace', email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 when email already exists', async () => {
    await createTestUser(prisma, { email: 'dup@example.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ada', lastName: 'Lovelace', email: 'dup@example.com' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});

describe('US-06: GET /users', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with a list of users including pending tasks', async () => {
    const user = await createTestUser(prisma, { email: 'user@example.com' });
    const openTask = await createTestTask(prisma, { title: 'Open task' });
    const archivedTask = await createTestTask(prisma, {
      title: 'Archived task',
      status: 'archived',
    });
    const completedOpenTask = await createTestTask(prisma, { title: 'Done open' });

    // Open + assigned + incomplete → pending
    await createTestAssignment(prisma, user.id, openTask.id);
    // Archived → filtered out (task.status !== 'open')
    await createTestAssignment(prisma, user.id, archivedTask.id);
    // Open but completed → filtered out (completed !== false)
    await createTestAssignment(prisma, user.id, completedOpenTask.id, { completed: true });

    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const foundUser = body.find((u: { id: string }) => u.id === user.id);
    expect(foundUser).toBeTruthy();
    expect(foundUser.pendingTasks).toHaveLength(1);
    expect(foundUser.pendingTasks[0]).toMatchObject({ id: openTask.id, completed: false });
  });

  it('returns 200 with an empty array when no users exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('US-07: GET /users/:idUser/tasks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the user tasks and their completion status', async () => {
    const user = await createTestUser(prisma, { email: 'tasks@example.com' });
    const t1 = await createTestTask(prisma, { title: 'First' });
    const t2 = await createTestTask(prisma, { title: 'Second' });

    await createTestAssignment(prisma, user.id, t1.id);
    await createTestAssignment(prisma, user.id, t2.id, { completed: true });

    const res = await app.inject({ method: 'GET', url: `/users/${user.id}/tasks` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveLength(2);
    const byId = Object.fromEntries(body.map((t: { id: string }) => [t.id, t]));
    expect(byId[t1.id]).toMatchObject({ id: t1.id, title: 'First', completed: false });
    expect(byId[t2.id]).toMatchObject({ id: t2.id, title: 'Second', completed: true });
  });

  it('returns 200 with an empty array when the user has no tasks', async () => {
    const user = await createTestUser(prisma, { email: 'notasks@example.com' });
    const res = await app.inject({ method: 'GET', url: `/users/${user.id}/tasks` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 when the user is not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/00000000-0000-4000-8000-000000000000/tasks',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('USER_NOT_FOUND');
  });
});