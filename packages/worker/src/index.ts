import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getEnv, type Env } from './config/env';
import { postWebhook, type WebhookResult } from './webhook';
import { logAttempt } from './notification-log';

/**
 * Worker Lambda — SQS consumer (T-16).
 *
 * Triggered by the main notification queue (event source wiring lives in the
 * CDK QueueStack, T-17). For each SQS record it:
 *   1. Parses the archived-task notification payload.
 *   2. POSTs it to the external webhook (`NOTIFY_URL`).
 *   3. Logs a `NotificationAttempt` row so the API can expose delivery history.
 *
 * On webhook 5xx/timeout/network errors `postWebhook` throws, so this handler
 * rethrows too — letting SQS retry automatically and, after `maxReceiveCount`
 * (3) attempts, move the message to the DLQ. Responsive errors (4xx) are
 * recorded as failed attempts and the message is consumed normally.
 *
 * NOTIFY_URL FALLBACK: if the webhook URL is not configured (empty/undefined),
 * the worker never attempts delivery — it logs a failed attempt and throws so
 * the message is retried by SQS and eventually ends up in the DLQ, instead of
 * crashing the Lambda.
 *
 * The handler accepts optional deps (`prisma`, `env`, `postWebhookFn`) purely
 * for unit testing; production uses the real defaults.
 */

/** Minimal SQS event shape (we only need what the handler reads). */
export interface SQSEvent {
  Records: Array<{
    messageId: string;
    body: string;
    attributes?: { ApproximateReceiveCount?: string };
  }>;
}

/** Payload the API enqueues when archiving a task (see complete.service.ts). */
export interface NotificationPayload {
  taskId: string;
  title: string;
  status: string;
  timestamp?: string;
}

export interface WorkerDeps {
  prisma?: PrismaClient;
  env?: Env;
  postWebhookFn?: typeof postWebhook;
}

/** Lazily-created Prisma singleton (real database via the pg adapter). */
let prismaSingleton: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    // RDS requires SSL (`rds.force_ssl`); rejectUnauthorized:false keeps the
    // connection encrypted while accepting RDS's CA chain.
    prismaSingleton = new PrismaClient({
      adapter: new PrismaPg(
        new Pool({
          connectionString: getEnv().databaseUrl,
          ssl: { rejectUnauthorized: false },
        }),
      ),
    });
  }
  return prismaSingleton;
}

/** Install a client into the singleton (used by the pg-mem test setup). */
export function setPrisma(client: PrismaClient): PrismaClient {
  prismaSingleton = client;
  return client;
}

export async function handler(
  event: SQSEvent,
  deps: WorkerDeps = {},
): Promise<void> {
  const env = deps.env ?? getEnv();
  const prisma = deps.prisma ?? getPrisma();
  const deliver = deps.postWebhookFn ?? postWebhook;

  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as NotificationPayload;
    // SQS increments ApproximateReceiveCount on every delivery: this is the
    // attempt number (1..3) for the notification history.
    const attemptNumber = Number(record.attributes?.ApproximateReceiveCount ?? '1');

    let result: WebhookResult;
    try {
      // Fallback: no webhook configured → never attempt delivery. Log a
      // failed attempt and throw so SQS retries the message into the DLQ.
      if (!env.notifyUrl) {
        throw new Error('NOTIFY_URL is not configured; message routed to DLQ');
      }
      result = await deliver(env.notifyUrl, payload);
    } catch (err) {
      // Transient failure (5xx/timeout/network). Record the failed attempt so
      // it appears in the notifications history, then rethrow so SQS retries.
      await logAttempt(prisma, {
        taskId: payload.taskId,
        status: 'failed',
        responseBody: (err as Error).message,
        attemptNumber,
      });
      throw err;
    }

    const success = result.statusCode >= 200 && result.statusCode < 300;
    await logAttempt(prisma, {
      taskId: payload.taskId,
      status: success ? 'success' : 'failed',
      statusCode: result.statusCode,
      responseBody: result.body,
      attemptNumber,
    });
  }
}
