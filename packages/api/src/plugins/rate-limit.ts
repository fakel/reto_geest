import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../config/env';
import { AppError } from '../services/errors';

/**
 * Rate limiting plugin (US-10).
 *
 * Protects every route with a configurable limit/window (env-configurable via
 * RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS, defaults 100 req / 60s), keyed per IP.
 *
 * @fastify/rate-limit v10 builds the exceeded response by *throwing* what
 * `errorResponseBuilder` returns, so we return an `AppError` (429) which the
 * central error handler maps to `{ error: { code, message } }`. The plugin sets
 * the Retry-After header before throwing.
 */

export interface RateLimitPluginOptions {
  /** Max requests per window (defaults to RATE_LIMIT_MAX or 100). */
  max?: number;
  /** Window length in ms (defaults to RATE_LIMIT_WINDOW_MS or 60000). */
  timeWindow?: number;
}

export default fp<RateLimitPluginOptions>(
  async function rateLimitPlugin(app: FastifyInstance, opts: RateLimitPluginOptions) {
    const env = getEnv();
    const max = opts.max ?? env.rateLimitMax;
    const timeWindow = opts.timeWindow ?? env.rateLimitWindowMs;

    await app.register(rateLimit, {
      max,
      timeWindow,
      addHeaders: {
        'retry-after': true,
        'x-ratelimit-limit': false,
        'x-ratelimit-remaining': false,
        'x-ratelimit-reset': false,
      },
      errorResponseBuilder: (_req, context) =>
        new AppError(
          context.statusCode,
          'RATE_LIMIT_EXCEEDED',
          `Rate limit exceeded. Limit is ${context.max} requests per window. Retry after ${context.after}`,
        ),
    });
  },
  { name: 'rate-limit' },
);