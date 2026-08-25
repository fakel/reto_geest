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

Requisitos: **Node.js >= 20** (recomendado 24.x) y **npm >= 10**.

```bash
# 1. Instalar dependencias de todos los workspaces
npm install

# 2. Ejecutar la suite de pruebas (Vitest, sin necesidad de Docker/PostgreSQL)
npm run test

# 3. Lint de TypeScript (ESLint 9 + typescript-eslint)
npm run lint

# 4. Verificación de tipos en todos los paquetes
npm run typecheck

# 5. Build de api y worker
npm run build

# 6. Servidor de desarrollo local (api)
npm run dev
```

> Nota: `npm run test` usa `--passWithNoTests` para que el pipeline CI salga limpio hasta que existan suites de pruebas (a partir de T-04).

## Estructura del Monorepo

El proyecto es un **monorepo** gestionado con *npm workspaces*:

```
RETO GEEST/
├── packages/
│   ├── api/                    # Fastify REST API (handler de AWS Lambda)
│   │   ├── src/                # code (routes, services, plugins, schemas)
│   │   ├── prisma/             # schema.prisma + migraciones
│   │   └── tests/              # suites Vitest + pg-mem
│   └── worker/                 # Lambda consumidora de SQS (webhook delivery)
│       ├── src/                # code (handler, webhook, notification-log)
│       └── tests/              # suites Vitest
├── infra/                      # Infraestructura AWS CDK (VPC, RDS, SQS/DLQ, Lambdas)
│   ├── bin/                    # app.ts (entrada CDK)
│   └── lib/                    # stacks (network, database, queue, api)
├── specs/                      # Especificaciones del proyecto
├── .husky/                     # Hooks de git (commit-msg, pre-commit)
├── commitlint.config.js        # Validación Conventional Commits
├── eslint.config.mjs           # Config ESLint 9 (flat config)
├── tsconfig.base.json          # Opciones TS compartidas
└── package.json                # Raíz (workspaces + scripts)
```

## Herramientas de Desarrollo

- **TypeScript** — compilación tipada en todos los paquetes (config base en `tsconfig.base.json`).
- **Vitest** — test runner (unit + E2E con `pg-mem` / `prisma-mock`, sin infraestructura real).
- **ESLint 9** (flat config) + **typescript-eslint** — calidad de código.
- **husky + commitlint** — validan los mensajes de commit en formato **Conventional Commits** (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, etc.) mediante hooks de git.
- **lint-staged** — ejecuta lint sobre los archivos staged en `pre-commit`.
- **AWS CDK v2** — definición de infraestructura como código en `infra/`.


## Estrategia de desarrollo

Se requiere un desarrollo ASAP, por lo que usaremos una estrategia de desarrollo con Agentes e IA basada en especificaciones.

En la carpeta specs podrá encontrar las especificaciones iniciales definidas en conjunto de IA.

## Nota

Se ha decidido usar Fastify sobre Express por gusto y diversidad. 

## Mejoras Futuras
- **Autenticación y Autorización:** Implementar JWT o OAuth2 para proteger los endpoints.
- **Paginación y Filtrado:** Añadir soporte para paginación y filtrado de tareas y usuarios.

## Costos de desarrollo IA

- Definición de SDD: DeepSeek V4 Pro/$0.15