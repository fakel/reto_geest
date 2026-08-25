/**
 * Worker environment configuration (T-16).
 *
 * Parses and validates the variables the SQS consumer Lambda needs:
 *   - DATABASE_URL : PostgreSQL connection (Prisma Client) — required
 *   - NOTIFY_URL   : external webhook URL to POST notifications to — required
 *
 * Mirrors the API's `env.ts` conventions (parseEnv/getEnv, fail-fast on
 * missing required vars) so a misconfigured worker fails at boot, not mid-event.
 */

export interface Env {
  /** PostgreSQL connection string (required) — used by Prisma Client. */
  databaseUrl: string;
  /** External webhook target (required) — where archived-task notifications go. */
  notifyUrl: string;
  /** Node environment: development | test | production (default development). */
  nodeEnv: string;
}

const REQUIRED_VARS = ['DATABASE_URL', 'NOTIFY_URL'] as const;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED_VARS.filter((key) => !source[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return {
    databaseUrl: source.DATABASE_URL!,
    notifyUrl: source.NOTIFY_URL!,
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
