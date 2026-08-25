import type { FastifyInstance } from 'fastify';
import { cleanupExpiredKeys } from '../services/idempotency.service';

/**
 * Admin routes (US-11 idempotency retention + future DLQ inspection).
 *
 * Registered by the app factory under the `/admin` prefix.
 *   POST /admin/idempotency/cleanup → 200   (purge expired idempotency keys)
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

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/idempotency/cleanup', { schema: cleanupSchema }, async (_req, reply) => {
    const deleted = await cleanupExpiredKeys();
    return reply.status(200).send({ deleted });
  });
}