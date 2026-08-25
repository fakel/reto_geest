import type { NotificationAttempt } from '@prisma/client';
import { getPrisma } from '../config/database';
import { NotFoundError } from './errors';

/**
 * Notification history service (US-09).
 *
 * Exposes the NotificationAttempt records created by the Worker for a given
 * task, newest first.
 */

/**
 * Fetch the notification attempts recorded for a task. Throws `TASK_NOT_FOUND`
 * (404) when the task does not exist, otherwise returns the attempts (empty
 * array when the task has none yet).
 */
export async function getNotificationAttempts(
  taskId: string,
): Promise<NotificationAttempt[]> {
  const prisma = getPrisma();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) {
    throw new NotFoundError('TASK_NOT_FOUND', `Task with id "${taskId}" not found`);
  }

  return prisma.notificationAttempt.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}