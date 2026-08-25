import { describe, it, expect, beforeAll } from 'vitest';
import Fastify from 'fastify';
import sqsPlugin, { type SqsClientDecorator } from '../src/plugins/sqs';

// The plugin calls getEnv() (env.ts) which requires these three vars to parse.
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
  process.env.NOTIFICATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/queue';
  process.env.DLQ_URL = 'https://sqs.us-east-1.amazonaws.com/123/dlq';
});

describe('T-09: SQS plugin', () => {
  it('registers on a Fastify instance and decorates fastify.sqs', async () => {
    const app = Fastify({ logger: false });
    await app.register(sqsPlugin, { mock: true });
    await app.ready();

    expect(app.sqs).toBeDefined();
    expect(typeof app.sqs.sendMessage).toBe('function');
    expect(typeof app.sqs.receiveMessage).toBe('function');

    await app.close();
  });

  it('exposes a callable sendMessage that resolves with a mock MessageId', async () => {
    const app = Fastify({ logger: false });
    await app.register(sqsPlugin, { mock: true });
    await app.ready();

    const res = await app.sqs.sendMessage({
      QueueUrl: 'https://sqs/queue',
      MessageBody: JSON.stringify({ taskId: 't1' }),
    });
    expect(res.MessageId).toBeDefined();

    await app.close();
  });

  it('exposes a callable receiveMessage that resolves with an empty list in mock mode', async () => {
    const app = Fastify({ logger: false });
    await app.register(sqsPlugin, { mock: true });
    await app.ready();

    const res = await app.sqs.receiveMessage({ QueueUrl: 'https://sqs/dlq' });
    expect(res.Messages).toEqual([]);

    await app.close();
  });

  it('allows injecting a full custom mock via opts.client', async () => {
    const app = Fastify({ logger: false });
    await app.register(sqsPlugin, {
      client: {
        sendMessage: async () => ({ MessageId: 'custom-id' }),
      },
    });
    await app.ready();

    const res = await app.sqs.sendMessage({ MessageBody: '{}' });
    expect(res.MessageId).toBe('custom-id');

    await app.close();
  });

  it('allows swapping sendMessage for a mock/spy after registration', async () => {
    const app = Fastify({ logger: false });
    await app.register(sqsPlugin, { mock: true });
    await app.ready();

    const decorator = app.sqs as SqsClientDecorator;
    decorator.sendMessage = async () => ({ MessageId: 'swapped' });

    const res = await app.sqs.sendMessage({ QueueUrl: 'q', MessageBody: '{}' });
    expect(res.MessageId).toBe('swapped');

    await app.close();
  });
});