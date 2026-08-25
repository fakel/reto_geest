# UML — Estructura de la Base de Datos

Diagrama entidad-relación de la base PostgreSQL (`reto_geest`). El DDL canónico está en [`packages/api/prisma/schema.sql`](../packages/api/prisma/schema.sql) (generado desde [`schema.prisma`](../packages/api/prisma/schema.prisma)) y se aplica automáticamente al desplegar (Lambda de migración en `DatabaseStack`).

```mermaid
erDiagram
    users ||--o{ task_assignments : "asigna"
    tasks ||--o{ task_assignments : "recibe"
    tasks ||--o{ notification_attempts : "registra"

    users {
        text id PK "UUIDv7 (capa de app)"
        text name
        text last_name
        text email UK
        timestamp created_at
        timestamp updated_at
    }

    tasks {
        text id PK "UUIDv7 (capa de app)"
        text title
        text description "opcional"
        text status "open | archived"
        int version "OCC para archivado"
        timestamp created_at
        timestamp updated_at
    }

    task_assignments {
        text id PK
        text user_id FK "users.id (ON DELETE CASCADE)"
        text task_id FK "tasks.id (ON DELETE CASCADE)"
        boolean completed "default false"
        timestamp created_at
        timestamp updated_at
        "" UK "(user_id, task_id) sin duplicados"
    }

    idempotency_keys {
        text id PK
        text key_hash UK "SHA-256 de Idempotency-Key"
        text method
        text path
        int response_status
        text response_body
        timestamp created_at
        timestamp expires_at "TTL"
        "" IDX "(key_hash, method, path)"
        "" IDX "expires_at"
    }

    notification_attempts {
        text id PK
        text task_id FK "tasks.id (ON DELETE CASCADE)"
        text status "success | failed"
        int status_code "HTTP del webhook"
        text response_body
        int attempt_number "1 | 2 | 3"
        timestamp created_at
    }
```

## Relaciones

| De | A | Tipo | Cardinalidad | Reglas |
|----|---|------|--------------|--------|
| `task_assignments.user_id` | `users.id` | FK | N:1 | `ON DELETE CASCADE` |
| `task_assignments.task_id` | `tasks.id` | FK | N:1 | `ON DELETE CASCADE` |
| `notification_attempts.task_id` | `tasks.id` | FK | N:1 | `ON DELETE CASCADE` |
| `users` ↔ `tasks` (vía `task_assignments`) | — | M:N | varios asignados por tarea | UK `(user_id, task_id)` evita duplicados |

## Notas de diseño

- **`tasks.version` (Int)** habilita *Optimistic Concurrency Control*: al archivar, el `UPDATE ... WHERE id AND version = esperado` falla con 0 filas si otro proceso archivó primero → 409 `VERSION_CONFLICT`.
- **`task_assignments`**: la unicidad `(user_id, task_id)` garantiza que un usuario no pueda asignarse dos veces a la misma tarea (nivel BD, además del check en app).
- **`idempotency_keys`**: sin FK (tabla de soporte); la clave es el `key_hash` (SHA-256 del header `Idempotency-Key`) con `expiresAt` para limpieza TTL.
- **`notification_attempts`**: historial de envíos del Worker al webhook, con `attemptNumber` = `ApproximateReceiveCount` de SQS (1..3).
- Tipos textuales (`status`) en lugar de `ENUM` por compatibilidad con `pg-mem` (tests) y migraciones más simples.