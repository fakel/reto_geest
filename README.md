# RETO GEEST - Task Management API

API REST para la gestión y asignación de tareas con archivado automático y notificaciones transaccionales.

## Stack Técnico
- **NodeJS + FastifyJS**
- **TypeScript + Prisma ORM** (v7 — driver adapter `@prisma/adapter-pg`)
- **Testing:** Vitest, `app.inject()` (integración), pg-mem con driver adaptador Prisma propio.
- **Infraestructura:** AWS CDK (Lambda, SQS, RDS PostgreSQL).

## Decisiones Técnicas y Supuestos
- **IDs por UUIDv7:** A diferencia de los ejemplos numéricos de la especificación original, usamos UUIDv7 para mayor resiliencia en un entorno escalable.
- **OCC vs Locks:** Elegimos Optimistic Concurrency Control para manejar las colisiones al archivar tareas en lugar de locks pesimistas, minimizando los cuellos de botella en RDS.
- **Entorno Local y E2E:** Reemplazamos PostgreSQL real por `pg-mem` en la suite de pruebas para evitar el overhead de Docker/LocalStack durante el CI, manteniendo una ejecución instantánea. Como el `@prisma/adapter-pg` stock es incompatible con pg-mem en Prisma ORM v7, los tests usan un driver adaptador propio (`tests/pg-mem-driver.ts`) que ejecuta el SQL generado por Prisma contra pg-mem.
- **Prisma ORM v7 (driver adapter):** La URL de conexión se mueve del `datasource` del schema a `prisma.config.ts` (para Migrate). El `PrismaClient` recibe un driver adapter (`@prisma/adapter-pg`) en el constructor; en tests se apunta el adapter a un pool de `pg-mem`.
- **Serverless API:** Desplegada en AWS Lambda en vez de contenedores activos 24/7.

## Instrucciones de Ejecución

Requisitos: **Node.js >= 24** y **npm >= 10**.

```bash
# 1. Instalar dependencias de todos los workspaces
npm install

# 2. Configurar variables de entorno (copiar template y ajustar)
cp .env.example .env

# 3. Generar el cliente Prisma (lee prisma.config.ts y .env)
npm run db:generate

# 4. Ejecutar la suite de pruebas (Vitest, sin necesidad de Docker/PostgreSQL)
npm run test

# 5. Lint de TypeScript (ESLint 9 + typescript-eslint)
npm run lint

# 6. Verificación de tipos en todos los paquetes
npm run typecheck

# 7. Build de api y worker
npm run build

# 8. Servidor de desarrollo local (api)
npm run dev
```

> `npm run dev` arranca `packages/api/src/index.ts` (vía `tsx watch`) y escucha en `PORT` (default 3000) / `HOST` (default 0.0.0.0): buildea el servidor con `buildApp()` y requiere `DATABASE_URL`, `NOTIFICATION_QUEUE_URL` y `DLQ_URL`.

### Scripts del monorepo (raíz)

| Script | Función |
|--------|---------|
| `npm run dev` | Servidor local de la API (watch, puerto 3000) |
| `npm run test` | Suite Vitest completa (`--passWithNoTests`) |
| `npm run test:watch` | Vitest en modo watch |
| `npm run lint` | ESLint 9 sobre todos los paquetes |
| `npm run typecheck` | `tsc --noEmit` en api, worker e infra |
| `npm run build` | Compila tsc de api y worker a `dist/` |
| `npm run db:generate` | Genera el Prisma Client (lee `prisma.config.ts`) |
| `npm run db:migrate` | Migraciones de Prisma (dev) |

> Nota: `npm run test` usa `--passWithNoTests` para que el pipeline CI salga limpio hasta que existan suites de pruebas (a partir de T-04). A día de hoy (T-16) la suite pasa **97 tests** en 15 archivos (api + worker), sin necesidad de Docker/PostgreSQL (pg-mem).

### Variables de Entorno

Copy `.env.example` → `.env` (ver `$ cp .env.example .env`). Variables requeridas:

| Variable | Requerida | Default | Uso |
|----------|-----------|---------|-----|
| `DATABASE_URL` | Sí | — | Conexión PostgreSQL (Migrate + Client) |
| `NOTIFICATION_QUEUE_URL` | Sí | — | SQS (sendMessage) de la API |
| `DLQ_URL` | Sí | — | SQS (polling DLQ) de la API |
| `NOTIFY_URL` | Sí | — | Webhook objetivo del Worker |
| `IDEMPOTENCY_TTL_SECONDS` | No | `86400` | TTL de idempotencia |
| `RATE_LIMIT_MAX` | No | `100` | Rate limit |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Ventana de rate limit |
| `NODE_ENV` | No | `development` | Logging / testing |

## Estructura del Monorepo

El proyecto es un **monorepo** gestionado con *npm workspaces*:

```
RETO GEEST/
├── packages/
│   ├── api/                    # Fastify REST API (handler de AWS Lambda)
│   │   ├── src/
│   │   │   ├── app.ts          # buildApp(): factory que cablea plugins + rutas
│   │   │   ├── index.ts        # Entrada local (npm run dev → PORT 3000)
│   │   │   ├── lambda.ts       # Handler AWS Lambda (API Gateway HTTP API v2)
│   │   │   ├── routes/         # users, tasks, assignments, completions, notifications, admin
│   │   │   ├── services/       # lógica de negocio (user, task, assign, complete, notification, idempotency, dlq)
│   │   │   ├── plugins/        # rate-limit, idempotency, sqs, error-handler
│   │   │   ├── schemas/        # JSON Schema (fastify) por recurso
│   │   │   └── config/         # env.ts y database.ts (singleton Prisma)
│   │   ├── prisma/             # schema.prisma + DDL
│   │   └── tests/              # suites Vitest + pg-mem (incl. app.test.ts, E2E helpers)
│   └── worker/                 # Lambda consumidora de SQS (webhook delivery)
│       ├── src/
│       │   ├── index.ts        # handler SQS (procesa records → webhook → log)
│       │   ├── webhook.ts      # POST a NOTIFY_URL con timeout (5xx → retry SQS)
│       │   ├── notification-log.ts # Insert de NotificationAttempt en RDS
│       │   └── config/env.ts   # DATABASE_URL + NOTIFY_URL
│       └── tests/              # worker.test.ts + setup pg-mem propio
├── infra/                      # Infraestructura AWS CDK (VPC, RDS, SQS/DLQ, Lambdas)
│   ├── bin/
│   │   └── app.ts              # Entrada CDK: Network → Database → Queue → API
│   └── lib/
│       ├── network-stack.ts    # VPC (single AZ) + NAT instance t3.micro + SG Lambdas
│       ├── database-stack.ts   # RDS PostgreSQL 16 (t3.micro free tier) + Secret
│       ├── queue-stack.ts      # SQS principal + DLQ + Worker Lambda (event source)
│       └── api-stack.ts        # API Lambda + HTTP API Gateway ($default)
├── cdk.out/                    # Salida de `cdk synth` (gitignored)
├── .kilo/specs/                # Especificaciones del proyecto (SDD: requirements, design, tasks)
├── vitest.config.ts            # Config Vitest (setupFiles + inclusion de tests)
├── .husky/                     # Hooks de git (commit-msg, pre-commit)
├── commitlint.config.js        # Validación Conventional Commits
├── eslint.config.mjs           # Config ESLint 9 (flat config)
├── tsconfig.base.json          # Opciones TS compartidas
└── package.json                # Raíz (workspaces + scripts)
```

## Herramientas de Desarrollo

- **TypeScript** — compilación tipada en todos los paquetes (config base en `tsconfig.base.json`).
- **Vitest** — test runner (unit + E2E con `pg-mem`, sin infraestructura real). Los E2E usan `app.inject()` sobre el mismo `buildApp()` de producción.
- **ESLint 9** (flat config) + **typescript-eslint** — calidad de código.
- **husky + commitlint** — validan los mensajes de commit en formato **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, etc.) mediante hooks de git.
- **lint-staged** — ejecuta lint sobre los archivos staged en `pre-commit`.
- **AWS CDK v2** — definición de infraestructura como código en `infra/`.


## Estrategia de desarrollo

Se requiere un desarrollo ASAP, por lo que usaremos una estrategia de desarrollo con Agentes e IA basada en especificaciones.

En la carpeta `.kilo/specs/` podrá encontrar las especificaciones iniciales (requirements, design y tasks) definidas en conjunto de IA. El avance se lleva en `.kilo/specs/task-management-api/tasks.md`.

## Estado del proyecto (Tasks)

| Etapa | Estado |
|-------|--------|
| T-01 a T-13 | ✅ Completado y commiteado |
| T-14 | ✅ Completado (app factory + Lambda handler + dev server) |
| T-15 | ✅ Completado (admin DLQ endpoint) |
| T-16 | ✅ Completado (worker SQS + webhook delivery) |
| T-17 | ✅ Completado (CDK infra: single-AZ + single-NAT) |
| T-18 | ✅ Completado (E2E: full workflow + OCC concurrencia) |

## Despliegue en AWS (CDK)

La infraestructura se define como código en `infra/` con **AWS CDK v2** y se compone de 4 stacks en orden: **Network → Database → Queue → API**.

- **`NetworkStack`** — VPC single-AZ (una AZ, 1 subnet privada + 1 pública) con **1 NAT instance** (`t3.micro`, Amazon Linux 2023) para egress de las Lambdas, y SG compartido de Lambdas.
- **`DatabaseStack`** — RDS PostgreSQL 16 (`db.t3.micro`, *free-tier*), single-AZ, no público; credenciales auto-generadas en **Secrets Manager**; expone `DATABASE_URL` resuelto en deploy.
- **`QueueStack`** — SQS principal (`maxReceiveCount: 3`, visibility 30s) con **DLQ** (retención 14 días) + **Worker Lambda** (NodeJS 24.x) con event source SQS.
- **`ApiStack`** — **API Lambda** (NodeJS 24.x, 512 MB, 29s) expuesta por **API Gateway HTTP API** (`$default` → proxy), con colas y rate-limit cableados.

Comandos (desde `infra/`):

```bash
npm run synth    # cdk synth — valida y genera cdk.out/
npm run deploy   # cdk deploy --all — despliega los 4 stacks
npm run diff     # cdk diff — cambios pendientes
```

> Requiere credenciales AWS configuradas (`aws configure` / SSO) y `NOTIFY_URL` en el entorno para el Worker. Diseño orientado a *free tier* (single-AZ, `db.t3.micro` en RDS y NAT instance), reemplazando el NAT **gateway** gestionado por una **NAT instance EC2** (`t3.micro`) para reducir el costo de egress.

## Nota

Se ha decidido usar Fastify sobre Express por gusto y diversidad. 

## Mejoras Futuras
- **Autenticación y Autorización:** Implementar JWT o OAuth2 para proteger los endpoints.
- **Paginación y Filtrado:** Añadir soporte para paginación y filtrado de tareas y usuarios.

## Costos de desarrollo IA

- Definición de SDD: DeepSeek V4 Pro/$0.15 [commit 7d00d1a]
- T-01: DeepSeek V4 Flash/$0.06 [commit aa14d64]
- T-02: DeepSeek V4 Flash/$0.12 [commit d4bc8fd]
- T-03: DeepSeek V4 Flash/$0.06 [commit 8b4e930]
- T-04: DeepSeek V4 Flash/$0.06 [commit b7e3bb6]
- T-05: DeepSeek V4 Flash/$0.04 [commit e040dd3]
- T-06: DeepSeek V4 Flash/$0.04 [commit f2cac68]
- T-07: DeepSeek V4 Flash/$0.02 [commit d156157]
- T-08: DeepSeek V4 Flash/$0.05 [commit 658d385]
- T-09: DeepSeek V4 Flash/$0.05 [commit 86cbfc0]
- T-10: DeepSeek V4 Flash/$0.03 [commit e831be4]
- T-11: DeepSeek V4 Flash/$0.05 [commit 99a76cc]
- T-12: DeepSeek V4 Flash/$0.13 [commit 2e7eb5b]
- T-13: DeepSeek V4 Flash/$0.13 [commit 3cfe4db]
- T-14: DeepSeek V4 Flash/$0.04 [commit 58beb5c]
- T-15: DeepSeek V4 Flash/$0.04 [commit 977671d]
- T-16: DeepSeek V4 Flash/$0.06 [commit 22959c6]
- T-17: DeepSeek V4 Flash/$0.09 [commit a7380c0]
- T-18: DeepSeek V4 Flash/$0.09 [commit 00e9bfa]