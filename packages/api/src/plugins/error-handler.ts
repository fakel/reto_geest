import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../services/errors';

/**
 * Centralized error handler plugin (design §7).
 *
 * Maps every thrown/errored response to the standard `{ error: { code,
 * message } }` shape:
 *   - `AppError`      → the error's own statusCode + code
 *   - validation      → 400 `VALIDATION_ERROR`
 *   - anything else   → 500 `INTERNAL_ERROR` (the unexpected error is logged)
 */

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message },
    });
  }

  if (error.validation) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
  }

  // Unexpected error: log the detail, return a generic message to the client.
  request.log.error(error);
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

/**
 * Install the error handler on a Fastify instance. Exported as a function so
 * the app factory and test helpers can call `app.setErrorHandler(errorHandler)`
 * — matching the design §5.1 registration order.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(errorHandler);
}
