import { buildApp } from './app';

/**
 * AWS Lambda handler (T-14).
 *
 * A minimal, dependency-free adapter for API Gateway HTTP API (payload format
 * 2.0) events. It builds (or reuses) the Fastify app once, then dispatches each
 * incoming event through `app.inject()` so the exact same routing/plugin
 * pipeline used locally handles the request. `inject` avoids maintaining a
 * listening TCP server inside a Lambda.
 *
 * The `app` instance is cached module-level so concurrent invocations on warm
 * containers share the already-built (already-initialized) instance.
 */

// Minimal APIGatewayProxyEventV2 type without pulling in @types/aws-lambda.
interface LambdaEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

// Minimal structural typing of the Fastify surface this handler uses. We cast
// the built app to this shape so `inject` resolves to the proper request/result
// types (Fastify's generic `FastifyInstance` typing surfaces a chain overload),
// without pulling in the AWS/light-my-request type packages.
interface InjectOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: string;
}

interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface AppWithInject {
  ready(): Promise<unknown>;
  inject(request: InjectOptions): Promise<InjectResponse>;
}

let cachedApp: AppWithInject | undefined;

async function getApp(): Promise<AppWithInject> {
  if (!cachedApp) {
    cachedApp = (await buildApp({ logger: false })) as unknown as AppWithInject;
  }
  return cachedApp;
}

export async function handler(event: LambdaEvent): Promise<LambdaResult> {
  const app = await getApp();

  const method = event.requestContext?.http?.method ?? 'GET';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const url = `${event.rawPath}${query}`;

  // Reconstruct the (possibly base64-encoded) request body as UTF-8 text.
  const rawBody = event.body ?? undefined;
  const payload = event.isBase64Encoded
    ? Buffer.from(rawBody ?? '', 'base64').toString('utf8')
    : rawBody;

  // Narrow header values to strings (drop undefined) for Fastify's types.
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key] = value;
  }

  const res = await app.inject({ method, url, headers, payload });

  return {
    statusCode: res.statusCode,
    headers: {
      'content-type': (res.headers['content-type'] as string) ?? 'application/json',
    },
    body: res.body,
    isBase64Encoded: false,
  };
}

/** Type-only re-export so CDK/consumers can import the handler shape. */
export type { LambdaEvent, LambdaResult };