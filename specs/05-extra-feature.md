# Especificación 05 - Mejora Extra (Rate Limiting y DLQ Trazabilidad)

## El Problema
Los sistemas de webhooks suelen fallar cuando el destino está inactivo de forma prolongada, perdiendo los mensajes después de los reintentos. Además, APIs públicas carecen de protección básica.

## La Solución
1. **Rate Limiting:** Implementado en Fastify para limitar abusos.
2. **Inspección de DLQ:** Un endpoint (`GET /admin/dlq`) que permite a un administrador consultar aquellos eventos de notificación que se descartaron después del backoff exponencial (3 reintentos). 

## Por qué se eligió
Combina la confiabilidad (requerimiento central) con las mejores prácticas operativas reales. Cumple el requisito de ser "una sola mejora funcional" aportando seguridad perimetral y observabilidad.
