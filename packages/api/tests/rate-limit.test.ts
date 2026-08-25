import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';

describe('US-10: rate limiting plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp({ max: 3, timeWindow: 60_000 });
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('returns 429 with Retry-After header when exceeding the limit', async () => {
    // Burn through the limit (3 allowed).
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/health' });
    }

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('returns the standard { error: { code, message } } body on 429', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/health' });
    }

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(typeof body.error.message).toBe('string');
  });

  it('limits are per IP (different IPs are not affected)', async () => {
    const send = (ip: string) =>
      app.inject({ method: 'GET', url: '/health', remoteAddress: ip });

    // IP-A burns its own limit; IP-B is unaffected.
    for (let i = 0; i < 3; i++) {
      await send('10.0.0.1');
    }
    expect((await send('10.0.0.1')).statusCode).toBe(429);
    expect((await send('10.0.0.2')).statusCode).toBe(200);
  });
});