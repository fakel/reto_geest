import { describe, it, expect } from 'vitest';
import { prisma } from './setup';
import {
  createTestUser,
  createTestTask,
  createTestAssignment,
  buildTestApp,
} from './helpers';

describe('T-04: Prisma client singleton + pg-mem smoke test', () => {
  it('database.ts exports a working client (create + read a user)', async () => {
    const user = await createTestUser();
    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found).not.toBeNull();
    expect(found).toMatchObject({ id: user.id, email: user.email });
  });

  it('helper factories create valid records in pg-mem', async () => {
    const user = await createTestUser();
    const task = await createTestTask();
    const assignment = await createTestAssignment(prisma, user.id, task.id);

    const got = await prisma.taskAssignment.findUnique({
      where: { id: assignment.id },
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ userId: user.id, taskId: task.id, completed: false });
  });

  it('database.ts singleton resolves to the pg-mem client in tests', async () => {
    // getPrisma() returns the client installed by the setup (via setPrismaClient).
    const user = await createTestUser();
    const { getPrisma } = await import('../src/config/database');
    const found = await getPrisma().user.findUnique({ where: { id: user.id } });
    expect(found?.email).toBe(user.email);
  });

  it('buildTestApp returns a Fastify instance that responds to requests', async () => {
    const app = await buildTestApp();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});