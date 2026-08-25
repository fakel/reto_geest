import type { FastifyInstance } from 'fastify';
import { completeTask, type SqsSender } from '../services/complete.service';
import { getEnv } from '../config/env';

/**
 * Completion route (US-04).
 *
 * Registered by the app factory under the `/tasks` prefix.
 *   POST /tasks/:idTask/complete → 200 | 404 | 409 | 500
 */

const completeSchema = {
  params: {
    type: 'object',
    required: ['idTask'],
    properties: {
      idTask: { type: 'string' },
    },
  },
  body: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        archived: { type: 'boolean' },
      },
      required: ['archived'],
    },
  },
};

interface CompleteBody {
  userId: string;
}

export async function completionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/:idTask/complete', { schema: completeSchema }, async (req, reply) => {
    const { idTask } = req.params as { idTask: string };
    const { userId } = req.body as CompleteBody;
    // The SQS sender is decorated on the instance (a real client in prod from
    // the SQS plugin, a mock/override in tests). Missing sender only matters
    // on the archive path, where the service throws 500. The queue URL comes
    // from the environment (NOTIFICATION_QUEUE_URL) so the archive enqueue
    // targets the right queue.
    const sqs = (app as unknown as { sqs?: SqsSender }).sqs;
    const result = await completeTask(idTask, userId, {
      sqs,
      queueUrl: getEnv().notificationQueueUrl,
    });
    return reply.status(200).send(result);
  });
}