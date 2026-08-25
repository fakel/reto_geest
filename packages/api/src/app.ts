import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import rateLimitPlugin, { type RateLimitPluginOptions } from './plugins/rate-limit';
import idempotencyPlugin from './plugins/idempotency';
import sqsPlugin, { type SqsClientDecorator } from './plugins/sqs';
import { installErrorHandler } from './plugins/error-handler';
import { userRoutes } from './routes/users';
import { taskRoutes } from './routes/tasks';
import { assignmentRoutes } from './routes/assignments';
import { completionRoutes } from './routes/completions';
import { notificationRoutes } from './routes/notifications';
import { adminRoutes } from './routes/admin';

/**
 * App factory (T-14) — wires every plugin and route into a single Fastify
 * instance. This is the true runtime entry point shared by the local dev server
 * (`index.ts`), the AWS Lambda handler (`lambda.ts`), and the E2E test helpers.
 *
 * Plugin registration order (design §5.1):
 *   1. rate-limit   — protects every route regardless of path.
 *   2. idempotency  — dedupes POSTs via the `Idempotency-Key` header.
 *   3. SQS          — decorates `fastify.sqs` with the notification sender/
 *      DLQ consumer used by the completion + admin routes.
 *   4. error-handler — installed first (a `setErrorHandler`, not a plugin) so
 *      it is inherited by every encapsulated route/hook below.
 *
 * Injectable options let tests reuse this exact factory with a small rate-limit
 * window and a mock SQS sender instead of real AWS calls.
 */

export interface BuildAppOptions {
  /** Fastify logger option (defaults to false). */
  logger?: boolean | { level?: string };
  /** Rate-limit overrides (e.g. a small max for tests). */
  rateLimit?: RateLimitPluginOptions;
  /** SQS method overrides (e.g. a mock `sendMessage` for tests). */
  sqs?: Partial<SqsClientDecorator>;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  // 4. Error handler — installed via setErrorHandler so it applies to every
  //    request regardless of encapsulation.
  installErrorHandler(app);

  // 1. Rate limiting first so it guards all routes.
  await app.register(rateLimitPlugin, options.rateLimit ?? {});

  // 2. Idempotency hooks at the root.
  await app.register(idempotencyPlugin);

  // 3. SQS decorator (falls back to a no-op mock automatically in tests).
  await app.register(sqsPlugin, { client: options.sqs });

  app.get('/health', async () => ({ status: 'ok' }));

  // Route modules, each under its documented prefix.
  app.register(userRoutes, { prefix: '/users' });
  app.register(taskRoutes, { prefix: '/tasks' });
  app.register(assignmentRoutes, { prefix: '/tasks' });
  app.register(completionRoutes, { prefix: '/tasks' });
  app.register(notificationRoutes, { prefix: '/tasks' });
  app.register(adminRoutes, { prefix: '/admin' });

  return app;
}