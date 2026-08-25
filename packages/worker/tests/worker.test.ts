import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handler, type SQSEvent } from '../src/index';
import { postWebhook, type WebhookResult } from '../src/webhook';
import { parseEnv } from '../src/config/env';
import { prisma } from './setup';
import { randomUUID } from 'node:crypto';

/**
 * T-16: Worker Lambda — SQS consumer.
 *
 * Delivers webhook notifications and logs NotificationAttempt rows. The
 * Prisma client (pg-mem) is injected via deps; the webhook delivery is injected
 * as a fake so no network is involved.
 */

async function makeTask(): Promise<string> {
  const task = await prisma.task.create({
    data: { id: randomUUID(), title: 'Notify me', status: 'archived', version: 1 },
  });
  return task.id;
}

function buildEvent(bodies: unknown[], attributes: Record<string, string> = {}): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      body: JSON.stringify(body),
      attributes,
    })),
  };
}

describe('T-16: Worker SQS consumer', () => {
  beforeEach(async () => {
    // Ensure env config parses (setup.ts installs the vars, but getEnv caches).
    await makeTask();
  });

  it('POSTs to the webhook and logs a success attempt on 200', async () => {
    const taskId = await makeTask();
    const deliver = async (): Promise<WebhookResult> => ({
      statusCode: 200,
      body: '{"ok":true}',
    });

    const event = buildEvent([{ taskId, title: 'T', status: 'archived' }], {
      ApproximateReceiveCount: '1',
    });
    await handler(event, { prisma, postWebhookFn: deliver });

    const attempts = await prisma.notificationAttempt.findMany({ where: { taskId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('success');
    expect(attempts[0].statusCode).toBe(200);
    expect(attempts[0].responseBody).toBe('{"ok":true}');
    expect(attempts[0].attemptNumber).toBe(1);
  });

  it('records a failed attempt (no retry) when the webhook returns 4xx', async () => {
    const taskId = await makeTask();
    const deliver = async (): Promise<WebhookResult> => ({
      statusCode: 404,
      body: 'not found',
    });

    const event = buildEvent([{ taskId, title: 'T', status: 'archived' }], {
      ApproximateReceiveCount: '1',
    });
    await handler(event, { prisma, postWebhookFn: deliver });

    const attempts = await prisma.notificationAttempt.findMany({ where: { taskId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('failed');
    expect(attempts[0].statusCode).toBe(404);
    // 4xx does not throw → message is consumed (no retry).
  });

  it('throws on 5xx so SQS retries, still logging a failed attempt', async () => {
    const taskId = await makeTask();
    const deliver = async (): Promise<WebhookResult> => {
      throw new Error('Webhook returned 500: boom');
    };

    const event = buildEvent([{ taskId, title: 'T', status: 'archived' }], {
      ApproximateReceiveCount: '1',
    });

    await expect(
      handler(event, { prisma, postWebhookFn: deliver }),
    ).rejects.toThrow('Webhook returned 500');

    // The failed attempt is still recorded for the notifications history.
    const attempts = await prisma.notificationAttempt.findMany({ where: { taskId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('failed');
    expect(attempts[0].attemptNumber).toBe(1);
  });

  it('uses the attemptNumber from the SQS ApproximateReceiveCount attribute', async () => {
    const taskId = await makeTask();
    const deliver = async (): Promise<WebhookResult> => ({ statusCode: 200, body: '' });

    const event = buildEvent([{ taskId, title: 'T', status: 'archived' }], {
      ApproximateReceiveCount: '3',
    });
    await handler(event, { prisma, postWebhookFn: deliver });

    const attempts = await prisma.notificationAttempt.findMany({ where: { taskId } });
    expect(attempts[0].attemptNumber).toBe(3);
  });

  it('processes multiple records in a batch independently', async () => {
    const taskA = await makeTask();
    const taskB = await makeTask();

    const calls: string[] = [];
    const deliver = async (url: string, payload: { taskId: string }) => {
      calls.push(payload.taskId);
      return { statusCode: 200, body: '' };
    };

    const event = buildEvent([
      { taskId: taskA, title: 'A', status: 'archived' },
      { taskId: taskB, title: 'B', status: 'archived' },
    ]);
    await handler(event, { prisma, postWebhookFn: deliver as never });

    expect(calls).toEqual([taskA, taskB]);
    expect(await prisma.notificationAttempt.count()).toBe(2);
  });

  it('webhook.ts throws on a 5xx response', async () => {
    // Real postWebhook against a stub server that returns 500.
    let pending!: (v: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      pending = resolve;
    });

    const listener = async (): Promise<Response> => gate;
    const originalListen = globalThis.fetch;
    globalThis.fetch = listener as unknown as typeof fetch;
    try {
      const promise = postWebhook('https://example.com/hook', {});
      pending(new Response('boom', { status: 500 }));
      await expect(promise).rejects.toThrow(/500/);
    } finally {
      globalThis.fetch = originalListen;
    }
  });

  it('does not crash and routes to DLQ when NOTIFY_URL is not configured', async () => {
    const taskId = await makeTask();
    // env without a webhook URL → delivery disabled.
    const envNoNotify = { databaseUrl: 'postgresql://x@localhost/db', nodeEnv: 'test' };
    const deliver = vi.fn();

    const event = buildEvent([{ taskId, title: 'T', status: 'archived' }], {
      ApproximateReceiveCount: '1',
    });

    // Never attempts delivery → throws so SQS retries into the DLQ.
    await expect(
      handler(event, { prisma, env: envNoNotify, postWebhookFn: deliver as never }),
    ).rejects.toThrow(/NOTIFY_URL is not configured/);

    expect(deliver).not.toHaveBeenCalled();

    // A failed attempt is still logged so the notifications history is accurate.
    const attempts = await prisma.notificationAttempt.findMany({ where: { taskId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('failed');
    expect(attempts[0].responseBody).toMatch(/NOTIFY_URL is not configured/);
  });

  it('parseEnv tolerates an empty NOTIFY_URL (does not throw)', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
      NOTIFY_URL: '   ',
      NODE_ENV: 'test',
    });
    expect(env.notifyUrl).toBeUndefined();
    expect(env.databaseUrl).toBe('postgresql://user:pass@localhost:5432/test');
  });
});
