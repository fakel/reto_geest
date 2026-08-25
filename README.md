# RETO GEEST — Task Management API

API REST para la gestión y asignación de tareas, con archivado automático (todas las asignaciones completadas) y notificación transaccional vía webhook (SQS → Worker Lambda).

- **URL pública (desplegada):** `https://t5uepv43ei.execute-api.us-east-1.amazonaws.com`
- **Repositorio:** `github.com/fakel/reto_geest` (público)

## 1. Ejecución local

Requisitos: **Node.js ≥ 24** y **npm ≥ 10** (sin Docker ni PostgreSQL real para tests).

```bash
npm install          # 1. dependencias (workspaces)
cp .env.example .env # 2. variables de entorno (ver tabla)
npm run db:generate  # 3. genera el cliente Prisma
npm run test         # 4. tests (Vitest + pg-mem, 106 tests)
npm run dev          # 5. API local en http://localhost:3000
```

Scripts: `npm run typecheck` · `npm run lint` · `npm run build` · `npm run smoke:deploy` (health del despliegue, `API_URL=...`) · `npm run e2e:continuous` (monitor en bucle con log temporal por fecha).

Variables requeridas en `.env`: `DATABASE_URL`, `NOTIFICATION_QUEUE_URL`, `DLQ_URL`, `NOTIFY_URL`. Opcionales: `PORT`/`HOST`, `IDEMPOTENCY_TTL_SECONDS`, `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, `NODE_ENV`.

> **Deploy AWS**, stack CDK, variables de entorno finales y troubleshooting: **`DEPLOY.md`**. **SQL del esquema**: `packages/api/prisma/schema.sql`. **UML de la BD**: `docs/database-uml.md`.

## 2. Decisiones técnicas importantes

- **Fastify + TypeScript** sobre Express — tipado estricto y validación JSON Schema nativa; rendimiento y DX superiores (decisión de preferencia del equipo).
- **UUIDv7 como IDs** en vez de los IDs numéricos de los ejemplos — sin colisiones en distribución, generables en la capa de app (escalable).
- **Optimistic Concurrency Control (OCC)** para el archivado — `UPDATE ... WHERE id AND version` descarta archivos concurrentes (409 `VERSION_CONFLICT`) sin locks pesimistas que escalen mal en RDS.
- **Serverless AWS** (API Gateway + Lambda + RDS + SQS) contra contenedores 24/7 — costo bajo y alineado al presupuesto; API y Worker corren en VPC privada.
- **SQS + DLQ para notificaciones** — la API solo encola dentro de la **misma transacción Prisma** que archiva (si el enqueue falla, hace rollback); un Worker Lambda entrega el webhook y registra `NotificationAttempt`. Redrive SQS (3 intentos) → DLQ inspeccionable por `GET /admin/dlq`.
- **Prisma ORM v7 con driver adapter** — habilita `pg-mem` en tests (sin Base de Datos real); en deploy, la DDL canónica se aplica automáticamente con una Lambda custom resource.
- **Infra costo-consciente** — 2 AZ (exigencia de RDS), RDS `db.t3.micro` y NAT **instance** `t3.micro` (≈1/4 del costo de un NAT gateway).

## 3. Supuestos ante ambigüedades

- El "ID" de la especificación se interpretó como **UUIDv7**, no secuencia numérica.
- "Notificar al completar" se implementó como **webhook HTTP POST** a `NOTIFY_URL`. Sin webhook configurado, el Worker no crashea: no entrega, reintenta y deriva el mensaje a la DLQ.
- **Un único webhook global** (sin suscripciones por usuario).
- `Task.status` se modeló como **texto** (`open` | `archived`), no ENUM, por compatibilidad con `pg-mem` y migraciones simples.
- Sin autenticación establecida, la API es **pública** para el ejercicio.
- Nombre de Base de Datos fijo (`reto_geest`) y credenciales generadas por RDS + Secrets Manager.

## 4. Funcionalidades recortadas (por falta de tiempo/innecesarias para el ejercicio)

- **Autenticación/Autorización** (JWT/OAuth2): endpoints públicos.
- **Paginación y filtrado** de usuarios/tareas: listados completos.
- **Actualización / borrado de tareas**: solo flujo `open → archived`.
- **Backoff exponencial personalizado** para el webhook: se usa el redrive estándar de SQS (3 intentos) hacia la DLQ.
- **E2E contra AWS reales en CI**: los tests corren sobre `pg-mem`/mocks; hay scripts manuales (`smoke:deploy`, `e2e:continuous`) contra el despliegue.

---

*Documentación completa: `DEPLOY.md` · `docs/database-uml.md` · specs en `.kilo/specs/task-management-api/`.*