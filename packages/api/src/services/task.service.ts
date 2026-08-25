import { randomUUID } from 'node:crypto';
import type { Task } from '@prisma/client';
import { getPrisma } from '../config/database';
import { BadRequestError, NotFoundError } from './errors';

/**
 * Task service layer (US-02, US-05, US-08).
 *
 * Provides task creation, listing (with optional status filter), and detail
 * retrieval. Tasks default to status "open" and version 0; assignments are
 * included with their user data for listing and detail.
 */

export interface CreateTaskData {
  title: string;
  description?: string;
}

/** Task with its assignments, each including the assigned user. */
export type TaskWithAssignments = Task & {
  taskAssignments: Array<{
    id: string;
    userId: string;
    taskId: string;
    completed: boolean;
    createdAt: Date;
    updatedAt: Date;
    user: { id: string; name: string; lastName: string; email: string };
  }>;
};

const VALID_STATUS_FILTERS = new Set(['open', 'archived']);

/**
 * Create a task with status "open" and version 0. A UUIDv7 is generated at the
 * application layer. `description` is optional.
 */
export async function createTask(data: CreateTaskData): Promise<Task> {
  const prisma = getPrisma();
  return prisma.task.create({
    data: {
      id: randomUUID(),
      title: data.title,
      description: data.description ?? null,
      status: 'open',
      version: 0,
    },
  });
}

/**
 * List tasks, optionally filtered by status. Throws `INVALID_STATUS_FILTER`
 * (400) when the filter is not "open" or "archived". Each task includes its
 * assignments (with the assigned user's data).
 */
export async function getAllTasks(
  statusFilter?: 'open' | 'archived',
): Promise<TaskWithAssignments[]> {
  if (statusFilter !== undefined && !VALID_STATUS_FILTERS.has(statusFilter)) {
    throw new BadRequestError(
      'INVALID_STATUS_FILTER',
      `Invalid status filter "${statusFilter}". Allowed values: open, archived`,
    );
  }

  const prisma = getPrisma();
  return prisma.task.findMany({
    where: statusFilter !== undefined ? { status: statusFilter } : undefined,
    include: {
      taskAssignments: {
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Fetch a single task with its assignments (and the assigned user's data).
 * Throws `TASK_NOT_FOUND` (404) when the task does not exist.
 */
export async function getTaskById(id: string): Promise<TaskWithAssignments> {
  const prisma = getPrisma();
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      taskAssignments: {
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!task) {
    throw new NotFoundError('TASK_NOT_FOUND', `Task with id "${id}" not found`);
  }
  return task;
}