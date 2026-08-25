# Phase 2: Design - Task Management API

## 1. Monorepo Directory Structure

```
RETO GEEST/
├── packages/
│   ├── api/                          # Fastify REST API (Lambda handler)
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point: Fastify app factory
│   │   │   ├── lambda.ts             # AWS Lambda wrapper (aws-lambda-fastify)
│   │   │   ├── app.ts                # Fastify instance + plugin registration
│   │   │   ├── config/
│   │   │   │   └── env.ts            # Environment variable parsing (dotenv + validation)
│   │   │   ├── plugins/
│   │   │   │   ├── idempotency.ts    # Global idempotency plugin (onRequest/onSend hooks)
│   │   │   │   ├── rate-limit.ts     # Rate limiting plugin (@fastify/rate-limit)
│   │   │   │   ├── error-handler.ts  # Standardized error formatting
│   │   │   │   └── sqs.ts            # SQS client decorator (fastify.decorate)
│   │   │   ├── routes/
│   │   │   │   ├── users.ts          # POST /users, GET /users, GET /users/:id/tasks
│   │   │   │   ├── tasks.ts          # POST /tasks, GET /tasks, GET /tasks/:id
│   │   │   │   ├── assignments.ts    # POST /tasks/:id/assign
│   │   │   │   ├── completions.ts    # POST /tasks/:id/complete
│   │   │   │   ├── notifications.ts  # GET /tasks/:id/notifications
│   │   │   │   └── admin.ts          # GET /admin/dlq
│   │   │   ├── services/
│   │   │   │   ├── user.service.ts   # User CRUD + email uniqueness check
│   │   │   │   ├── task.service.ts   # Task CRUD + list filtering
│   │   │   │   ├── assign.service.ts # Assignment logic (validate users, check duplicates)
│   │   │   │   ├── complete.service.ts # Completion logic + OCC archive + SQS enqueue
│   │   │   │   ├── notification.service.ts # NotificationAttempt queries
│   │   │   │   ├── dlq.service.ts    # SQS DLQ polling via AWS SDK
│   │   │   │   └── idempotency.service.ts # IdempotencyKey CRUD + cache lookup
│   │   │   └── schemas/
│   │   │       ├── user.schema.ts    # Fastify JSON Schema for user DTOs
│   │   │       ├── task.schema.ts    # Fastify JSON Schema for task DTOs
│   │   │       └── error.schema.ts   # Standard error response schema
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Database schema
│   │   │   └── migrations/           # Prisma migrations (git-tracked)
│   │   ├── tests/
│   │   │   ├── setup.ts              # pg-mem + prisma-mock setup
│   │   │   ├── helpers.ts            # Test factory helpers (createUser, createTask, etc.)
│   │   │   ├── users.test.ts         # US-01, US-06, US-07
│   │   │   ├── tasks.test.ts         # US-02, US-05, US-08
│   │   │   ├── assignments.test.ts   # US-03
│   │   │   ├── completions.test.ts   # US-04 (including OCC edge cases)
│   │   │   ├── notifications.test.ts # US-09
│   │   │   ├── admin.test.ts         # US-11 (DLQ)
│   │   │   ├── idempotency.test.ts   # US-12
│   │   │   └── rate-limit.test.ts    # US-10
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── worker/                       # SQS Consumer Lambda
│       ├── src/
│       │   ├── index.ts              # Lambda handler (SQS event → POST webhook)
│       │   ├── webhook.ts            # HTTP POST to NOTIFY_URL with retry logic
│       │   ├── notification-log.ts   # Inserts NotificationAttempt into RDS
│       │   └── config/
│       │       └── env.ts            # NOTIFY_URL, DB connection
│       ├── tests/
│       │   └── worker.test.ts        # Webhook delivery + retry tests
│       ├── package.json
│       └── tsconfig.json
│
├── infra/                            # AWS CDK
│   ├── bin/
│   │   └── app.ts                    # CDK app entry
│   ├── lib/
│   │   ├── database-stack.ts         # RDS PostgreSQL + security groups
│   │   ├── api-stack.ts             # Lambda + API Gateway
│   │   ├── queue-stack.ts           # SQS (main + DLQ) + Worker Lambda
│   │   └── network-stack.ts         # VPC, subnets (if needed)
│   ├── package.json
│   └── cdk.json
│
├── .husky/
│   ├── commit-msg                   # commitlint hook
│   └── pre-commit                   # lint-staged
├── commitlint.config.js
├── package.json                     # Root workspace config (npm workspaces)
└── tsconfig.base.json               # Shared TS config
```

---

## 2. Data Models (Prisma Schema)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"     // Prisma ORM v7: no `url` here — connection handled by driver adapter
}

model User {
  id        String   @id @default(uuid())     // UUIDv7 generated at app layer
  name      String
  lastName  String   @map("last_name")
  email     String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  taskAssignments TaskAssignment[]

  @@map("users")
}

model Task {
  id          String   @id @default(uuid())   // UUIDv7 generated at app layer
  title       String
  description String?                          // optional, from US-02 update
  status      String   @default("open")       // "open" | "archived"
  version     Int      @default(0)            // Optimistic Concurrency Control
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  taskAssignments  TaskAssignment[]
  notificationAttempts NotificationAttempt[]

  @@map("tasks")
}

model TaskAssignment {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  taskId    String   @map("task_id")
  completed Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([userId, taskId])       // prevents duplicate assignments
  @@map("task_assignments")
}

model IdempotencyKey {
  id            String   @id
  keyHash       String   @unique @map("key_hash")     // SHA-256 of Idempotency-Key header
  method        String                                  // HTTP method
  path          String                                  // Request path
  responseStatus Int     @map("response_status")        // Cached HTTP status code
  responseBody  String   @map("response_body")          // Cached JSON response
  createdAt     DateTime @default(now()) @map("created_at")
  expiresAt     DateTime @map("expires_at")             // TTL-based expiration

  @@index([keyHash, method, path])
  @@index([expiresAt])
  @@map("idempotency_keys")
}

model NotificationAttempt {
  id           String   @id @default(uuid())
  taskId       String   @map("task_id")
  status       String                              // "pending" | "success" | "failed"
  statusCode   Int?     @map("status_code")        // HTTP status from webhook response
  responseBody String?  @map("response_body")      // Truncated response
  attemptNumber Int     @map("attempt_number")      // 1, 2, or 3
  createdAt    DateTime @default(now()) @map("created_at")

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@map("notification_attempts")
}
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `Task.status` as String (not Enum) | Prisma enums require native PG enum types; using String with app-level validation simplifies migration + pg-mem compatibility. |
| `version` as `Int @default(0)` | Simple OCC. On archive: `UPDATE tasks SET status='archived', version=version+1 WHERE id=X AND version=Y`. If 0 rows affected → conflict. |
| `@@unique([userId, taskId])` | Database-level enforcement of no-duplicate-assignments (EC in US-03). |
| `IdempotencyKey` with `expiresAt` | TTL-based cleanup. A scheduled cleanup (or lazy deletion) removes expired keys. |
| `NotificationAttempt` linked to `Task` via FK | Allows `GET /tasks/:id/notifications` to JOIN efficiently. |
| `onDelete: Cascade` on TaskAssignment | If a user or task is deleted, assignments are removed automatically. |

---

## 3. API Design (Fastify Routes)

### Route Tree

```
fastify
├── POST   /users                          → routes/users.ts
├── GET    /users                          → routes/users.ts
├── GET    /users/:idUser/tasks            → routes/users.ts
├── POST   /tasks                          → routes/tasks.ts
├── GET    /tasks                          → routes/tasks.ts
├── GET    /tasks/:idTask                  → routes/tasks.ts
├── POST   /tasks/:idTask/assign           → routes/assignments.ts
├── POST   /tasks/:idTask/complete         → routes/completions.ts
├── GET    /tasks/:idTask/notifications    → routes/notifications.ts
└── GET    /admin/dlq                      → routes/admin.ts
```

### Schemas & Validation

Every route registers a Fastify JSON Schema for request validation (body, params, querystring) and response serialization. Example:

```typescript
// schemas/task.schema.ts
export const createTaskSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title:       { type: 'string', minLength: 1, transform: ['trim'] },
      description: { type: 'string', minLength: 1 }      // optional per US-02 update
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id:          { type: 'string', format: 'uuid' },
        title:       { type: 'string' },
        description: { type: 'string' },
        status:      { type: 'string', enum: ['open'] },
        version:     { type: 'integer' },
        createdAt:   { type: 'string', format: 'date-time' }
      }
    }
  }
};
```

### Standard Error Response

All errors conform to:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

Implemented via `fastify.setErrorHandler()` in `plugins/error-handler.ts`.

### Error Codes Catalog

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | JSON Schema validation fails (body, params, querystring) |
| 400 | `INVALID_STATUS_FILTER` | `GET /tasks?status=invalid` |
| 404 | `TASK_NOT_FOUND` | Task ID does not exist |
| 404 | `USER_NOT_FOUND` | User ID does not exist |
| 409 | `EMAIL_ALREADY_EXISTS` | Duplicate email on POST /users |
| 409 | `TASK_ALREADY_ARCHIVED` | Operation on already-archived task |
| 409 | `USER_ALREADY_ASSIGNED` | Duplicate assignment |
| 409 | `USER_NOT_ASSIGNED` | User completes task they're not assigned to |
| 409 | `ALREADY_COMPLETED` | User re-completes same task |
| 409 | `VERSION_CONFLICT` | OCC conflict on archive |
| 409 | `IDEMPOTENCY_CONFLICT` | Concurrent requests with same key |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## 4. Sequence Flows

### 4.1 Core Flow: Complete Task → Archive → Notify (US-04)

```
Client                    Fastify API                   Prisma/RDS              SQS
  |                           |                              |                    |
  |-- POST /tasks/:id/complete ----------------------------->|                    |
  |   { userId }              |                              |                    |
  |                           |                              |                    |
  |                           |-- validate task exists ----->|                    |
  |                           |<-- task + assignments -------|                    |
  |                           |                              |                    |
  |                           |-- validate user assigned --->|                    |
  |                           |-- validate not completed --->|                    |
  |                           |                              |                    |
  |                           |-- BEGIN TRANSACTION -------->|                    |
  |                           |                              |                    |
  |                           |-- UPDATE task_assignment --->|                    |
  |                           |   SET completed=true         |                    |
  |                           |   WHERE userId AND taskId    |                    |
  |                           |                              |                    |
  |                           |-- COUNT incomplete --------->|                    |
  |                           |   WHERE taskId               |                    |
  |                           |<-- remainingCount -----------|                    |
  |                           |                              |                    |
  |                           |  [if remainingCount == 0]    |                    |
  |                           |                              |                    |
  |                           |-- UPDATE tasks ------------->|                    |
  |                           |   SET status='archived',     |                    |
  |                           |       version=version+1      |                    |
  |                           |   WHERE id=X AND version=Y   |                    |
  |                           |                              |                    |
  |                           |  [if rowsAffected == 0]      |                    |
  |                           |   ROLLBACK ----------------->|                    |
  |                           |   409 VERSION_CONFLICT       |                    |
  |                           |                              |                    |
  |                           |  [if rowsAffected == 1]      |                    |
  |                           |                              |                    |
  |                           |-- SQS.sendMessage ---------->-------------------->|
  |                           |   { taskId, title, status }  |                    |
  |                           |                              |                    |
  |                           |  [if SQS error]              |                    |
  |                           |   ROLLBACK ----------------->|                    |
  |                           |   500 INTERNAL_ERROR         |                    |
  |                           |                              |                    |
  |                           |-- COMMIT ------------------->|                    |
  |                           |                              |                    |
  |<-- 200 OK ----------------|                              |                    |
  |   { archived: true }      |                              |                    |
  |                           |                              |                    |
  |                           |  [if remainingCount > 0]     |                    |
  |                           |   COMMIT without archive     |                    |
  |                           |<-- 200 { archived: false } --|                    |
```

### 4.2 Idempotency Flow (US-12)

```
Client                    Fastify API                   Prisma/RDS
  |                           |                              |
  |-- POST /tasks              |                              |
  |   Idempotency-Key: abc     |                              |
  |                           |                              |
  |                           |-- onRequest hook ----------->|
  |                           |   hash = SHA256(abc)         |
  |                           |                              |
  |                           |-- SELECT FROM idempotency_keys
  |                           |   WHERE keyHash=X            |
  |                           |   AND method=POST            |
  |                           |   AND path=/tasks            |
  |                           |   AND expiresAt > now()      |
  |                           |                              |
  |                           |  [FOUND]                     |
  |                           |<-- cached response ----------|
  |<-- 201 + cached body -----|   (skip handler)            |
  |                           |                              |
  |                           |  [NOT FOUND]                 |
  |                           |                              |
  |                           |-- handler executes normally  |
  |                           |                              |
  |                           |-- onSend hook: INSERT INTO   |
  |                           |   idempotency_keys           |
  |                           |   (keyHash, response, TTL)   |
  |                           |                              |
  |                           |  [CONCURRENT collision on    |
  |                           |   unique keyHash]            |
  |                           |   409 IDEMPOTENCY_CONFLICT   |
```

### 4.3 Worker Lambda: SQS → Webhook → NotificationAttempt (US-09)

```
SQS Queue                Worker Lambda                External API         Prisma/RDS
  |                           |                           |                    |
  |-- SQS Event (batch) ----->|                           |                    |
  |                           |                           |                    |
  |                           |-- for each record:        |                    |
  |                           |                           |                    |
  |                           |-- POST NOTIFY_URL ------->|                    |
  |                           |   { taskId, title, ... }  |                    |
  |                           |<-- HTTP response ---------|                    |
  |                           |                           |                    |
  |                           |-- INSERT INTO              |                    |
  |                           |   notification_attempts ---|------------------>|
  |                           |   (status, statusCode,     |                    |
  |                           |    responseBody,           |                    |
  |                           |    attemptNumber)          |                    |
  |                           |                           |                    |
  |                           |  [if 5xx or timeout]       |                    |
  |                           |   throw error              |                    |
  |                           |   → SQS retry              |                    |
  |                           |   → after 3 failures → DLQ |                    |
```

---

## 5. Plugin Architecture

### 5.1 Registration Order (app.ts)

```typescript
export async function buildApp() {
  const app = Fastify({ logger: true });

  // 1. Rate limiting (first, protects all routes)
  await app.register(rateLimitPlugin);

  // 2. Idempotency (hooks all POST routes)
  await app.register(idempotencyPlugin);

  // 3. SQS decorator
  await app.register(sqsPlugin);

  // 4. Error handler (must be after plugins to catch their errors)
  app.setErrorHandler(errorHandler);

  // 5. Routes
  await app.register(userRoutes,     { prefix: '/users' });
  await app.register(taskRoutes,     { prefix: '/tasks' });
  await app.register(adminRoutes,    { prefix: '/admin' });

  return app;
}
```

### 5.2 Rate Limit Plugin

```typescript
import fastifyRateLimit from '@fastify/rate-limit';

export async function rateLimitPlugin(app: FastifyInstance) {
  await app.register(fastifyRateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later'
      }
    })
  });
}
```

### 5.3 Idempotency Plugin

Uses `onRequest` to look up cached responses and `onSend` to store them:

```typescript
// plugins/idempotency.ts
// - Only activates for POST methods
// - onRequest: checks Idempotency-Key header, queries IdempotencyKey table
// - onSend: stores response in IdempotencyKey table with TTL
// - Handles concurrent key collision via DB unique constraint → 409
```

---

## 6. Testing Strategy

### 6.1 Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Database | `pg-mem` | In-memory PostgreSQL for tests |
| ORM | `prisma-mock` (or raw pg-mem adapter) | Mock Prisma client backed by pg-mem |
| HTTP | `supertest` (via `light-my-request` or Fastify's `inject()`) | E2E API tests without binding to a port |
| Runner | `vitest` | Test runner + assertions |
| Factories | Custom helpers in `tests/helpers.ts` | `createTestUser()`, `createTestTask()`, etc. |

### 6.2 Test Setup (`tests/setup.ts`)

> **Prisma ORM v7 (driver adapter):** Prisma Client v7 requires a driver adapter when connecting (no `url` in the datasource). In tests, we instantiate `PrismaClient` with `@prisma/adapter-pg` pointed at a `pg-mem` pool (via `db.adapters.createPg()`), so no real PostgreSQL/Docker is needed. See `packages/api/src/config/database.ts` (T-04).

```typescript
import { newDb } from 'pg-mem';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { beforeEach, afterEach } from 'vitest';

// 1. Create pg-mem instance + pg-compatible adapter
const db = newDb();
const { Pool } = db.adapters.createPg();
const adapter = new PrismaPg(new Pool());

// 2. Instantiate PrismaClient with the adapter
const prisma = new PrismaClient({ adapter });

// 3. Push the schema into pg-mem
await prisma.$executeRawUnsafe(/* schema DDL */);

// 4. Reset DB between tests
```

### 6.3 Test Organization (per User Story)

| Test File | US | Scenarios |
|-----------|----|-----------|
| `users.test.ts` | US-01,06,07 | Create user (valid, missing fields, duplicate email), List users, List user tasks |
| `tasks.test.ts` | US-02,05,08 | Create task (valid, empty title), Create task with description, List tasks (no filter, open, archived, invalid), Get task detail |
| `assignments.test.ts` | US-03 | Assign users (valid, task not found, user not found, archived task, duplicate assignment) |
| `completions.test.ts` | US-04 | Complete (valid, not last → task stays open), Complete (last → archive + SQS), Complete (already archived, user not assigned, already completed), OCC conflict |
| `notifications.test.ts` | US-09 | List notification attempts (empty, with data) |
| `admin.test.ts` | US-11 | DLQ endpoint (empty, with messages) |
| `idempotency.test.ts` | US-12 | Repeated key returns cached, concurrent keys conflict, expired keys, POST without key works |
| `rate-limit.test.ts` | US-10 | Under limit succeeds, over limit gets 429 |

### 6.4 SQS Mocking in Tests

For `completions.test.ts`, SQS calls are mocked:

```typescript
// Mock SQS at the service level or via fastify.decorate override in test
app.decorate('sqs', {
  sendMessage: vi.fn().mockResolvedValue({ MessageId: 'mock-msg-id' })
});
```

---

## 7. Error Handling Strategy

### 7.1 Application Errors

Services throw typed errors extending a base `AppError`:

```typescript
// services/errors.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) { super(message); }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}
```

### 7.2 Error Handler Plugin

```typescript
// plugins/error-handler.ts
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message }
    });
  }

  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message
      }
    });
  }

  // Unexpected errors
  request.log.error(error);
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
});
```

---

## 8. Infrastructure Design (AWS CDK)

### 8.1 Stack Composition

```
QueueStack
  ├── Main SQS Queue (notification-queue)
  │   ├── maxReceiveCount: 3
  │   ├── visibilityTimeout: 30s
  │   └── deadLetterQueue → DLQ
  ├── DLQ SQS Queue (notification-dlq)
  │   └── retentionPeriod: 14 days
  └── Worker Lambda
      ├── runtime: NodeJS 24.x
      ├── handler: index.handler
      ├── eventSource: Main SQS Queue
      ├── environment:
      │   ├── NOTIFY_URL (from SSM or env)
      │   └── DATABASE_URL (from RDS stack)
      └── vpc: (same VPC as RDS for DB access)

ApiStack
  ├── API Lambda
  │   ├── runtime: NodeJS 24.x
  │   ├── handler: lambda.handler
  │   ├── environment:
  │   │   ├── DATABASE_URL
  │   │   ├── NOTIFICATION_QUEUE_URL
  │   │   ├── DLQ_URL
  │   │   ├── RATE_LIMIT_MAX
  │   │   └── RATE_LIMIT_WINDOW_MS
  │   └── vpc: (same VPC as RDS)
  └── API Gateway (HTTP API)
      └── routes: $default → Lambda proxy

DatabaseStack
  ├── RDS PostgreSQL (db.t4g.micro)
  │   ├── engine: 16.x
  │   ├── publiclyAccessible: false
  │   └── credentials: Secrets Manager
  └── Security Groups (Lambda → RDS ingress)

NetworkStack
  ├── VPC
  ├── Subnets (private + public)
  └── NAT Gateway (for Lambda → SQS/Internet)
```

### 8.2 Lambda Configurations

| Lambda | Memory | Timeout | Concurrency | Notes |
|--------|--------|---------|-------------|-------|
| API | 512 MB | 29s (API Gateway limit) | 100 reserved | Cold start <500ms with bundling |
| Worker | 256 MB | 30s | 5 reserved | Batch size: 10, batch window: 10s |

---

## 9. Environment Variables

| Variable | Required | Default | Used By |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | — | API + Worker |
| `NOTIFICATION_QUEUE_URL` | Yes | — | API (SQS sendMessage) |
| `DLQ_URL` | Yes | — | API (DLQ polling) |
| `NOTIFY_URL` | Yes | — | Worker (webhook target) |
| `IDEMPOTENCY_TTL_SECONDS` | No | `86400` (24h) | API (idempotency plugin) |
| `RATE_LIMIT_MAX` | No | `100` | API (rate limiter) |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` (1min) | API (rate limiter) |
| `NODE_ENV` | No | `development` | API (logging level, testing) |

---

## 10. Documentation & Version Control

### 10.1 Git Strategy

- **Branch:** `main` (single branch, direct commits after task approval per SDD workflow)
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `ci:`, `refactor:`)
- **Hooks:** husky + commitlint enforces format on `commit-msg`
- **Per-task commits:** One commit per approved task per `00-workflow.md`

### 10.2 Code Documentation

- Fastify schemas serve as API documentation (self-documenting via JSON Schema)
- Services documented with JSDoc for critical business logic (OCC archive flow, idempotency)
- README.md updated after each completed phase with setup instructions

### 10.3 Package Scripts

```json
{
  "scripts": {
    "dev": "tsx watch packages/api/src/index.ts",
    "build": "tsc -p packages/api/tsconfig.json && tsc -p packages/worker/tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate --schema=packages/api/prisma/schema.prisma",
    "db:migrate": "prisma migrate dev --schema=packages/api/prisma/schema.prisma",
    "lint": "eslint packages/",
    "prepare": "husky"
  }
}
```

---

## 11. Dependency Graph (Build Order)

```
1. Prisma schema + migrations       (foundation)
2. Config (env.ts)                  (no deps)
3. Service layer                    (depends on Prisma client)
4. Error types (AppError, etc.)     (no deps)
5. Schemas (Fastify JSON Schema)    (no deps)
6. Plugins (error-handler, SQS,     (depends on services + errors)
   idempotency, rate-limit)
7. Routes                           (depends on schemas + services)
8. App factory (app.ts)             (depends on plugins + routes)
9. Lambda wrapper (lambda.ts)       (depends on app factory)
10. Worker Lambda                   (depends on Prisma client)
11. Tests                           (depends on everything above)
12. CDK Infra                       (depends on build output)
```