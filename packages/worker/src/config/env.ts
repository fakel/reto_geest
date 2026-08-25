/**
 * Worker environment configuration (T-16).
 *
 * Parses and validates the variables the SQS consumer Lambda needs:
 *   - DATABASE_URL : PostgreSQL connection (Prisma Client) — required
 *   - NOTIFY_URL   : external webhook URL to POST notifications to — OPTIONAL.
 *                    When unset, the worker does not crash: it never attempts
 *                    delivery and throws so SQS retries the message into the
 *                    DLQ (see index.ts handler).
 *
 * Mirrors the API's `env.ts` conventions (parseEnv/getEnv) so a misconfigured
 * worker fails at boot for required vars, but degrades gracefully for NOTIFY_URL.
 */

export interface Env {
  /** PostgreSQL connection string (required) — used by Prisma Client. */
  databaseUrl: string;
  /**
   * External webhook target. Optional — when undefined/empty the worker skips
   * delivery and the message is routed to the DLQ instead of crashing.
   */
  notifyUrl?: string;
  /** Node environment: development | test | production (default development). */
  nodeEnv: string;
}

const REQUIRED_VARS = ['DATABASE_URL'] as const;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED_VARS.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return {
    databaseUrl: source.DATABASE_URL!,
    // Empty/whitespace NOTIFY_URL collapses to undefined (delivery disabled).
    notifyUrl: source.NOTIFY_URL?.trim() || undefined,
    nodeEnv: source.NODE_ENV ?? 'development',
  };
}

/** Lazily-parsed singleton so importing the module does not require env vars. */
let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv();
  }
  return cachedEnv;
}
