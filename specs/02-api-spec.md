# Especificación 02 - Definición de la API

## Endpoints Principales
- `POST /users`: Registra un usuario. Requiere name, lastName, email.
- `POST /tasks`: Registra una tarea. Requiere title.
- `POST /tasks/:idTask/assign`: Asigna usuarios a una tarea (Body: `{ "userIds": [...] }`).
- `POST /tasks/:idTask/complete`: Marca la participación del usuario como completada (Body: `{ "userId": "..." }`). Gatilla el archivado si es el último.
- `GET /tasks`: Lista tareas (Soporta `?status=open|archived`).
- `GET /users`: Lista usuarios y sus tareas pendientes.
- `GET /users/:idUser/tasks`: Lista las tareas de un usuario específico.
- `GET /tasks/:idTask`: Detalle completo de la tarea y asignaciones.
- `GET /tasks/:idTask/notifications`: Lista los intentos de notificación (webhook).

## Extra Feature: DLQ Endpoint
- `GET /admin/dlq`: Endpoint protegido con autenticación para listar mensajes de notificaciones que fallaron tras 3 reintentos.

## Formato Estándar de Errores
Todos los errores de la API deben retornar la estructura:
```json
{
  "error": {
    "code": "CODIGO_ERROR",
    "message": "Descripción detallada del error"
  }
}
```
