# Especificación 01 - Dominio y Base de Datos

## Entidades Principales
- **User:** Registra la información básica de las personas (nombre, apellido, email).
- **Task:** Almacena la información de la tarea, su estado (`open` | `archived`) y un campo `version` para control de concurrencia.
- **TaskAssignment:** Tabla de unión (N:M) que vincula `User` y `Task`, manteniendo el estado de finalización individual (`completed`).
- **IdempotencyKey:** Tabla para almacenar hashes de peticiones POST, garantizando ejecuciones únicas.
- **NotificationAttempt:** Tabla para trazar el historial de reintentos del webhook.

## Decisiones de Diseño
1. **Identificadores (IDs):** Se usará `UUIDv7` (o UUIDv4) para evitar la dependencia de la secuencia de la base de datos, escalando mejor en entornos serverless. Esto difiere de los IDs numéricos del requerimiento, lo cual quedará documentado en el README.
2. **Concurrencia:** Optimistic Concurrency Control (OCC) con el campo `version` en `Task`. Si dos usuarios completan la tarea exactamente al mismo tiempo, la base de datos rechazará la transacción concurrente, evitando duplicidades en el archivado o notificación.