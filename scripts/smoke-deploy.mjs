#!/usr/bin/env node
/**
 * Smoke test del despliegue (equivalente a la sección "Verificación post-despliegue"
 * de DEPLOY.md, pero en Node.js con fetch nativo — sin dependencias).
 *
 * Una vez desplegada la API en AWS, ejecuta el flujo completo:
 *   health → crear usuario → crear task → asignar → completar → notificaciones → DLQ
 *
 * Requiere Node >= 20 (fetch global). Uso:
 *   API_URL="<API_URL>" node scripts/smoke-deploy.mjs
 *
 * Salida: imprime cada paso y, ante un error (status inesperado o error de red),
 * muestra el cuerpo de la respuesta devuelta por la API. Sale con código 0 si
 * todo pasó, 1 si algo falló.
 */

const API = (process.env.API_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

if (!API) {
  console.error('ERROR: define API_URL con la URL del API Gateway desplegado.');
  console.error('  Ej: API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com node scripts/smoke-deploy.mjs');
  process.exit(2);
}

const failed = [];
let passes = 0;

function ok(label, detail = '') {
  passes += 1;
  console.log(`  ${label}${detail ? ` — ${detail}` : ''}`);
}

function bad(label, detail = '') {
  failed.push(label);
  console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Petición JSON con timeout. */
async function api(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Convierte la respuesta (body) en texto legible para mostrar errores. */
function describeData(data) {
  if (data == null) return '';
  try {
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/** Helper con timeout para un paso y chequeo de status. */
async function step(label, method, path, { body, expectStatus } = {}) {
  try {
    const { status, data } = await api(method, path, body);
    const dataText = describeData(data);
    if (Array.isArray(expectStatus)) {
      if (!expectStatus.includes(status)) {
        bad(label, `status ${status} (esperado ${expectStatus.join(', ')}). Respuesta: ${dataText}`);
        return { status, data };
      }
    } else if (expectStatus != null && status !== expectStatus) {
      bad(label, `status ${status} (esperado ${expectStatus}). Respuesta: ${dataText}`);
      return { status, data };
    }
    if (status >= 400) {
      // Es un paso informativo (p. ej. /admin/dlq): avisamos del error pero no
      // lo marcamos como fallo si no se exigía un status concreto.
      console.error(`  [!] ${label} → status ${status}. Respuesta: ${dataText}`);
    }
    ok(label, `HTTP ${status}`);
    return { status, data };
  } catch (err) {
    bad(label, `${String(err.message || err)}`);
    return { status: 0, data: null };
  }
}

async function main() {
  console.log(`\nSmoke-test del despliegue — target: ${API}\n`);

  // 1. Health check
  const health = await step('GET /health', 'GET', '/health', { expectStatus: 200 });
  if (health.status !== 200 || health.data?.status !== 'ok') {
    bad('/health responde {status: "ok"}', JSON.stringify(health.data));
  } else {
    ok('/health responde {status: "ok"}');
  }

  // 2. Crear usuario
  const name = `smoke-${Date.now()}`;
  const user = await step('POST /users', 'POST', '/users', {
    body: { name, lastName: 'Test', email: `${name}@example.com` },
    expectStatus: 201,
  });
  const userId = user.data?.id;
  if (!userId) return finish();
  ok('se obtuvo el id de usuario');

  // 3. Crear task
  const task = await step('POST /tasks', 'POST', '/tasks', {
    body: { title: 'Tarea smoke test' },
    expectStatus: 201,
  });
  const taskId = task.data?.id;
  if (!taskId) return finish();

  // 4. Asignar usuario al task
  const assign = await step('POST /tasks/:id/assign', 'POST', `/tasks/${taskId}/assign`, {
    body: { userIds: [userId] },
    expectStatus: 200,
  });
  const assignedOk = Array.isArray(assign.data) && assign.data.length === 1;
  if (assignedOk) ok('asignación confirmada (1 asignado)');
  else bad('asignación confirmada (1 asignado)', JSON.stringify(assign.data));

  // 5. Completar (único asignado → archiva y encola notificación)
  const complete = await step('POST /tasks/:id/complete', 'POST', `/tasks/${taskId}/complete`, {
    body: { userId },
    expectStatus: 200,
  });
  const archived = complete.data?.archived === true;
  if (archived) ok('la tarea quedó archivada (archived: true)');
  else bad('la tarea quedó archivada (archived: true)', JSON.stringify(complete.data));

  // 6. Historial de notificaciones (puede tardar por el Worker; no exige contenido)
  await step('GET /tasks/:id/notifications', 'GET', `/tasks/${taskId}/notifications`, {
    expectStatus: 200,
  });

  // 7. Inspeccionar DLQ (puede estar vacía)
  await step('GET /admin/dlq', 'GET', '/admin/dlq', { expectStatus: 200 });

  finish();
}

function finish() {
  const total = failed.length;
  console.log(`\nResumen: ${passes} comprobaciones OK, ${total} fallos.\n`);
  if (total > 0) {
    console.error('Comprobaciones fallidas:', failed.join(', '));
    process.exit(1);
  }
  console.log('✅ Despliegue verificado.\n');
  process.exit(0);
}

try {
  await main();
} catch (err) {
  console.error('\nError inesperado:', err.message || err);
  process.exit(1);
}