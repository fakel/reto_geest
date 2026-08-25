import { v7 as uuidv7 } from 'uuid';
import fp from 'fastify-plugin';
import type {
  FastifyInstance,
  FastifyRequest,
} from 'fastify';
import {
  findCachedResponse,
  generateKeyHash,
  storeResponse,
} from '../services/idempotency.service';
import { AppError } from '../services/errors';
import { getEnv } from '../config/env';

/**
 * Global idempotency plugin (US-12).
 *
 * Reads the `Idempotency-Key` header on POST requests:
 *   - onRequest: if a non-expired cached response exists for the key, reply
 *     with it and skip the handler.
 *   - onSend: persist the produced response, keyed by hash. A concurrent
 *     request with the same key colliding on the unique `keyHash` produces 409
 *     `IDEMPOTENCY_CONFLICT` (thrown inside onSend → error handler).
 *
 * Runs only for POST requests and only when the header is present, so requests
 * without an Idempotency-Key are unaffected.
 */

const IDEMPOTENCY_HEADER = 'idempotency-key';

// Symbol marking a request already served from cache so onSend does not store
// it a second time.
const kServedFromCache = Symbol('idempotency-served-from-cache');

interface IdempotencyRequest extends FastifyRequest {
  [kServedFromCache]?: boolean;
}

export default fp(
  async function idempotencyPlugin(app: FastifyInstance): Promise<void> {
    const ttlSeconds = getEnv().idempotencyTtlSeconds;

    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'POST') return;
      const key = request.headers[IDEMPOTENCY_HEADER];
      if (!key) return;

      const idReq = request as IdempotencyRequest;
      const keyHash = generateKeyHash(request.method, request.url, String(key));
      const cached = await findCachedResponse(keyHash, request.method, request.url);
      if (cached) {
        idReq[kServedFromCache] = true;
        return reply.code(cached.statusCode).send(cached.body as object);
      }
    });

    app.addHook('onSend', async (request, reply, payload) => {
      if (request.method !== 'POST') return payload;
      const key = request.headers[IDEMPOTENCY_HEADER];
      if (!key) return payload;

      const idReq = request as IdempotencyRequest;
      if (idReq[kServedFromCache]) return payload;

      const keyHash = generateKeyHash(request.method, request.url, String(key));
      try {
        await storeResponse(
          uuidv7(),
          keyHash,
          request.method,
          request.url,
          reply.statusCode,
          (payload as string) ?? '',
          ttlSeconds,
        );
      } catch (err) {
        // A concurrent request with the same key collided on the unique
        // keyHash. Errors thrown inside onSend bypass setErrorHandler (they are
        // handled by Fastify's default serializer), so respond with the
        // standardized 409 body directly instead of re-throwing.
        if (
          err instanceof AppError &&
          err.statusCode === 409 &&
          err.code === 'IDEMPOTENCY_CONFLICT'
        ) {
          reply.code(409);
          return JSON.stringify({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
      return payload;
    });
  },
  { name: 'idempotency' },
);
