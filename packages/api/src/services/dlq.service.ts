import type { ReceiveMessageCommandInput } from '@aws-sdk/client-sqs';
import { getEnv } from '../config/env';
import type { SqsClientDecorator } from '../plugins/sqs';

/**
 * DLQ inspection service (US-11).
 *
 * Polls the SQS dead-letter queue (DLQ_URL) and maps each raw SQS message to
 * the flat response shape documented for `GET /admin/dlq`: `{ messageId, body,
 * attributes, sentTimestamp }`.
 *
 * The SQS receiver is injected (the `fastify.sqs` decorator) so this service
 * has no network/AWS dependency and is trivially testable with a mock.
 */

export interface DLQMessage {
  messageId: string;
  body: string;
  attributes: Record<string, string>;
  sentTimestamp: string;
}

/**
 * Fetch up to `maxMessages` (SQS batch ceiling is 10) from the DLQ, oldest
 * received first. Returns an empty array when the DLQ is empty or unreachable
 * without messages.
 */
export async function getDLQMessages(
  sqs: Pick<SqsClientDecorator, 'receiveMessage'>,
  maxMessages = 10,
): Promise<DLQMessage[]> {
  const params: ReceiveMessageCommandInput = {
    QueueUrl: getEnv().dlqUrl,
    MaxNumberOfMessages: maxMessages,
    AttributeNames: ['All'],
    MessageAttributeNames: ['All'],
  };

  const result = await sqs.receiveMessage(params);

  return (result.Messages ?? []).map((m) => ({
    messageId: m.MessageId ?? '',
    body: m.Body ?? '',
    attributes: (m.Attributes ?? {}) as Record<string, string>,
    sentTimestamp: (m.Attributes?.['SentTimestamp'] ?? '') as string,
  }));
}