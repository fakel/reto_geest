#!/usr/bin/env node
/**
 * E2E suite continua — corre en bucle contra el servicio desplegado hasta que
 * se sale (Ctrl+C / SIGTERM), ejecutando en cada ronda un escenario completo de
 * flujos de exito y error, y llevando el acumulado de resultados por check.
 *
 * Flujos cubiertos por ronda:
 *   health · user.create · user.duplicate(409) · user.invalid(400)
 *   task.create · task.get.404 · task.complete.notFound(404)
 *   task.assign · task.assignDuplicate(409) · task.complete.unassigned(409)
 *   task.complete.partial · task.complete.archive · task.complete.duplicate(409)
 *   task.notifications · admin.dlq
 *
 * Configuracion (env):
 *   E2E_API_URL              URL de la API (fallback: API_URL)
 *   E2E_TIMEOUT_MS           timeout por peticion (default 15000)
 *   E2E_INTERVAL_MS          pausa entre rondas (default 10000; ver rate-limit)
 *   E2E_MAX_ROUNDS           maximo de rondas (default: infinito)
 *   E2E_ONCE=1               una sola ronda y salir (util en CI)
 *   E2E_FAIL_FAST=1          salir con codigo 1 a la primera comprobacion fallida
 *   E2E_VERIFY_NOTIFICATION=1  verifica (con polling) que el Worker persiste la
 *                              NotificationAttempt del archivo (mas lento)
 *   E2E_LOG_DIR                carpeta del log (default <repo>/logs)
 *   E2E_LOG_FILE               ruta completa del log (default logs/e2e-<fecha>.log)
 *
 * LOGGEO: cada corrida escribe en un archivo `logs/e2e-<fecha-hora>.log` (una
 * linea por check: PASS/FAIL nombre, cuentas por ronda y resumen final), para
 * poder auditar el estado de los flujos a lo largo del tiempo.
 *
 * Si la API devuelve 429 (rate limit) la peticion se reintenta con backoff y,
 * si persiste, se cuenta como "skipped" en vez de fallo. Para ritmos altos,
 * sube RATE_LIMIT_MAX en la ApiStack (p. ej. 10000).
 *
 * Salida: tabla acumulada por check tras cada ronda y resumen final.
 * Exit: 0 si no hay fallos, 1 si los hay (o E2E_FAIL_FAST).
 */

const API = (process.env.E2E_API_URL || process.env.API_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 15000);
const INTERVAL_MS = Number(process.env.E2E_INTERVAL_MS || 10000);
const MAX_ROUNDS = Number(process.env.E2E_MAX_ROUNDS || Infinity);
const ONCE = process.env.E2E_ONCE === '1';
const FAIL_FAST = process.env.E2E_FAIL_FAST === '1';
const VERIFY_NOTIFY = process.env.E2E_VERIFY_NOTIFICATION === '1';

// ---- Loggeo de la corrida a archivo (nombre por fecha de ejecución) ----
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const LOG_DIR = process.env.E2E_LOG_DIR || path.join(__dirname, '..', 'logs');
/** Nombre del archivo p. ej. e2e-2026-08-25T09.csv (hora local). */
const runStamp = new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[:T]/g, '-');
const LOG_FILE = process.env.E2E_LOG_FILE || path.join(LOG_DIR, `e2e-${runStamp}.log`);
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

/** Escribe una línea en el archivo de log (con marca temporal). */
function logLine(line) {
  logStream.write(`[${now()}] ${line}\n`);
}

// Se vuelca el buffer al salir (SIGINT/SIGTERM/main).
process.on('exit', () => logStream.end());

if (!API) {
  console.error('ERROR: define E2E_API_URL (o API_URL) con la URL del API Gateway desplegado.');
  console.error('  Ej: E2E_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com node scripts/e2e-continuous.mjs');
  process.exit(2);
}

/** Contador acumulado por check: { pass, fail, skip, lastError }. */
const stats = new Map();
let running = true;
let roundNo = 0;
const totalStart = Date.now();
const RATE_HINT = `(429) si la API esta rate-limited, sube RATE_LIMIT_MAX o aumenta E2E_INTERVAL_MS`;

function getStat(name) {
  if (!stats.has(name)) stats.set(name, { pass: 0, fail: 0, skip: 0, lastError: '' });
  return stats.get(name);
}

function now() {
  return new Date().toISOString().slice(11, 19);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET/POST con timeout y reintento por 429 (backoff). */
async function req(method, path, body) {
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`red: ${err.message}`);
    }
    clearTimeout(timer);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    if (res.status === 429 && attempts <= 3) {
      await sleep(5000);
      continue;
    }
    return { status: res.status, data };
  }
}

/** Verifica status y, opcionalmente, codigo de error. Devuelve {ok, reason}. */
function expect(res, status, code) {
  if (res.status !== status) {
    return { ok: false, reason: `HTTP ${res.status} (esperado ${status}): ${describe(res.data)}` };
  }
  if (code != null) {
    const got = res.data?.error?.code;
    if (got !== code) {
      return { ok: false, reason: `error.code=${got} (esperado ${code}): ${describe(res.data)}` };
    }
  }
  return { ok: true };
}

function describe(data) {
  if (data == null) return '';
  try {
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/** Acorta un UUID para logs. */
function short(id) {
  return id ? (id.length > 8 ? `${id.slice(0, 8)}…` : id) : '∅';
}

/** Ejecuta una comprobacion y actualiza el acumulado. */
async function check(name, fn) {
  const s = getStat(name);
  if (!running && !ONCE) return;
  try {
    const r = await fn();
    if (r.ok) {
      s.pass += 1;
      logLine(`PASS ${name}${r.detail ? ` — ${r.detail}` : ''}`);
    } else {
      s.fail += 1;
      s.lastError = r.reason;
      const msg = `FAIL ${name} — ${r.reason}`;
      console.error(`  [FAIL] ${name} — ${r.reason}`);
      logLine(msg);
      if (FAIL_FAST) {
        running = false;
      }
    }
  } catch (err) {
    s.fail += 1;
    s.lastError = String(err.message || err);
    const msg = `FAIL ${name} — ${s.lastError}`;
    console.error(`  [FAIL] ${name} — ${s.lastError}`);
    logLine(msg);
    if (FAIL_FAST) running = false;
  }
}

/** Crea un usuario, guarda el id en ctx y reporta ese id como detalle. */
async function createUser(ctx, tag) {
  const email = `${ctx.base}-${tag}@example.com`;
  const res = await req('POST', '/users', { name: `E2E${tag}`, lastName: 'Runner', email });
  const ok = expect(res, 201);
  if (!ok.ok) {
    await check(`user.create.${tag}`, async () => ok);
    return false;
  }
  ctx[tag] = res.data.id;
  await check(`user.create.${tag}`, async () => ({
    ok: true,
    detail: `id=${short(res.data.id)} email=${email}`,
  }));
  return true;
}

async function round() {
  const ctx = { base: `e2e-${roundNo}-${Date.now()}` };
  const started = Date.now();

  // ---- Health ----
  await check('health', async () => {
    const r = await req('GET', '/health');
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    return r.data?.status === 'ok'
      ? { ok: true }
      : { ok: false, reason: `body.status=${r.data?.status}` };
  });

  // ---- Users ----
  await check('user.create', async () => {
    const email = `${ctx.base}@example.com`;
    const r = await req('POST', '/users', { name: 'E2E', lastName: 'Runner', email });
    if (r.status === 201) ctx.user1 = r.data.id;
    const ok = expect(r, 201);
    if (!ok.ok) return ok;
    return { ok: true, detail: `id=${short(r.data.id)} email=${email}` };
  });
  if (!ctx.user1) return; // prerequisito fallido: abortar ronda

  await check('user.duplicate', async () => {
    const r = await req('POST', '/users', { name: 'E2E', lastName: 'Dup', email: `${ctx.base}@example.com` });
    const ok = expect(r, 409, 'EMAIL_ALREADY_EXISTS');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  await check('user.invalid', async () => {
    const r = await req('POST', '/users', { name: 'SoloNombre' });
    const ok = expect(r, 400, 'VALIDATION_ERROR');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  await check('user.tasks.404', async () => {
    const r = await req('GET', `/users/00000000-0000-4000-8000-000000000000/tasks`);
    const ok = expect(r, 404, 'USER_NOT_FOUND');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  if (!(await createUser(ctx, 'user2'))) return;
  if (!(await createUser(ctx, 'user3'))) return; // sin asignar (flujo unassigned)

  // ---- Tasks ----
  await check('task.create', async () => {
    const r = await req('POST', '/tasks', { title: `Tarea ${ctx.base}` });
    if (r.status === 201) ctx.taskId = r.data.id;
    const ok = expect(r, 201);
    if (!ok.ok) return ok;
    return { ok: true, detail: `id=${short(r.data.id)} status=${r.data.status}` };
  });
  if (!ctx.taskId) return;

  await check('task.complete.notFound', async () => {
    const r = await req('POST', '/tasks/00000000-0000-4000-8000-000000000000/complete', { userId: ctx.user1 });
    const ok = expect(r, 404, 'TASK_NOT_FOUND');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  await check('task.complete.unassigned', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/complete`, { userId: ctx.user3 });
    const ok = expect(r, 409, 'USER_NOT_ASSIGNED');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  await check('task.assign', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/assign`, { userIds: [ctx.user1, ctx.user2] });
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    return { ok: true, detail: `assignees=${Array.isArray(r.data) ? r.data.length : 0} (${short(ctx.user1)},${short(ctx.user2)})` };
  });

  await check('task.assignDuplicate', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/assign`, { userIds: [ctx.user1] });
    const ok = expect(r, 409, 'USER_ALREADY_ASSIGNED');
    if (!ok.ok) return ok;
    return { ok: true, detail: `code=${r.data?.error?.code}` };
  });

  await check('task.complete.partial', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/complete`, { userId: ctx.user1 });
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    return { ok: true, detail: `archived=${r.data?.archived}` };
  });

  await check('task.complete.archive', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/complete`, { userId: ctx.user2 });
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    return r.data?.archived === true
      ? { ok: true, detail: `archived=true task=${short(ctx.taskId)}` }
      : { ok: false, reason: `archived=${r.data?.archived} (esperado true)` };
  });

  await check('task.complete.duplicate', async () => {
    const r = await req('POST', `/tasks/${ctx.taskId}/complete`, { userId: ctx.user1 });
    // Tras archivar, el segundo complete puede ser TASK_ALREADY_ARCHIVED o ALREADY_COMPLETED.
    const ok = expect(r, 409);
    if (!ok.ok) return ok;
    const code = r.data?.error?.code;
    return ['TASK_ALREADY_ARCHIVED', 'ALREADY_COMPLETED'].includes(code)
      ? { ok: true, detail: `code=${code}` }
      : { ok: false, reason: `error.code=${code} (esperado TASK_ALREADY_ARCHIVED|ALREADY_COMPLETED)` };
  });

  // ---- Notificaciones (200 + array) ----
  await check('task.notifications', async () => {
    const r = await req('GET', `/tasks/${ctx.taskId}/notifications`);
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    if (!Array.isArray(r.data)) return { ok: false, reason: 'body no es array' };
    const fits = r.data.map((n) => `#${n.attemptNumber}=${n.status}(${n.statusCode ?? ''})`);
    return { ok: true, detail: `count=${r.data.length} [${fits.join(', ')}]` };
  });

  // ---- Verificacion opcional del pipeline Worker -> RDS ----
  if (VERIFY_NOTIFY) {
    await check('task.notifications.persisted', async () => {
      const deadline = Date.now() + 30_000;
      // eslint-disable-next-line no-constant-condition
      while (Date.now() < deadline) {
        const r = await req('GET', `/tasks/${ctx.taskId}/notifications`);
        if (r.status === 200 && Array.isArray(r.data) && r.data.length >= 1) {
          const n = r.data[0];
          return {
            ok: true,
            detail: `count=${r.data.length} first=#${n.attemptNumber}/${n.status}(${n.statusCode ?? ''})`,
          };
        }
        await sleep(3000);
      }
      return { ok: false, reason: 'el Worker no persistio la NotificationAttempt en 30s' };
    });
  }

  // ---- DLQ (200 + array; puede estar vacia) ----
  await check('admin.dlq', async () => {
    const r = await req('GET', '/admin/dlq');
    const ok = expect(r, 200);
    if (!ok.ok) return ok;
    if (!Array.isArray(r.data)) return { ok: false, reason: 'body no es array' };
    const ids = r.data.map((m) => m.messageId).join(',');
    return { ok: true, detail: `count=${r.data.length}${ids ? ` msgs=[${ids}]` : ''}` };
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const fail = [...stats.values()].reduce((a, s) => a + s.fail, 0);
  const pass = [...stats.values()].reduce((a, s) => a + s.pass, 0);
  console.log(`\n[${now()}] ronda ${roundNo} — ${pass} OK / ${fail} fallos — ${elapsed}s`);
  logLine(`ROUND ${roundNo} end — ${pass} OK / ${fail} fallos (${elapsed}s)`);
  if (fail > 0) console.log(`  aviso: hay fallos acumulados; ${RATE_HINT}`);
}

function printTable() {
  const rows = [...stats.entries()].sort((a, b) => b[1].pass - a[1].pass);
  if (rows.length === 0) return;
  const nameW = Math.max(...rows.map(([n]) => n.length), 12);
  const header = `${'check'.padEnd(nameW)}  ok    fail  skip  rate`;
  console.log('\n' + header);
  console.log('-'.repeat(header.length));
  for (const [name, s] of rows) {
    const total = s.pass + s.fail + s.skip;
    const rate = total === 0 ? '—' : `${(((s.pass + s.skip) / total) * 100).toFixed(0)}%`;
    console.log(`${name.padEnd(nameW)}  ${String(s.pass).padStart(4)}  ${String(s.fail).padStart(4)}  ${String(s.skip).padStart(4)}  ${rate}`);
  }
}

function summary() {
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(0);
  const rows = [...stats.values()];
  const pass = rows.reduce((a, s) => a + s.pass, 0);
  const fail = rows.reduce((a, s) => a + s.fail, 0);
  const skip = rows.reduce((a, s) => a + s.skip, 0);
  console.log(`\n========== RESUMEN E2E (${roundNo} rondas, ${elapsed}s) ==========`);
  printTable();
  console.log(`\nTotales: ${pass} OK, ${fail} fallos, ${skip} skipped (${roundNo} rondas).`);
  console.log(`Log de la corrida: ${LOG_FILE}`);
  logLine(`SUMMARY — ${pass} OK, ${fail} fallos, ${skip} skipped (${roundNo} rondas, ${elapsed}s)`);
  const failedChecks = [...stats.entries()].filter(([, s]) => s.fail > 0);
  if (failedChecks.length > 0) {
    console.error('\nComprobaciones con fallos:');
    for (const [name, s] of failedChecks) {
      console.error(`  - ${name} (${s.fail} fallos) ultimo: ${s.lastError}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

function stop() {
  running = false;
}

process.on('SIGINT', () => {
  console.log('\n[SIGINT] deteniendo...');
  logLine('SIGINT received');
  stop();
});
process.on('SIGTERM', () => {
  console.log('\n[SIGTERM] deteniendo...');
  logLine('SIGTERM received');
  stop();
});

async function main() {
  console.log(`\nE2E continua — target: ${API}`);
  console.log(`Log de la corrida: ${LOG_FILE}`);
  console.log(`intervalo ${INTERVAL_MS}ms · timeout ${TIMEOUT_MS}ms · maxRondas ${Number.isFinite(MAX_ROUNDS) ? MAX_ROUNDS : 'inf'} · verifyNotify ${VERIFY_NOTIFY} · failFast ${FAIL_FAST}`);
  console.log('Ctrl+C para detener y ver el resumen.\n');
  logLine(`START target=${API} intervalo=${INTERVAL_MS} timeout=${TIMEOUT_MS}`);
  // eslint-disable-next-line no-constant-condition
  while (running) {
    roundNo += 1;
    await round();
    if (!running) break;
    if (Number.isFinite(MAX_ROUNDS) && roundNo >= MAX_ROUNDS) break;
    if (ONCE) break;
    await sleep(INTERVAL_MS);
  }
  summary();
}

try {
  await main();
} catch (err) {
  console.error('\nError inesperado:', err.message || err);
  process.exit(1);
}
