import { buildApp } from './app';
import { getEnv } from './config/env';

/**
 * Local development entry point (T-14).
 *
 * Builds the full app and listens on PORT (default 3000). Requires the env
 * vars documented in `.env.example` (DATABASE_URL, NOTIFICATION_QUEUE_URL,
 * DLQ_URL). On any startup error the process exits non-zero so `npm run dev`
 * surfaces failures immediately.
 */

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start(): Promise<void> {
  // Validate env up front so a missing required var fails fast with a clear
  // message instead of a crash deep inside a plugin.
  getEnv();

  const app = await buildApp({ logger: true });

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Task Management API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();