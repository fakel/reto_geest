import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';

/**
 * T-15: Admin DLQ endpoint (US-11).
 *
 * GET /admin/dlq polls the SQS dead-letter queue via the `fastify.sqs`
 * decorator (swapped for a mock here) and returns the mapped DLQ messages.
 */

describe('US-11: GET /admin/dlq', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function getDLQ(): Promise<{ status: number; json: unknown[] }> {
    const res = await app.inject({ method: 'GET', url: '/admin/dlq' });
    return { status: res.statusCode, json: res.json() };
  }

  it('returns 200 with an empty array when the DLQ is empty', async () => {
    // Default mock receiveMessage resolves to `{ Messages: [] }`.
    const { status, json } = await getDLQ();
    expect(status).toBe(200);
    expect(json).toEqual([]);
  });

  it('returns 200 with mapped messages when the DLQ has messages', async () => {
    // Swap the SQS receiver for one returning a populated batch.
    app.sqs.receiveMessage = async () => ({
      Messages: [
        {
          MessageId: 'm1',
          Body: '{"taskId":"t1","status":"archived"}',
          Attributes: {
            SentTimestamp: '1690000000000',
            ApproximateReceiveCount: '3',
          },
        },
        {
          MessageId: 'm2',
          Body: '{"taskId":"t2"}',
          Attributes: { SentTimestamp: '1690000001000' },
        },
      ],
    });

    const { status, json } = await getDLQ();
    expect(status).toBe(200);
    expect(json).toHaveLength(2);

    const first = json[0] as {
      messageId: string;
      body: string;
      attributes: Record<string, string>;
      sentTimestamp: string;
    };
    expect(first.messageId).toBe('m1');
    expect(first.body).toBe('{"taskId":"t1","status":"archived"}');
    expect(first.attributes).toEqual({
      SentTimestamp: '1690000000000',
      ApproximateReceiveCount: '3',
    });
    expect(first.sentTimestamp).toBe('1690000000000');
  });

  it('maps messages to the documented shape and drops missing fields gracefully', async () => {
    app.sqs.receiveMessage = async () => ({
      Messages: [{ MessageId: 'm3' }], // no Body / Attributes
    });

    const { status, json } = await getDLQ();
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0]).toEqual({
      messageId: 'm3',
      body: '',
      attributes: {},
      sentTimestamp: '',
    });
  });

  it('honors the maxMessages query parameter', async () => {
    const received: number[] = [];
    app.sqs.receiveMessage = async (params) => {
      received.push(params.MaxNumberOfMessages ?? 0);
      return { Messages: [] };
    };

    const res = await app.inject({
      method: 'GET',
      url: '/admin/dlq?maxMessages=5',
    });
    expect(res.statusCode).toBe(200);
    expect(received).toEqual([5]);
  });
});