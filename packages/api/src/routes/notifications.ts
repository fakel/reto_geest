import type { FastifyInstance } from 'fastify';
import { getNotificationAttempts } from '../services/notification.service';

/**
 * Notification history route (US-09).
 *
 * Registered by the app factory under the `/tasks` prefix.
 *   GET /tasks/:idTask/notifications → 200 | 404
 */

const attemptSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    taskId: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'success', 'failed'] },
    statusCode: { type: ['integer', 'null'] },
    responseBody: { type: ['string', 'null'] },
    attemptNumber: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const getNotificationsSchema = {
  params: {
    type: 'object',
    required: ['idTask'],
    properties: {
      idTask: { type: 'string' },
    },
  },
  response: {
    200: { type: 'array', items: attemptSchema },
  },
};

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:idTask/notifications', { schema: getNotificationsSchema }, async (req) => {
    const { idTask } = req.params as { idTask: string };
    return getNotificationAttempts(idTask);
  });
}