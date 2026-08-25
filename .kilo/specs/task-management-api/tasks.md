# Phase 3: Implementation Tasks - Task Management API

## Task Execution Rules

1. Tasks are sequential and atomic. Each task must be fully completed and approved before moving to the next.
2. Each task includes: **code to write**, **tests to pass**, and **expected commit message**.
3. After completing a task, tests MUST pass (`npm run test`) before requesting approval.
4. The commit is made ONLY after user approval per `00-workflow.md`.

---

## T-01: Project Scaffolding & Tooling ✅ COMPLETED

**Objective:** Initialize the monorepo with npm workspaces, TypeScript, husky, commitlint, vitest, and directory structure.

**Files to create/modify:**

```
package.json              (root: npm workspaces config, scripts)
tsconfig.base.json        (shared TS compiler options)
commitlint.config.js      (conventional commits config)
.husky/commit-msg         (commitlint hook)
.husky/pre-commit         (lint-staged hook)
packages/api/package.json  (api package manifest + deps)
packages/api/tsconfig.json (extends tsconfig.base.json)
packages/worker/package.json
packages/worker/tsconfig.json
infra/package.json
infra/tsconfig.json
infra/cdk.json
.gitignore
```

**Dependencies to install (root):**
- `typescript`, `tsx`, `vitest`, `husky`, `@commitlint/cli`, `@commitlint/config-conventional`, `lint-staged`

**Dependencies (packages/api):**
- `fastify`, `@fastify/rate-limit`, `@aws-sdk/client-sqs`, `@prisma/client`, `prisma`, `uuid`
- Dev: `@types/node`, `pg-mem`, `vitest`

**Dependencies (packages/worker):**
- `@prisma/client`, `@aws-sdk/client-sqs`
- Dev: `@types/node`, `vitest`, `pg-mem`

**Dependencies (infra):**
- `aws-cdk-lib`, `aws-cdk`, `constructs`, `@aws-cdk/aws-lambda-nodejs`, `esbuild`
- Dev: `@types/node`, `typescript`

**Acceptance Criteria:**
- [x] `npm install` succeeds at root and all workspaces
- [x] `npm run test` runs vitest (no tests yet, exits clean)
- [x] `npm run lint` runs eslint (no files yet)
- [x] husky hooks are installed (`.husky/` directory present)
- [x] Directory structure matches design §1

**Commit message:** `chore: scaffold monorepo with npm workspaces, TypeScript, husky, and vitest`

---

## T-02: Prisma Schema & Database Migrations ✅ COMPLETED

**Objective:** Define the complete Prisma schema per design §2 and generate the Prisma client.

**Files to create/modify:**

```
packages/api/prisma/schema.prisma
prisma.config.ts             (Prisma ORM v7: datasource URL for Migrate — no url in schema)
.env / .env.example          (DATABASE_URL and other env vars)
```

**Models to define:** `User`, `Task`, `TaskAssignment`, `IdempotencyKey`, `NotificationAttempt`

> **Prisma ORM v7:** The schema datasource no longer carries `url`. Connection URLs for Migrate live in `prisma.config.ts`; the `PrismaClient` receives a driver adapter (`@prisma/adapter-pg`) in the constructor (wired in T-04).

**Acceptance Criteria:**
- [x] `npx prisma generate --schema=packages/api/prisma/schema.prisma` succeeds
- [x] Schema matches design §2 exactly (all models, fields, relations, indexes, mappings)
- [x] `@@unique([userId, taskId])` on TaskAssignment
- [x] `@unique` on IdempotencyKey.keyHash
- [x] `@@index([keyHash, method, path])` and `@@index([expiresAt])` on IdempotencyKey
- [x] All `@map()` and `@@map()` annotations present
- [x] `prisma generate` / `prisma validate` succeed via `prisma.config.ts` (Prisma ORM v7, driver adapter approach)

**Commit message:** `feat(db): add Prisma schema with User, Task, TaskAssignment, IdempotencyKey, and NotificationAttempt models`

---

## T-03: Environment Configuration & Error Types ✅ COMPLETED

**Objective:** Create the configuration parser and the error class hierarchy used by all services.

**Files to create:**

```
packages/api/src/config/env.ts
packages/api/src/services/errors.ts
```

**`env.ts` spec:**
- Parse and validate environment variables listed in design §9
- Export typed config object
- Use `dotenv` for local development

**`errors.ts` spec:**
- `AppError` base class with `statusCode`, `code`, `message`
- `NotFoundError` extends AppError (404)
- `ConflictError` extends AppError (409)
- `BadRequestError` extends AppError (400)

**Acceptance Criteria:**
- [x] `env.ts` parses all 8 variables with defaults where applicable
- [x] `env.ts` throws on missing required vars (`DATABASE_URL`, `NOTIFICATION_QUEUE_URL`)
- [x] All error classes are exported and constructable
- [x] Unit tests in `packages/api/tests/` verify error instantiation and property access

**Commit message:** `feat(api): add environment config parser and AppError hierarchy`

---

## T-04: Prisma Client Singleton & Test Setup ✅ COMPLETED

**Objective:** Create the Prisma client singleton and the pg-mem test setup infrastructure.

**Files to create:**

```
packages/api/src/config/database.ts
packages/api/tests/setup.ts
packages/api/tests/helpers.ts
vitest.config.ts              (root or api-level)
```

**`database.ts` spec:**
- Export singleton `prisma` instance (lazy-initialized or module-level)
- Export `PrismaClient` type for DI/testing

**`setup.ts` spec:**
- Initialize pg-mem with Prisma schema
- Provide `beforeEach` to reset DB state
- Provide `afterAll` to clean up

**`helpers.ts` spec:**
- `createTestUser(prisma, overrides?)` → User
- `createTestTask(prisma, overrides?)` → Task
- `createTestAssignment(prisma, userId, taskId, overrides?)` → TaskAssignment
- `buildTestApp()` → Fastify instance with routes registered (for E2E tests)

**`vitest.config.ts` spec:**
- Configure `setupFiles` pointing to `tests/setup.ts`
- Configure test globals

**Acceptance Criteria:**
- [x] `database.ts` exports a working Prisma client
- [x] `setup.ts` creates pg-mem instance, applies schema, resets between tests
- [x] `helpers.ts` factories create valid records in pg-mem
- [x] A smoke test using pg-mem + Prisma client passes (create user, read user)
- [x] `buildTestApp()` returns Fastify instance that responds to requests

**Commit message:** `test(api): add Prisma client singleton, pg-mem setup, and test helpers`

> **Note (T-04 implemented):** The approved pg-mem + `@prisma/adapter-pg` setup does not work with Prisma ORM v7.9 (the adapter's `instanceof pg.Pool` check treats pg-mem's fake pool as a real pool → TCP connect; and its OID-based column mapping requires `field.dataTypeID`, which pg-mem does not provide). In its place, T-04 added a custom Prisma v7 driver adapter (`packages/api/tests/pg-mem-driver.ts`) that runs the exact Prisma-generated SQL against pg-mem and maps column types from `field.typeId`. This applies to all remaining tasks. Two pg-mem quirks handled: reset tables individually (no multi-table TRUNCATE) and inline bound args as SQL literals (pg-mem cannot convert JS booleans/Dates in `bind()`).

---

## T-05: User Service & Routes (US-01, US-06, US-07) ✅ COMPLETED

**Objective:** Implement user CRUD, list users with pending tasks, and list specific user's tasks.

**Run tests:** `npm run test` → 30 passing (incl. 11 in `users.test.ts`). `tsc --noEmit` and `eslint` clean.

**Files to create/modify:**

```
packages/api/src/services/user.service.ts
packages/api/src/schemas/user.schema.ts
packages/api/src/routes/users.ts
packages/api/tests/users.test.ts
```

**Service methods:**
- `createUser(data: { name, lastName, email })` → User (throws `EMAIL_ALREADY_EXISTS` on dup)
- `getAllUsers()` → User[] (with pending tasks — joined TaskAssignment where completed=false AND task.status='open')
- `getUserById(id)` → User | null
- `getUserTasks(userId)` → Task[] (with completed status per task)

**Routes (`routes/users.ts`):**
- `POST /users` → 201 | 400 | 409
- `GET /users` → 200
- `GET /users/:idUser/tasks` → 200 | 404

**Schemas (`schemas/user.schema.ts`):**
- `createUserSchema` — validates name, lastName, email required, email format
- Response schemas for 201, 200

**Tests (`tests/users.test.ts`):**
- [x] POST /users → 201 with valid data (includes UUID id)
- [x] POST /users → 400 when name missing
- [x] POST /users → 400 when lastName missing
- [x] POST /users → 400 when email missing
- [x] POST /users → 400 when email format invalid
- [x] POST /users → 409 when email already exists
- [x] GET /users → 200 with list of users (includes pending tasks)
- [x] GET /users → 200 empty array when no users
- [x] GET /users/:idUser/tasks → 200 with user's tasks and completion status
- [x] GET /users/:idUser/tasks → 404 when user not found

**Commit message:** `feat(api): add user service, schemas, and routes for CRUD + task listing`

---

## T-06: Task Service & Routes (US-02, US-05, US-08) ✅ COMPLETED

**Objective:** Implement task CRUD, list with status filter, and detail endpoint.

**Run tests:** `npm run test` → 41 passing (incl. 11 in `tasks.test.ts`). `tsc --noEmit` and `eslint` clean.

**Files to create/modify:**

```
packages/api/src/services/task.service.ts
packages/api/src/schemas/task.schema.ts
packages/api/src/routes/tasks.ts
packages/api/tests/tasks.test.ts
```

**Service methods:**
- `createTask(data: { title, description? })` → Task (status='open', version=0)
- `getAllTasks(statusFilter?: 'open' | 'archived')` → Task[] (with assignments)
- `getTaskById(id)` → Task | null (with assignments + user data)

**Routes (`routes/tasks.ts`):**
- `POST /tasks` → 201 | 400
- `GET /tasks` → 200 (supports `?status=open|archived`)
- `GET /tasks/:idTask` → 200 | 404

**Schemas (`schemas/task.schema.ts`):**
- `createTaskSchema` — title required (minLength 1), description optional
- Response schemas

**Tests (`tests/tasks.test.ts`):**
- [x] POST /tasks → 201 with title (and optional description)
- [x] POST /tasks → 400 when title empty or missing
- [x] GET /tasks → 200 returns all tasks with assignments
- [x] GET /tasks?status=open → 200 returns only open tasks
- [x] GET /tasks?status=archived → 200 returns only archived tasks
- [x] GET /tasks?status=invalid → 400 INVALID_STATUS_FILTER
- [x] GET /tasks/:idTask → 200 with task + assignments + user data
- [x] GET /tasks/:idTask → 404 when not found

**Commit message:** `feat(api): add task service, schemas, and routes for CRUD + status filtering`

---

## T-07: Assignment Service & Route (US-03) ✅ COMPLETED

**Objective:** Implement task-user assignment with validation (task exists, user exists, task not archived, no duplicates).

**Run tests:** `npm run test` → 48 passing (incl. 7 in `assignments.test.ts`). `tsc --noEmit` and `eslint` clean.

**Files to create/modify:**

```
packages/api/src/services/assign.service.ts
packages/api/src/routes/assignments.ts
packages/api/tests/assignments.test.ts
```

**Service methods:**
- `assignUsersToTask(taskId, userIds: string[])` → TaskAssignment[]
  - Validate task exists → `TASK_NOT_FOUND`
  - Validate task is open → `TASK_ALREADY_ARCHIVED`
  - Validate all users exist → `USER_NOT_FOUND` (with detail which user)
  - Check no duplicate assignment → `USER_ALREADY_ASSIGNED`
  - Batch create TaskAssignment records

**Routes (`routes/assignments.ts`):**
- `POST /tasks/:idTask/assign` → 200 | 400 | 404 | 409

**Tests (`tests/assignments.test.ts`):**
- [x] Assign users to task → 200 with updated assignments
- [x] Assign → 404 when task not found
- [x] Assign → 404 when any userId not found
- [x] Assign → 409 when task already archived
- [x] Assign → 409 when user already assigned (duplicate)
- [x] Assign → 400 when userIds is empty array

**Commit message:** `feat(api): add task assignment service and route with full validation`

---

## T-08: Completion Service & Route (US-04) — Core Business Logic ✅ COMPLETED

**Objective:** Implement the most critical flow: mark task as completed by user, OCC-based archive, and SQS notification enqueue.

**Run tests:** `npm run test` → 60 passing (incl. 12 in `completions.test.ts`). `tsc --noEmit` and `eslint` clean.

**Files to create/modify:**

```
packages/api/src/services/complete.service.ts
packages/api/src/routes/completions.ts
packages/api/tests/completions.test.ts
```

**Service methods:**
- `completeTask(taskId, userId)` → `{ archived: boolean }`
  - Validate task exists → `TASK_NOT_FOUND`
  - Validate task is open → `TASK_ALREADY_ARCHIVED`
  - Validate user exists → `USER_NOT_FOUND`
  - Validate user is assigned → `USER_NOT_ASSIGNED`
  - Validate not already completed → `ALREADY_COMPLETED`
  - In transaction:
    1. Update TaskAssignment: SET completed=true
    2. COUNT incomplete assignments WHERE taskId
    3. If count == 0:
       - UPDATE tasks SET status='archived', version=version+1 WHERE id=X AND version=Y
       - If rowsAffected == 0 → throw `VERSION_CONFLICT`
       - SQS.sendMessage({ taskId, title, status: 'archived', timestamp })
       - If SQS fails → throw, triggering rollback
    4. Return `{ archived: count == 0 }`

**Routes (`routes/completions.ts`):**
- `POST /tasks/:idTask/complete` → 200 | 404 | 409 | 500

**Tests (`tests/completions.test.ts`):**
- [x] Complete → 200 { archived: false } when not last user
- [x] Complete → 200 { archived: true } when last user completes
- [x] Complete (last) → task status is 'archived' in DB
- [x] Complete (last) → SQS.sendMessage is called with correct payload
- [x] Complete → 404 when task not found
- [x] Complete → 404 when user not found
- [x] Complete → 409 when task already archived
- [x] Complete → 409 when user not assigned to task
- [x] Complete → 409 when user already completed
- [x] Complete → 409 VERSION_CONFLICT (simulate OCC race condition)

**Commit message:** `feat(api): add task completion with OCC archive and SQS notification enqueue`

---

## T-09: SQS Plugin & Decorator ✅ COMPLETED

**Objective:** Create the Fastify SQS plugin that decorates the app with an SQS client for dependency injection in services.

**Run tests:** `npm run test` → 65 passing (incl. 5 in `sqs.test.ts`). `tsc --noEmit` and `eslint` clean. Added `fastify-plugin` as a direct dependency of `packages/api`.

**Files to create:**

```
packages/api/src/plugins/sqs.ts
```

**Spec:**
- Register as Fastify plugin
- Initialize `@aws-sdk/client-sqs` SQSClient
- Decorate `fastify.sqs.sendMessage(params)` → Promise<SQS.SendMessageResult>
- Decorate `fastify.sqs.receiveMessage(params)` → Promise<SQS.ReceiveMessageResult>
- In development/test, support a mock client (conditionally based on NODE_ENV or a flag)
- Read `NOTIFICATION_QUEUE_URL` and `DLQ_URL` from config

**Acceptance Criteria:**
- [x] Plugin registers successfully on Fastify instance
- [x] `fastify.sqs.sendMessage()` is callable
- [x] In test mode, SQS calls can be replaced with mocks (already used in T-08 tests)
- [x] Unit tests verify plugin registration and decoration

**Commit message:** `feat(api): add SQS Fastify plugin with client decorator`

---

## T-10: Notification History Route (US-09) ✅ COMPLETED

**Objective:** Expose notification attempt history per task.

**Run tests:** `npm run test` → 68 passing (incl. 3 in `notifications.test.ts`). `tsc --noEmit` and `eslint` clean.

**Files to create/modify:**

```
packages/api/src/services/notification.service.ts
packages/api/src/routes/notifications.ts
packages/api/tests/notifications.test.ts
```

**Service methods:**
- `getNotificationAttempts(taskId)` → NotificationAttempt[]

**Routes (`routes/notifications.ts`):**
- `GET /tasks/:idTask/notifications` → 200 | 404

**Tests (`tests/notifications.test.ts`):**
- [x] GET notifications → 200 with list of attempts
- [x] GET notifications → 200 empty array when no attempts
- [x] GET notifications → 404 when task not found
- [x] Each attempt includes: id, taskId, status, statusCode, responseBody, attemptNumber, createdAt

**Commit message:** `feat(api): add notification history endpoint per task`

---

## T-11: Error Handler Plugin ✅ COMPLETED

**Objective:** Centralize error formatting across all routes with the standard `{ error: { code, message } }` structure.

**Run tests:** `npm run test` → 73 passing (incl. 5 in `error-handler.test.ts`). `tsc --noEmit` and `eslint` clean. Refactored `buildTestApp` in `tests/helpers.ts` to use the centralized plugin.

**Files to create/modify:**

```
packages/api/src/plugins/error-handler.ts
packages/api/src/schemas/error.schema.ts
```

**Spec:**
- Handle `AppError` instances → map to correct status + code
- Handle Fastify validation errors → 400 VALIDATION_ERROR
- Handle unexpected errors → 500 INTERNAL_ERROR
- Log unexpected errors via `request.log.error()`

**Acceptance Criteria:**
- [x] All existing routes produce standardized error format
- [x] Validation errors show `{ error: { code: "VALIDATION_ERROR", message: "..." } }`
- [x] AppErrors show correct statusCode and code
- [x] Unhandled errors → 500 INTERNAL_ERROR

**Commit message:** `feat(api): add centralized error handler plugin with standard error format`

---

## T-12: Idempotency Plugin & Service (US-12)

**Objective:** Implement global idempotency for all POST endpoints via Fastify hooks.

**Run tests:** `npm run test` → 80 passing (incl. 7 in `idempotency.test.ts`). `tsc --noEmit` and `eslint` clean. Added required env vars to the global test `setup.ts` so plugins parse successfully in all tests.

> **Added (T-12 amendment):** `cleanupExpiredKeys` is now exposed via an admin route — `POST /admin/idempotency/cleanup → 200 { deleted }` in `routes/admin.ts` — so expired idempotency rows can be purged on demand instead of leaving bulk cleanup unwired. T-15 will extend `routes/admin.ts` with the DLQ endpoint.

**Files to create/modify:**

```
packages/api/src/services/idempotency.service.ts
packages/api/src/plugins/idempotency.ts
packages/api/tests/idempotency.test.ts
```

**Service methods:**
- `findCachedResponse(keyHash, method, path)` → cached response | null
- `storeResponse(id, keyHash, method, path, statusCode, body, ttlSeconds)`
- `generateKeyHash(idempotencyKey)` → SHA-256 string
- `cleanupExpiredKeys()` — optional

**Plugin (`plugins/idempotency.ts`):**
- Only activates for POST methods
- `onRequest` hook:
  - If `Idempotency-Key` header present → compute hash → query cache
  - If found and not expired → reply with cached status + body, skip handler
- `onSend` hook:
  - After handler executes → INSERT into IdempotencyKey
  - If DB unique constraint violation → 409 IDEMPOTENCY_CONFLICT (concurrent request)
- Uses UUIDv7 for the `id` field

**Tests (`tests/idempotency.test.ts`):**
- [x] POST with Idempotency-Key → 201, second identical request → same cached response
- [x] POST with different Idempotency-Key → processes normally (new record)
- [x] POST without Idempotency-Key → processes normally
- [x] Concurrent requests with same key → one succeeds, second gets 409 IDEMPOTENCY_CONFLICT
- [x] Expired idempotency key → new request creates new record
- [x] Different methods/paths with same key → processed independently
- [x] POST /admin/idempotency/cleanup purges expired keys and reports the count

**Commit message:** `feat(api): add global idempotency plugin via Idempotency-Key header`

---

## T-13: Rate Limiting Plugin (US-10) ✅ COMPLETED

**Objective:** Protect the API with configurable rate limiting.

**Run tests:** `npm run test` → 84 passing (incl. 4 in `rate-limit.test.ts`). `tsc --noEmit` and `eslint` clean. `buildTestApp` is now `async` (awaits plugin registration — required by `@fastify/rate-limit` v10).

**Files to create/modify:**

```
packages/api/src/plugins/rate-limit.ts
packages/api/tests/rate-limit.test.ts
```

**Spec:**
- Uses `@fastify/rate-limit`
- Configurable via `RATE_LIMIT_MAX` (default 100) and `RATE_LIMIT_WINDOW_MS` (default 60000)
- Custom error response builder → `{ error: { code: "RATE_LIMIT_EXCEEDED", message: "..." } }`

**Tests (`tests/rate-limit.test.ts`):**
- [x] Requests under limit succeed
- [x] Requests over limit return 429 with Retry-After header
- [x] Error format matches standard `{ error: { code, message } }` structure
- [x] Limits are per IP (different IPs are unaffected)

**Commit message:** `feat(api): add rate limiting plugin with configurable limits`

---

## T-14: App Factory & Lambda Wrapper ✅ COMPLETED

**Objective:** Wire all plugins and routes together into the Fastify app factory and create the AWS Lambda handler.

**Run tests:** `npm run test` → 87 passing (incl. 3 in `app.test.ts`). `tsc --noEmit` (api) and `eslint` clean. Fixed a latent `eslint.config.mjs` gap (nested `**/dist/**` ignore) surfaced by a stale build artifact. Verified `npm run dev` boots and serves `/health`; `buildTestApp` now delegates to the real `buildApp` factory.

**Files to create:**

```
packages/api/src/app.ts
packages/api/src/lambda.ts
packages/api/src/index.ts
packages/api/tests/app.test.ts        (added: buildApp smoke + full flow)
eslint.config.mjs                     (fix: ignore nested dist/)
```

**`app.ts` spec:**
- Create Fastify instance
- Register plugins in order: rate-limit → idempotency → SQS → error-handler
- Register route modules: users, tasks, assign, complete, notifications, admin
- Export `buildApp(options?)` function (injectable rate-limit/SQS for tests)

**`lambda.ts` spec:**
- Import `buildApp()`
- Use `@fastify/aws-lambda` or manual `aws-lambda-fastify` wrapper
- Export `handler` function

**`index.ts` spec:**
- Local development entry point
- Call `buildApp()`, listen on PORT (env or 3000)

**Acceptance Criteria:**
- [x] `buildApp()` returns a fully configured Fastify instance
- [x] All 10 routes are registered and reachable
- [x] Plugin order is correct
- [x] `npm run dev` starts the server locally
- [x] Integration smoke test: create user → create task → assign → complete (full flow)

**Commit message:** `feat(api): wire app factory, lambda handler, and local dev server`

---

## T-15: Admin DLQ Endpoint (US-11)

**Objective:** Implement the DLQ inspection endpoint using AWS SDK to poll the SQS DLQ.

**Files to create/modify:**

```
packages/api/src/services/dlq.service.ts
packages/api/src/routes/admin.ts
packages/api/tests/admin.test.ts
```

**Service methods:**
- `getDLQMessages(maxMessages?: number)` → DLQMessage[]
  - Uses `fastify.sqs.receiveMessage()` against DLQ_URL
  - Maps to response format: `{ messageId, body, attributes, sentTimestamp }`

**Routes (`routes/admin.ts`):**
- `GET /admin/dlq` → 200 (no auth per updated requirements)

**Tests (`tests/admin.test.ts`):**
- [ ] GET /admin/dlq → 200 with empty array when DLQ is empty
- [ ] GET /admin/dlq → 200 with messages when DLQ has messages (mocked SQS response)
- [ ] Messages include: messageId, body, attributes, sentTimestamp

**Commit message:** `feat(api): add admin DLQ inspection endpoint`

---

## T-16: Worker Lambda — SQS Consumer

**Objective:** Implement the standalone Lambda that consumes SQS notifications, POSTs to the external webhook, and logs NotificationAttempt records.

**Files to create/modify:**

```
packages/worker/src/config/env.ts
packages/worker/src/index.ts
packages/worker/src/webhook.ts
packages/worker/src/notification-log.ts
packages/worker/tests/worker.test.ts
```

**`index.ts` spec:**
- SQS event handler
- For each record: parse body → POST to NOTIFY_URL → log attempt to DB
- On HTTP failure (5xx/timeout): throw error → SQS retries automatically
- After 3 retries: SQS moves to DLQ

**`webhook.ts` spec:**
- `postWebhook(url, payload)` → `{ statusCode, body }`
- Timeout: 10s
- On 2xx → success, on 4xx → failed (no retry needed), on 5xx/timeout → throw

**`notification-log.ts` spec:**
- `logAttempt(prisma, data: { taskId, status, statusCode?, responseBody?, attemptNumber })` → NotificationAttempt

**Tests (`tests/worker.test.ts`):**
- [ ] Webhook POST returns 200 → NotificationAttempt with status "success"
- [ ] Webhook returns 500 → throws error (SQS will retry)
- [ ] NotificationAttempt is created with correct attemptNumber from SQS attributes
- [ ] Multiple records in batch are processed independently

**Commit message:** `feat(worker): add SQS consumer Lambda with webhook delivery and notification logging`

---

## T-17: CDK Infrastructure

**Objective:** Define the AWS CDK stacks for the full infrastructure.

**Files to create/modify:**

```
infra/bin/app.ts
infra/lib/network-stack.ts
infra/lib/database-stack.ts
infra/lib/queue-stack.ts
infra/lib/api-stack.ts
```

**`network-stack.ts` spec:**
- VPC with private + public subnets
- NAT Gateway in public subnet
- Internet Gateway

**`database-stack.ts` spec:**
- RDS PostgreSQL instance (db.t4g.micro, engine 16.x)
- Security group allowing Lambda VPC ingress on port 5432
- Credentials stored in Secrets Manager
- Output: DATABASE_URL secret ARN

**`queue-stack.ts` spec:**
- Main SQS queue with `maxReceiveCount: 3`, `visibilityTimeout: 30s`
- DLQ with `retentionPeriod: 14 days`
- Worker Lambda (NodeJS 24.x) with SQS event source
- Worker Lambda environment: NOTIFY_URL, DATABASE_URL
- Worker Lambda VPC config

**`api-stack.ts` spec:**
- API Lambda (NodeJS 24.x, 512MB, 29s timeout)
- HTTP API Gateway ($default route → Lambda)
- Lambda environment variables
- Lambda VPC config

**`bin/app.ts` spec:**
- Instantiate stacks in order: Network → Database → Queue → API

**Acceptance Criteria:**
- [ ] `cdk synth` succeeds without errors
- [ ] Generated CloudFormation templates include all resources
- [ ] Lambda functions reference correct handler paths
- [ ] Environment variables are properly wired

**Commit message:** `feat(infra): add CDK stacks for VPC, RDS, SQS/DLQ, API Lambda, and Worker Lambda`

---

## T-18: Integration & E2E Tests

**Objective:** Full end-to-end tests covering the complete workflow and regression suite.

**Files to create/modify:**

```
packages/api/tests/e2e/
  full-workflow.test.ts
  concurrent-archive.test.ts
```

**`full-workflow.test.ts`:**
- [ ] Full happy path: create 2 users → create task → assign both → user1 completes (not archived) → user2 completes (archived) → verify archived status → verify notifications endpoint
- [ ] Edge cases: archived task rejection, duplicate assignment, duplicate completion

**`concurrent-archive.test.ts`:**
- [ ] OCC conflict simulation: two requests try to complete the last assignment simultaneously

**Acceptance Criteria:**
- [ ] Full workflow test passes
- [ ] Concurrent archive test verifies VERSION_CONFLICT
- [ ] All 8 test files pass: `npm run test`

**Commit message:** `test(api): add end-to-end workflow and concurrency tests`

---

## Task Summary & Dependencies

```
T-01 ──► T-02 ──► T-03 ──► T-04 ──► T-05 ──► T-06 ──► T-07 ──► T-08
                                         │                              │
                                         │                              ▼
                                         │                            T-09 ──► T-10
                                         │                              │
                                         │                              ▼
                                         │                            T-11 ──► T-12 ──► T-13
                                         │                                         │
                                         ▼                                         ▼
                                       T-14 ◄─────────────────────────────────────┘
                                         │
                                         ├──► T-15
                                         │
                                         └──► T-16 ──► T-17
                                                       │
                                                       ▼
                                                     T-18
```

| Task | US Coverage | Est. Files | Key Dependency |
|------|-------------|------------|----------------|
| T-01 | — | 13 | None |
| T-02 | — | 1 | T-01 |
| T-03 | — | 2 | T-01 |
| T-04 | — | 4 | T-02, T-03 |
| T-05 | US-01,06,07 | 4 | T-04 |
| T-06 | US-02,05,08 | 4 | T-04 |
| T-07 | US-03 | 3 | T-05, T-06 |
| T-08 | US-04 | 3 | T-07 |
| T-09 | — | 1 | T-08 |
| T-10 | US-09 | 3 | T-09 |
| T-11 | — | 2 | T-08 |
| T-12 | US-12 | 3 | T-11 |
| T-13 | US-10 | 2 | T-12 |
| T-14 | — | 3 | T-13 |
| T-15 | US-11 | 3 | T-14 |
| T-16 | US-09 (worker) | 5 | T-02 |
| T-17 | Infra | 5 | T-14, T-16 |
| T-18 | All | 2 | T-17 |