import type { NotificationAttempt, PrismaClient } from '@prisma/client';

/**
 * Notification logging helper (T-16).
 *
 * Persists a single webhook delivery attempt as a `NotificationAttempt` row,
 * so the API's `GET /tasks/:id/notifications` (US-09) can report delivery
 * history. The `PrismaClient` is injected for testability.
 */

export interface LogAttemptData {
  taskId: string;
  status: string; // "success" | "failed"
  statusCode?: number | null;
  responseBody?: string | null;
  attemptNumber: number;
}

/**
 * Insert a NotificationAttempt record. Returns the created row.
 */
export async function logAttempt(
  prisma: PrismaClient,
  data: LogAttemptData,
): Promise<NotificationAttempt> {
  return prisma.notificationAttempt.create({
    data: {
      taskId: data.taskId,
      status: data.status,
      statusCode: data.statusCode ?? null,
      responseBody: data.responseBody ?? null,
      attemptNumber: data.attemptNumber,
    },
  });
}
