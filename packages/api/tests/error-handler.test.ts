import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  errorHandler,
  installErrorHandler,
} from '../src/plugins/error-handler';
import { NotFoundError, ConflictError, InternalError } from '../src/services/errors';

/** Build a throwaway app that throws via a route, using the centralized handler. */
function appWithError(prepare: (app: FastifyInstance) => void): FastifyInstance {
  const app = Fastify({ logger: false });
  installErrorHandler(app);
  prepare(app);
  return app;
}

describe('T-11: error handler plugin', () => {
  it('maps AppError to its statusCode + code', async () => {
    const app = appWithError((a) => {
      a.get('/nf', async () => {
        throw new NotFoundError('USER_NOT_FOUND', 'User not found');
      });
      a.get('/conf', async () => {
        throw new ConflictError('VERSION_CONFLICT', 'Conflict');
      });
    });

    const nf = await app.inject({ method: 'GET', url: '/nf' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });

    const conf = await app.inject({ method: 'GET', url: '/conf' });
    expect(conf.statusCode).toBe(409);
    expect(conf.json()).toEqual({
      error: { code: 'VERSION_CONFLICT', message: 'Conflict' },
    });

    await app.close();
  });

  it('maps validation errors to 400 VALIDATION_ERROR', async () => {
    const app = appWithError((a) => {
      a.post(
        '/echo',
        {
          schema: {
            body: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
        async () => ({ ok: true }),
      );
    });

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.message).toBe('string');

    await app.close();
  });

  it('maps unhandled errors to 500 INTERNAL_ERROR', async () => {
    const app = appWithError((a) => {
      a.get('/boom', async () => {
        throw new Error('boom');
      });
    });

    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });

    await app.close();
  });

  it('InternalError (AppError 500) keeps its code', async () => {
    const app = appWithError((a) => {
      a.get('/internal', async () => {
        throw new InternalError('custom internal');
      });
    });

    const res = await app.inject({ method: 'GET', url: '/internal' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'custom internal' },
    });

    await app.close();
  });

  it('errorHandler is a callable function (for app.setErrorHandler)', () => {
    expect(typeof errorHandler).toBe('function');
  });
});