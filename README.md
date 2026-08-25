# RETO GEEST - Task Management API

API REST para la gestión y asignación de tareas con archivado automático y notificaciones transaccionales.

## Stack Técnico
- **NodeJS + FastifyJS**
- **TypeScript + Prisma ORM**
- **Testing:** Vitest, Supertest, pg-mem, prisma-mock.
- **Infraestructura:** AWS CDK (Lambda, SQS, RDS PostgreSQL).

## Decisiones Técnicas y Supuestos
- **IDs por UUIDv7:** A diferencia de los ejemplos numéricos de la especificación original, usamos UUIDv7 para mayor resiliencia en un entorno escalable.
- **OCC vs Locks:** Elegimos Optimistic Concurrency Control para manejar las colisiones al archivar tareas en lugar de locks pesimistas, minimizando los cuellos de botella en RDS.
- **Entorno Local y E2E:** Reemplazamos PostgreSQL real por `pg-mem` y `prisma-mock` en la suite de pruebas para evitar el overhead de Docker/LocalStack durante el CI, manteniendo una ejecución instantánea.
- **Serverless API:** Desplegada en AWS Lambda en vez de contenedores activos 24/7.

## Instrucciones de Ejecución
(Se completarán a medida que el código esté disponible)
1. `npm install`
2. `npm run dev`
3. `npm run test`


## Estrategia de desarrollo

Se requiere un desarrollo ASAP, por lo que usaremos una estrategia de desarrollo con Agentes e IA basada en especificaciones.

En la carpeta specs podrá encontrar las especificaciones iniciales definidas en conjunto de IA.

## Nota

Se ha decidido usar Fastify sobre Express por gusto y diversidad. 

## Mejoras Futuras
- **Autenticación y Autorización:** Implementar JWT o OAuth2 para proteger los endpoints.
- **Paginación y Filtrado:** Añadir soporte para paginación y filtrado de tareas y usuarios.