import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PrismaClient, User, Task, TaskAssignment } from '@prisma/client';
import { prisma as setupPrisma } from './setup';
import { buildApp } from '../src/app';
import type { RateLimitPluginOptions } from '../src/plugins/rate-limit';

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
 * Build a Fastify app for E2E API tests by delegating to the real app factory
 * (`src/app.ts`). A small mock SQS sender plus a `logger: false` keeps tests
 * hermetic: requests hit pg-mem and never touch real AWS or loud logs.
 *
 * Optional `rateLimit` overrides let tests exercise the limiter with a small
 * max without touching env vars.
 */
export async function buildTestApp(
  rateLimit?: RateLimitPluginOptions,
): Promise<FastifyInstance> {
  return buildApp({
    logger: false,
    rateLimit,
    sqs: {
      sendMessage: async () => ({ MessageId: 'default-mock' }),
    },
  });
}