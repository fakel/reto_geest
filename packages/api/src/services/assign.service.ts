import { randomUUID } from 'node:crypto';
import type { TaskAssignment } from '@prisma/client';
import { getPrisma } from '../config/database';
import { BadRequestError, ConflictError, NotFoundError } from './errors';

/**
 * Task-user assignment service (US-03).
 *
 * Assigns one or more users to a task, validating: the task exists, the task
 * is still open (not archived), every user exists, and no user is already
 * assigned. Batch-creates the TaskAssignment records.
 */

/**
 * Assign users to a task. Throws:
 *   - `EMPTY_USER_LIST`   (400) when `userIds` is empty
 *   - `TASK_NOT_FOUND`    (404) when the task does not exist
 *   - `TASK_ALREADY_ARCHIVED` (409) when the task is archived
 *   - `USER_NOT_FOUND`    (404) when any userId does not exist (details which)
 *   - `USER_ALREADY_ASSIGNED` (409) when a user is already assigned to the task
 */
export async function assignUsersToTask(
  taskId: string,
  userIds: string[],
): Promise<TaskAssignment[]> {
  if (userIds.length === 0) {
    throw new BadRequestError('EMPTY_USER_LIST', 'At least one userId is required to assign');
  }

  const prisma = getPrisma();

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new NotFoundError('TASK_NOT_FOUND', `Task with id "${taskId}" not found`);
  }
  if (task.status !== 'open') {
    throw new ConflictError(
      'TASK_ALREADY_ARCHIVED',
      `Task with id "${taskId}" is already archived and cannot accept new assignments`,
    );
  }

  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const foundIds = new Set(users.map((u) => u.id));
  const missing = userIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new NotFoundError(
      'USER_NOT_FOUND',
      `User(s) not found: ${missing.join(', ')}`,
    );
  }

  const existing = await prisma.taskAssignment.findMany({
    where: { taskId, userId: { in: userIds } },
    select: { userId: true },
  });
  if (existing.length > 0) {
    const dupIds = existing.map((a) => a.userId);
    throw new ConflictError(
      'USER_ALREADY_ASSIGNED',
      `User(s) already assigned to task "${taskId}": ${dupIds.join(', ')}`,
    );
  }

  return prisma.taskAssignment.createManyAndReturn({
    data: userIds.map((userId) => ({
      id: randomUUID(),
      taskId,
      userId,
      completed: false,
    })),
  });
}