# Phase 1: Requirements - Task Management API

## Resumen del Proyecto

API REST serverless para gestión de tareas colaborativas con archivado automático por concurrencia optimista, notificaciones webhook transaccionales vía SQS, idempotencia global, rate limiting y trazabilidad de DLQ.

---

## User Stories & Acceptance Criteria

### US-01: Registro de Usuario

**Como** consumidor de la API,
**quiero** poder registrar un nuevo usuario con nombre, apellido y email,
**para** que pueda ser asignado a tareas posteriormente.

**Criterios de Aceptación:**
- [ ] `POST /users` acepta body JSON con `name`, `lastName`, `email` (todos requeridos).
- [ ] Retorna `201 Created` con el usuario creado (incluyendo `id` UUIDv7).
- [ ] Si falta algún campo requerido, retorna `400 Bad Request` con estructura de error estándar `{ error: { code, message } }`.
- [ ] Si el `email` ya existe, retorna `409 Conflict` con código `EMAIL_ALREADY_EXISTS`.
- [ ] El endpoint es idempotente vía header `Idempotency-Key`.

### US-02: Registro de Tarea

**Como** consumidor de la API,
**quiero** crear una nueva tarea con un título,
**para** que pueda ser asignada a usuarios y tracked su progreso.

**Criterios de Aceptación:**
- [ ] `POST /tasks` acepta body JSON con `title` (requerido, string no vacío) y `description` (opcional, string no vacío).
- [ ] Retorna `201 Created` con la tarea creada (`id`, `title`, `status: "open"`, `version: 0`).
- [ ] Si `title` está vacío o ausente, retorna `400 Bad Request`.
- [ ] Endpoint idempotente vía `Idempotency-Key`.

### US-03: Asignación de Usuarios a Tarea

**Como** consumidor de la API,
**quiero** asignar uno o varios usuarios a una tarea existente,
**para** que dichos usuarios puedan marcarla como completada.

**Criterios de Aceptación:**
- [ ] `POST /tasks/:idTask/assign` acepta body con `userIds` (array de UUIDs, mínimo 1).
- [ ] Retorna `200 OK` con la tarea y sus asignaciones actualizadas.
- [ ] Si `idTask` no existe, retorna `404 Not Found` con código `TASK_NOT_FOUND`.
- [ ] Si algún `userId` no existe, retorna `404 Not Found` con código `USER_NOT_FOUND` indicando cuál.
- [ ] Si la tarea ya está `archived`, retorna `409 Conflict` con código `TASK_ALREADY_ARCHIVED`.
- [ ] No se permiten asignaciones duplicadas (mismo user en misma task): retorna `409 Conflict` con código `USER_ALREADY_ASSIGNED`.
- [ ] Endpoint idempotente vía `Idempotency-Key`.

### US-04: Completar Tarea (por Usuario)

**Como** usuario asignado a una tarea,
**quiero** marcar mi participación como completada,
**para** que cuando todos los asignados completen, la tarea se archive automáticamente y se notifique al sistema externo.

**Criterios de Aceptación:**
- [ ] `POST /tasks/:idTask/complete` acepta body con `userId` (UUID).
- [ ] Si `idTask` no existe, retorna `404 Not Found` con código `TASK_NOT_FOUND`.
- [ ] Si `userId` no existe, retorna `404 Not Found` con código `USER_NOT_FOUND`.
- [ ] Si el usuario no está asignado a la tarea, retorna `409 Conflict` con código `USER_NOT_ASSIGNED`.
- [ ] Si el usuario ya completó la tarea, retorna `409 Conflict` con código `ALREADY_COMPLETED`.
- [ ] Si la tarea ya está archivada, retorna `409 Conflict` con código `TASK_ALREADY_ARCHIVED`.
- [ ] Al completar exitosamente, el `TaskAssignment.completed` se marca como `true`.
- [ ] **Archivado automático (OCC):** Si tras esta completitud todos los asignados han finalizado, la tarea transiciona a `status: "archived"` y se encola un mensaje en SQS con los detalles de la tarea. Se usa el campo `version` para OCC; si hay conflicto de versión, se retorna `409 Conflict` con código `VERSION_CONFLICT`.
- [ ] Si NO es el último en completar, solo se actualiza el `TaskAssignment` sin archivar ni notificar.
- [ ] Endpoint idempotente vía `Idempotency-Key`.

### US-05: Listar Tareas

**Como** consumidor de la API,
**quiero** listar las tareas con filtro opcional por estado,
**para** poder ver tareas abiertas o archivadas.

**Criterios de Aceptación:**
- [ ] `GET /tasks` retorna array de tareas.
- [ ] Query param `?status=open` filtra solo tareas abiertas.
- [ ] Query param `?status=archived` filtra solo tareas archivadas.
- [ ] Sin query param, retorna todas las tareas.
- [ ] Si `status` tiene un valor inválido, retorna `400 Bad Request`.
- [ ] Cada tarea incluye sus asignaciones (userId, completed).

### US-06: Listar Usuarios

**Como** consumidor de la API,
**quiero** listar todos los usuarios con sus tareas pendientes,
**para** tener visibilidad del estado general.

**Criterios de Aceptación:**
- [ ] `GET /users` retorna array de usuarios.
- [ ] Cada usuario incluye sus tareas pendientes (no completadas, de tareas `open`).

### US-07: Listar Tareas de un Usuario

**Como** consumidor de la API,
**quiero** consultar las tareas de un usuario específico,
**para** conocer su carga de trabajo.

**Criterios de Aceptación:**
- [ ] `GET /users/:idUser/tasks` retorna array de tareas del usuario.
- [ ] Si `idUser` no existe, retorna `404 Not Found`.
- [ ] Incluye el estado de completitud del usuario en cada tarea.

### US-08: Detalle de Tarea

**Como** consumidor de la API,
**quiero** obtener el detalle completo de una tarea con todas sus asignaciones,
**para** inspeccionar su progreso.

**Criterios de Aceptación:**
- [ ] `GET /tasks/:idTask` retorna la tarea con todas sus `TaskAssignment` (incluyendo datos del usuario).
- [ ] Si `idTask` no existe, retorna `404 Not Found`.

### US-09: Historial de Notificaciones de una Tarea

**Como** administrador o consumidor,
**quiero** consultar los intentos de notificación webhook de una tarea archivada,
**para** auditar si el sistema externo fue notificado correctamente.

**Criterios de Aceptación:**
- [ ] `GET /tasks/:idTask/notifications` retorna array de `NotificationAttempt`.
- [ ] Si `idTask` no existe, retorna `404 Not Found`.
- [ ] Cada intento incluye: `id`, `taskId`, `status` (success/failed/pending), `statusCode`, `responseBody`, `attemptNumber`, `createdAt`.

### US-10: Rate Limiting

**Como** operador de la API,
**quiero** proteger los endpoints contra abuso,
**para** garantizar disponibilidad y uso de recursos.

**Criterios de Aceptación:**
- [ ] Rate limiting global configurable (por IP o por token).
- [ ] Al exceder el límite, retorna `429 Too Many Requests` con header `Retry-After`.
- [ ] Configurable por variables de entorno: `RATE_LIMIT_MAX` (default 100) y `RATE_LIMIT_WINDOW_MS` (default 60000).

### US-11: Inspección de DLQ (Admin)

**Como** administrador del sistema,
**quiero** consultar los mensajes de notificación que fallaron definitivamente tras 3 reintentos,
**para** tomar acciones correctivas manuales.

**Criterios de Aceptación:**
- [ ] Retorna array de mensajes en DLQ con: `messageId`, `body` (contenido del mensaje original), `attributes`, `sentTimestamp`.
- [ ] Si no hay mensajes en DLQ, retorna array vacío.

---

## Idempotencia Global (US-12)

**Criterios de Aceptación transversales a todos los POST:**
- [ ] Si el request incluye header `Idempotency-Key`, el sistema almacena el hash de la petición y su respuesta.
- [ ] Una petición repetida con la misma key retorna la respuesta original (mismo status code y body), sin ejecutar la lógica de negocio nuevamente.
- [ ] Si dos peticiones concurrentes llegan con la misma key, una se procesa y la otra recibe `409 Conflict` con código `IDEMPOTENCY_CONFLICT`.
- [ ] Las keys de idempotencia expiran después de 24 horas (configurable vía `IDEMPOTENCY_TTL_SECONDS`).

---

## Supuestos Implícitos

1. **UUIDv7:** Los IDs no son numéricos secuenciales como en la especificación original; se usan UUIDv7 para entornos distribuidos/serverless.
2. **No hay autenticación global:**.
3. **Ordenamiento de listas:** `GET /tasks` y `GET /users` retornan resultados ordenados por fecha de creación descendente.
4. **Sin paginación inicial:** Las listas no implementan paginación en esta fase.
5. **Transaccionalidad:** El archivado de tarea + encolado SQS ocurre en una transacción atómica a nivel de aplicación (no 2PC distribuido). Si SQS falla, se hace rollback del estado de la tarea.
6. **Worker Lambda:** El consumo de SQS y POST al webhook externo (`NOTIFY_URL`) es responsabilidad de una Lambda separada, fuera del alcance de la API CRUD pero dentro del mismo monorepo CDK.
7. **DLQ en CDK, no en runtime:** La DLQ es una cola SQS real. El endpoint `GET /admin/dlq` consulta esta cola mediante AWS SDK.
8. **pg-mem / prisma-mock para testing:** Las pruebas E2E no requieren PostgreSQL real ni Docker.
9. **Monorepo:** Código de aplicación + infraestructura CDK en un solo repositorio.

---

## Edge Cases Identificados

| # | Edge Case | Comportamiento Esperado |
|---|-----------|------------------------|
| EC-01 | Completar tarea que ya está archivada | `409 TASK_ALREADY_ARCHIVED` |
| EC-02 | Asignar usuarios a tarea archivada | `409 TASK_ALREADY_ARCHIVED` |
| EC-03 | Dos usuarios completan simultáneamente siendo el último | OCC rechaza la segunda transacción → `409 VERSION_CONFLICT`. El sistema externo solo recibe UNA notificación. |
| EC-04 | `Idempotency-Key` duplicada en requests concurrentes | Primera se procesa, segunda recibe `409 IDEMPOTENCY_CONFLICT` |
| EC-05 | `userIds` vacío en asignación | `400 Bad Request` |
| EC-06 | `userId` no existe al completar | `404 USER_NOT_FOUND` |
| EC-07 | Task sin asignaciones se completa | No debería ocurrir (no hay userId que completar). Si ocurre, `409 USER_NOT_ASSIGNED`. |
| EC-08 | `title` vacío o solo whitespace al crear task | `400 Bad Request` |
| EC-09 | Email duplicado al crear usuario | `409 EMAIL_ALREADY_EXISTS` |
| EC-10 | Request sin `Idempotency-Key` en POST | Se procesa normalmente (la idempotencia es opcional pero recomendada). |
| EC-11 | Tarea sin asignaciones: ¿se archiva sola? | No. Solo se archiva cuando el último asignado completa. Si no hay asignados, permanece `open`. |
| EC-12 | Completar una task ya completada por el mismo usuario | `409 ALREADY_COMPLETED` |
| EC-13 | Status inválido en `GET /tasks?status=` | `400 Bad Request` con código `INVALID_STATUS_FILTER` |
| EC-14 | Body malformado (JSON inválido) | `400 Bad Request` |
| EC-15 | Rate limit excedido | `429 Too Many Requests` con header `Retry-After` |

---

## Definición de Done

Un feature está completo cuando:
1. Todos los criterios de aceptación de sus user stories pasan.
2. Las pruebas unitarias y E2E asociadas pasan (`npm run test`).
3. El código sigue la estructura del monorepo definida en `03-architecture-and-infra.md`.
4. Los commits siguen Conventional Commits (validado por husky + commitlint).
5. La documentación de endpoints está reflejada en el código (schemas Fastify).