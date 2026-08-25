import type { FastifyInstance } from 'fastify';
import { cleanupExpiredKeys } from '../services/idempotency.service';
import { getDLQMessages } from '../services/dlq.service';

/**
 * Admin routes (US-11 idempotency retention + DLQ inspection).
 *
 * Registered by the app factory under the `/admin` prefix.
 *   POST /admin/idempotency/cleanup → 200   (purge expired idempotency keys)
 *   GET  /admin/dlq                 → 200   (inspect the SQS dead-letter queue)
 */

const cleanupSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        deleted: { type: 'integer' },
      },
      required: ['deleted'],
    },
  },
};

const dlqSchema = {
  querystring: {
    type: 'object',
    properties: {
      maxMessages: { type: 'integer', minimum: 1, maximum: 10, default: 10 },
    },
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          body: { type: 'string' },
          attributes: { type: 'object', additionalProperties: { type: 'string' } },
          sentTimestamp: { type: 'string' },
        },
        required: ['messageId', 'body', 'attributes', 'sentTimestamp'],
      },
    },
  },
};

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/idempotency/cleanup', { schema: cleanupSchema }, async (_req, reply) => {
    const deleted = await cleanupExpiredKeys();
    return reply.status(200).send({ deleted });
  });

  app.get('/dlq', { schema: dlqSchema }, async (req) => {
    const { maxMessages } = req.query as { maxMessages?: number };
    // `app.sqs` is the decorator installed by the SQS plugin (a real client in
    // prod, a mock in tests). Read it lazily at request time so tests can swap
    // `receiveMessage` between requests.
    return getDLQMessages(app.sqs, maxMessages ?? 10);
  });
}