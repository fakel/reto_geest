import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import type {
  SendMessageCommandInput,
  ReceiveMessageCommandInput,
  SendMessageResult,
  ReceiveMessageResult,
} from '@aws-sdk/client-sqs';
import { getEnv } from '../config/env';

/**
 * SQS Fastify plugin (design §5.3).
 *
 * Decorates `fastify.sqs` with an SQS sender/consumer so services can publish
 * notifications (completion archive) and poll the DLQ (admin endpoint) without
 * depending on the AWS SDK directly.
 *
 * The decorator object is intentionally mutable, so tests (and future code)
 * can swap `sendMessage`/`receiveMessage` for mocks.
 */

export interface SqsClientDecorator {
  sendMessage(params: SendMessageCommandInput): Promise<SendMessageResult>;
  receiveMessage(params: ReceiveMessageCommandInput): Promise<ReceiveMessageResult>;
}

export interface SqsPluginOptions {
  /**
   * Force the mock implementation regardless of NODE_ENV. In test mode the
   * plugin installs a no-op mock by default so the app can boot without AWS.
   */
  mock?: boolean;
  /** Replace the backing client (used to inject a fully-custom mock). */
  client?: Partial<SqsClientDecorator>;
  /** AWS region for the real client (defaults to AWS_REGION or us-east-1). */
  region?: string;
}

/** Build a mock decorator whose calls resolve to canned, empty results. */
function createMock(): SqsClientDecorator {
  return {
    async sendMessage(params) {
      return { MessageId: params.QueueUrl ?? 'mock-message-id' };
    },
    async receiveMessage() {
      return { Messages: [] };
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    sqs: SqsClientDecorator;
  }
}

export default fp<SqsPluginOptions>(
  async function sqsPlugin(app: FastifyInstance, opts: SqsPluginOptions) {
    const env = getEnv();
    const useMock =
      opts.mock ?? (opts.client !== undefined || env.nodeEnv === 'test');

    let decorator: SqsClientDecorator;
    if (useMock) {
      decorator = createMock();
    } else {
      const client = new SQSClient({
        region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
      });
      decorator = {
        async sendMessage(params) {
          return client.send(new SendMessageCommand(params));
        },
        async receiveMessage(params) {
          return client.send(new ReceiveMessageCommand(params));
        },
      };
    }

    // Overlay any caller-supplied method overrides (custom mock / spy).
    decorator = { ...decorator, ...opts.client };

    app.decorate('sqs', { ...decorator });
  },
  { name: 'sqs' },
);
