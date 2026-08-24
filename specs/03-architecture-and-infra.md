# Especificación 03 - Arquitectura e Infraestructura

## Arquitectura de Aplicación
- **Monorepo:** Estructura que unifica la aplicación Node/Fastify, infraestructura CDK y documentaciones.
- **Framework Web:** FastifyJS (elegido por su bajo overhead).
- **ORM:** Prisma acoplado con PostgreSQL.

## Infraestructura AWS (CDK TS)
- **API Compute:** AWS Lambda + Amazon API Gateway (Serverless). Garantiza escalabilidad a costo cero si no hay uso.
- **Database:** AWS RDS PostgreSQL (instancia db.t4g.micro o similar).
- **Asincronía (Webhooks):** Amazon SQS y una AWS Lambda Worker dedicada para consumir los mensajes y hacer POST al sistema externo.

## Calidad y Testing
- **Estrategia E2E:** `pg-mem` y `prisma-mock` para evitar levantar contenedores Docker en el entorno CI.
- **Validación de Commits:** `husky` + `commitlint` forzando el formato Angular (`feat:`, `fix:`, `chore:`, etc.).
