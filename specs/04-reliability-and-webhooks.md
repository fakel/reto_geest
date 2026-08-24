# Especificación 04 - Confiabilidad y Notificaciones

## Idempotencia
Se implementará a nivel global en Fastify usando hooks (`onRequest` / `onSend`).
1. El cliente envía `Idempotency-Key` en headers de endpoints POST.
2. Si existe y no ha expirado, se retorna la respuesta en caché (`200 OK` o `4xx`).
3. Si ocurre concurrencia bajo la misma llave, se retorna error o se encola transaccionalmente.

## Notificaciones Webhook (Sistema Externo)
1. Al completarse una tarea (todos sus asignados terminan), la API transacciona su estado a `archived` y encola un mensaje en AWS SQS.
2. La **Lambda Worker** extrae el mensaje de SQS y ejecuta un POST a la variable `NOTIFY_URL`.
3. **Escritura Directa a RDS:** Por cada intento, la Lambda inserta un registro en la tabla `NotificationAttempt`.
4. **Política de Reintentos:** SQS configurado con `maxReceiveCount: 3` y backoff exponencial (esperas crecientes para fallos 5xx).
5. Si superan los 3 fallos, pasa a la DLQ de SQS.
