import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env';

const validVars = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  NOTIFICATION_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/notifications',
  DLQ_URL: 'https://sqs.us-east-1.amazonaws.com/123/notifications-dlq',
};

describe('parseEnv', () => {
  it('parses all required variables and applies defaults for optional ones', () => {
    const env = parseEnv(validVars);

    expect(env.databaseUrl).toBe(validVars.DATABASE_URL);
    expect(env.notificationQueueUrl).toBe(validVars.NOTIFICATION_QUEUE_URL);
    expect(env.dlqUrl).toBe(validVars.DLQ_URL);
    expect(env.notifyUrl).toBe(''); // optional, defaults to empty string
    expect(env.idempotencyTtlSeconds).toBe(86400); // default 24h
    expect(env.rateLimitMax).toBe(100); // default
    expect(env.rateLimitWindowMs).toBe(60_000); // default
    expect(env.nodeEnv).toBe('development'); // default
  });

  it('reads the NOTIFY_URL when provided', () => {
    const env = parseEnv({ ...validVars, NOTIFY_URL: 'https://webhook.example.com/hook' });
    expect(env.notifyUrl).toBe('https://webhook.example.com/hook');
  });

  it('accepts explicitly-set optional values', () => {
    const env = parseEnv({
      ...validVars,
      IDEMPOTENCY_TTL_SECONDS: '3600',
      RATE_LIMIT_MAX: '50',
      RATE_LIMIT_WINDOW_MS: '30000',
      NODE_ENV: 'test',
    });

    expect(env.idempotencyTtlSeconds).toBe(3600);
    expect(env.rateLimitMax).toBe(50);
    expect(env.rateLimitWindowMs).toBe(30_000);
    expect(env.nodeEnv).toBe('test');
  });

  it('throws when DATABASE_URL is missing', () => {
    const withoutDb = { ...validVars };
    delete withoutDb.DATABASE_URL;
    expect(() => parseEnv(withoutDb)).toThrow('Missing required environment variable(s): DATABASE_URL');
  });

  it('throws when NOTIFICATION_QUEUE_URL is missing', () => {
    const withoutQueue = { ...validVars };
    delete withoutQueue.NOTIFICATION_QUEUE_URL;
    expect(() => parseEnv(withoutQueue)).toThrow(/NOTIFICATION_QUEUE_URL/);
  });

  it('throws when DLQ_URL is missing', () => {
    const withoutDlq = { ...validVars };
    delete withoutDlq.DLQ_URL;
    expect(() => parseEnv(withoutDlq)).toThrow(/DLQ_URL/);
  });

  it('throws (with ALL missing variables listed) when multiple required vars are missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL.*NOTIFICATION_QUEUE_URL.*DLQ_URL/s);
  });

  it('falls back to defaults for non-numeric optional values', () => {
    const env = parseEnv({
      ...validVars,
      RATE_LIMIT_MAX: 'not-a-number',
      IDEMPOTENCY_TTL_SECONDS: '',
    });
    expect(env.rateLimitMax).toBe(100);
    expect(env.idempotencyTtlSeconds).toBe(86400);
  });
});
