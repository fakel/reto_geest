import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../config/database';
import { ConflictError, InternalError, NotFoundError } from './errors';

/**
 * Task completion service (US-04) — core business logic.
 *
 * Marks a user's assignment complete and, when it was the last pending
 * assignment, archives the task under Optimistic Concurrency Control (OCC)
 * and enqueues a notification to SQS. The archive + SQS enqueue happen inside
 * a single Prisma transaction so a failed enqueue rolls back the archive.
 */

export interface CompleteResult {
  archived: boolean;
}

export interface SqsSendMessageParams {
  QueueUrl?: string;
  MessageBody: string;
}

/** Minimal SQS sender so the service does not depend on the AWS SDK directly. */
export interface SqsSender {
  sendMessage(params: SqsSendMessageParams): Promise<unknown>;
}

export interface CompleteTaskDeps {
  /** Injectable Prisma client (defaults to the app singleton). Used in unit tests. */
  prisma?: PrismaClient;
  /** SQS sender; required when archiving so the notification can be enqueued. */
  sqs?: SqsSender;
  /** Main queue URL passed through to the SQS sendMessage call. */
  queueUrl?: string;
}

/**
 * Mark `userId` as having completed `taskId`.
 *
 * Throws:
 *   - `TASK_NOT_FOUND`    (404) when the task does not exist
 *   - `TASK_ALREADY_ARCHIVED` (409) when the task is already archived
 *   - `USER_NOT_FOUND`    (404) when the user does not exist
 *   - `USER_NOT_ASSIGNED` (409) when the user is not assigned to the task
 *   - `ALREADY_COMPLETED` (409) when the user already completed the task
 *   - `VERSION_CONFLICT`  (409) when the OCC archive update affects 0 rows
 *   - `INTERNAL_ERROR`    (500) when SQS is not configured / enqueue fails
 */
export async function completeTask(
  taskId: string,
  userId: string,
  deps: CompleteTaskDeps = {},
): Promise<CompleteResult> {
  const prisma = deps.prisma ?? getPrisma();

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new NotFoundError('TASK_NOT_FOUND', `Task with id "${taskId}" not found`);
  }
  if (task.status !== 'open') {
    throw new ConflictError(
      'TASK_ALREADY_ARCHIVED',
      `Task with id "${taskId}" is already archived`,
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError('USER_NOT_FOUND', `User with id "${userId}" not found`);
  }

  const assignment = await prisma.taskAssignment.findUnique({
    where: { userId_taskId: { userId, taskId } },
  });
  if (!assignment) {
    throw new ConflictError(
      'USER_NOT_ASSIGNED',
      `User "${userId}" is not assigned to task "${taskId}"`,
    );
  }
  if (assignment.completed) {
    throw new ConflictError(
      'ALREADY_COMPLETED',
      `User "${userId}" has already completed task "${taskId}"`,
    );
  }

  // Version read up front; used by the conditional archive update (OCC).
  const expectedVersion = task.version;

  return prisma.$transaction(async (tx) => {
    // 1. Mark this assignment completed.
    await tx.taskAssignment.updateMany({
      where: { taskId, userId },
      data: { completed: true },
    });

    // 2. Count any remaining incomplete assignments for this task.
    const remainingCount = await tx.taskAssignment.count({
      where: { taskId, completed: false },
    });

    // 3. If this was the last pending assignment, archive under OCC.
    if (remainingCount === 0) {
      const updated = await tx.task.updateMany({
        where: { id: taskId, version: expectedVersion },
        data: { status: 'archived', version: { increment: 1 } },
      });

      if (updated.count === 0) {
        throw new ConflictError(
          'VERSION_CONFLICT',
          `Task "${taskId}" was modified concurrently; archive failed`,
        );
      }

      if (!deps.sqs) {
        throw new InternalError('SQS client not configured; cannot send notification');
      }

      await deps.sqs.sendMessage({
        QueueUrl: deps.queueUrl,
        MessageBody: JSON.stringify({
          taskId,
          title: task.title,
          status: 'archived',
          timestamp: new Date().toISOString(),
        }),
      });

      return { archived: true };
    }

    return { archived: false };
  });
}