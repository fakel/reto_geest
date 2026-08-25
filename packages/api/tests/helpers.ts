import { randomUUID } from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient, User, Task, TaskAssignment } from '@prisma/client';
import { prisma as setupPrisma } from './setup';
import { AppError } from '../src/services/errors';
import { userRoutes } from '../src/routes/users';
import { taskRoutes } from '../src/routes/tasks';
import { assignmentRoutes } from '../src/routes/assignments';

/**
 * Reusable factories and app builder (design §6.1 / §6.2).
 *
 * Factories accept an explicit `PrismaClient` for flexibility but default to the
 * pg-mem-backed client installed by the global test setup.
 */

export interface UserOverrides {
  id?: string;
  name?: string;
  lastName?: string;
  email?: string;
}

export function createTestUser(
  client: PrismaClient = setupPrisma,
  overrides: UserOverrides = {},
): Promise<User> {
  return client.user.create({
    data: {
      id: overrides.id ?? randomUUID(),
      name: overrides.name ?? 'Test User',
      lastName: overrides.lastName ?? 'Last',
      email: overrides.email ?? `user-${randomUUID()}@example.com`,
    },
  });
}

export interface TaskOverrides {
  id?: string;
  title?: string;
  description?: string | null;
  status?: string;
  version?: number;
}

export function createTestTask(
  client: PrismaClient = setupPrisma,
  overrides: TaskOverrides = {},
): Promise<Task> {
  const data: Record<string, unknown> = {
    id: overrides.id ?? randomUUID(),
    title: overrides.title ?? 'Test task',
    status: overrides.status ?? 'open',
    version: overrides.version ?? 0,
  };
  if (overrides.description !== undefined) {
    data.description = overrides.description;
  }
  return client.task.create({ data });
}

export interface AssignmentOverrides {
  id?: string;
  completed?: boolean;
}

export function createTestAssignment(
  client: PrismaClient,
  userId: string,
  taskId: string,
  overrides: AssignmentOverrides = {},
): Promise<TaskAssignment> {
  return client.taskAssignment.create({
    data: {
      id: overrides.id ?? randomUUID(),
      userId,
      taskId,
      completed: overrides.completed ?? false,
    },
  });
}

/**
 * Build a Fastify app with the user routes registered and the standard error
 * handler (design §7) wired in. Used for E2E API tests. More routes are added
 * as later tasks land; T-14 replaces this with the real app factory.
 */
export function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) {
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(userRoutes, { prefix: '/users' });
  app.register(taskRoutes, { prefix: '/tasks' });
  app.register(assignmentRoutes, { prefix: '/tasks' });
  return app;
}