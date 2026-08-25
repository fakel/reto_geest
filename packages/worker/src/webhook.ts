/**
 * Webhook delivery (T-16).
 *
 * POSTs a notification payload to the external webhook target with a 10s
 * timeout (abortable via `AbortController`), using the global `fetch` from
 * Node >= 20.
 *
 * Semantics (per design §4.3 / tasks T-16):
 *   - 2xx → resolves with `{ statusCode, body }` (success, no retry)
 *   - 4xx → resolves with `{ statusCode, body }` (failed, but NOT retried)
 *   - 5xx / timeout / network error → **throws** so SQS retries, and the
 *     message eventually lands in the DLQ after maxReceiveCount attempts.
 */

export interface WebhookResult {
  statusCode: number;
  body: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

export async function postWebhook(
  url: string,
  payload: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<WebhookResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    // Network error, DNS failure, or timeout (AbortError). Any of these is a
    // transient infra failure → rethrow so the caller/SQS retries.
    throw new Error(`Webhook request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();

  if (res.status >= 500) {
    // Server-side failure → retryable.
    throw new Error(`Webhook returned ${res.status}: ${body.slice(0, 500)}`);
  }

  return { statusCode: res.status, body };
}
