import 'dotenv/config';

/**
 * Type-safe configuration object parsed from environment variables.
 * Mirrors design §9 (Environment Variables).
 */
export interface Env {
  /** PostgreSQL connection string (required) — used by Prisma Migrate & Prisma Client */
  databaseUrl: string;
  /** Main SQS queue URL for notifications (required) */
  notificationQueueUrl: string;
  /** SQS DLQ URL (required) — polled by the admin DLQ endpoint */
  dlqUrl: string;
  /** Webhook target for the Worker (required in prod; not consumed by the API) */
  notifyUrl: string;
  /** Idempotency key TTL in seconds (default 86400 = 24h) */
  idempotencyTtlSeconds: number;
  /** Rate limit max requests per window (default 100) */
  rateLimitMax: number;
  /** Rate limit window in milliseconds (default 60000) */
  rateLimitWindowMs: number;
  /** Node environment: development | test | production (default development) */
  nodeEnv: string;
}

const REQUIRED_VARS = ['DATABASE_URL', 'NOTIFICATION_QUEUE_URL', 'DLQ_URL'] as const;

function asNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse and validate an environment variable source (defaults to `process.env`).
 * Throws an Error listing the required variables that are missing.
 * Separated into a pure function so it can be unit-tested with arbitrary sources.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED_VARS.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  return {
    databaseUrl: source.DATABASE_URL!,
    notificationQueueUrl: source.NOTIFICATION_QUEUE_URL!,
    dlqUrl: source.DLQ_URL!,
    notifyUrl: source.NOTIFY_URL ?? '',
    idempotencyTtlSeconds: asNumber(source.IDEMPOTENCY_TTL_SECONDS, 86400),
    rateLimitMax: asNumber(source.RATE_LIMIT_MAX, 100),
    rateLimitWindowMs: asNumber(source.RATE_LIMIT_WINDOW_MS, 60_000),
    nodeEnv: source.NODE_ENV ?? 'development',
  };
}

/** Lazily-parsed singleton config used by the running application.
 *  Lazy so importing the module (e.g. in unit tests) does not eagerly require env vars. */
let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv();
  }
  return cachedEnv;
}
