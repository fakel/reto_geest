# Guía de Despliegue (Deployment)

Esta guía describe, paso a paso, cómo desplegar la solución completa **RETO GEEST** en AWS con AWS CDK, tanto de forma local (CLI) como mediante el pipeline automático de GitHub Actions.

---

## 1. Arquitectura desplegada

El despliegue crea **4 stacks CDK** en orden:

| Stack | Crea |
|-------|------|
| `NetworkStack` | VPC en **2 AZs** (requisito de RDS), 1 **NAT instance** (`t3.micro`, AL2023) en la 1ª AZ en vez de NAT gateway, SG compartido de Lambdas |
| `DatabaseStack` | RDS PostgreSQL 16 (`db.t3.micro`, free-tier), secret en Secrets Manager, `DATABASE_URL` + **migración automática** del esquema |
| `QueueStack` | SQS principal + DLQ (redrive 3), Worker Lambda (NodeJS 24.x) con event source SQS |
| `ApiStack` | API Lambda (NodeJS 24.x) + API Gateway HTTP API (`$default`), env de colas y rate-limit |

```
NetworkStack ──► DatabaseStack ──► QueueStack ──► ApiStack
     │                │                │              │
     └── VPC/SG  ◄────┘  DATABASE_URL ◄┘  queue/DLQ ◄─┘
```

> Requiere cuenta AWS + región. Se asume `us-east-1`; cambia `AWS_REGION` donde corresponda.

---

## 2. Prerrequisitos

### 2.1 Local
- **Node.js >= 24** y **npm >= 10**.
- **AWS CLI v2** configurado (`aws configure` o SSO) con permisos de administrador para la cuenta/región objetivo.
- **AWS CDK** (el proyecto lo trae en `infra/devDependencies`).

### 2.2 Repositorio en GitHub
- Repo subido y con `main` como rama principal (el pipeline se dispara en `main`).

---

## 3. Variables de entorno

### 3.1 Local (`.env`)
Copia `.env.example` → `.env` y ajusta los valores (variables en el README §1, tabla completa en `.env.example`). Para el despliegue CDK solo son necesarias en tiempo de *build*:

| Variable | Uso | ¿Necesaria en synth? |
|----------|-----|----------------------|
| `DATABASE_URL` | `prisma generate` / config de Prisma | Sí (placeholder vale) |
| `NOTIFY_URL` | Worker → webhook objetivo | Sí (para el `QueueStack`) |
| `AWS_REGION` | Región de despliegue | Sí |
| `STACK_ENV` | Etiqueta del entorno en el nombre de los stacks (default `dev`) | Opcional |
| `VPC_CIDR` | CIDR base de la VPC (default `10.0.0.0/16`) | Opcional |

> **Colisión de CIDR:** si otro stack/entorno en la misma cuenta ya usa `10.0.0.0/16`, asigna un rango disjunto, p. ej. `export VPC_CIDR=10.20.0.0/16`, para evitar el error `The CIDR ... conflicts with another subnet`. Aplica también a la hora de re-desplegar sobre una VPC huérfana del primer intento fallido.

> **Fallback de `NOTIFY_URL`:** si queda **vacía/sin configurar**, el Worker no crashea: **no intenta entregar** y lanza al procesar el mensaje, de modo que SQS lo reintenta y lo **desvía a la DLQ** tras `maxReceiveCount` (3) intentos. Útil para entornos de prueba sin webhook real. `DATABASE_URL` sí sigue siendo obligatoria.

> **Nombres de stack (colisión-safe):** los stacks reciben nombres CloudFormation explícitos `reto-geest-<STACK_ENV>-<tipo>` (p. ej. `reto-geest-dev-api`). Usa un `STACK_ENV` distinto por entorno (dev → stage → prod) y por cuenta para que coexistan sin colisionar.

> `DATABASE_URL` final de las Lambdas se construye en **tiempo de deploy** a partir del secret de RDS (ver `database-stack.ts`), no se necesita el valor real localmente.

### 3.2 Secretos de GitHub
Para el pipeline automático (OIDC):

| Secret | Descripción |
|--------|-------------|
| `AWS_ROLE_ARN` | ARN del rol IAM federado (OIDC) con permisos de despliegue |
| `AWS_ACCOUNT_ID` | ID de tu cuenta AWS (ej. `123456789012`) |
| `NOTIFY_URL` | URL del webhook destino para el Worker |
| `STACK_ENV` | Sufijo de entorno en los nombres de stack (p. ej. `prod`) |
| (opcional) `AWS_REGION` | Sobrescribe la región si no es `us-east-1` |

---

## 4. Opción A — Despliegue local con CDK CLI

### Paso 1 — Instalar dependencias
```bash
npm install
```

### Paso 2 — Generar el cliente Prisma
```bash
export DATABASE_URL='postgresql://dummy:dummy@localhost:5432/dummy'  # solo para el generate
npm run db:generate
```

### Paso 3 — Configurar credenciales AWS
```bash
aws configure          # o: aws sso login
export AWS_REGION=us-east-1
export NOTIFY_URL='https://tu-webhook.example.com/hook'
```

### Paso 4 — Bootstrap de CDK (solo la primera vez / por cuenta+región)
```bash
cd infra
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION
```

### Paso 5 — Revisar el plan (diferencias)
```bash
npx cdk diff
```

### Paso 6 — Desplegar todos los stacks
```bash
npx cdk deploy --all --require-approval never
```
> El despliegue puede tardar varios minutos (RDS aprovisionándose). Puedes vigilar el progreso en la consola de CloudFormation.

### Paso 7 — Verificar (ver sección 6)

---

## 5. Opción B — Pipeline automático de GitHub Actions

El workflow `.github/workflows/deploy.yml` ejecuta:

```
push a main / manual ──► CI (lint + typecheck + test) ──► CD (synth + deploy)
                                                              │
                                              environment: production
                                                              │
                                                  OIDC → asume AWS_ROLE_ARN
```

1. **CI** corre en cada push a `main` y en cada PR (no despliega en PRs).
2. **CD** solo corre en `push` a `main` o `workflow_dispatch`, y solo si CI pasa.

### 5.1 Configurar federación OIDC (recomendado, sin keys de larga duración)

**a) Crear el Identity Provider en IAM:**

1. Consola AWS → IAM → **Identity providers** → **Add provider**.
   - Provider type: **OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audiencia (audience): `sts.amazonaws.com`

**b) Crear el rol de despliegue** (o editar uno existente) con la policy de confianza:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:TU_USUARIO/TU_REPO:ref:refs/heads/main"
        }
      }
    }
  ]
}
```
> Sustituye `ACCOUNT_ID`, `TU_USUARIO`, `TU_REPO`. ⚠️ **Importante:** el job `deploy` define el **environment `production`** de GitHub. Cuando un job usa un `environment`, el claim `sub` del token OIDC cambia al formato `repo:<usuario>@<id_usuario>/<repo>@<id_repo>:environment:<nombre>` (en vez de `:ref:refs/heads/main`) — incluso en pushes. Usa `StringLike` con comodines (ojo con el **`/`** entre owner y repo):

```json
"StringLike": {
  "token.actions.githubusercontent.com:sub": "repo:TU_USUARIO@*/TU_REPO@*:environment:production"
}
```

**c) Adjuntar la policy de permisos al rol** (mínima suficiente para CDK):

`iam:PassRole` se acota a los roles del proyecto creados por CDK — **tanto los `reto-geest-*` como los de `cdk bootstrap` (`cdk-hnb659fds-*`)** — y a los servicios que CDK/Lambdas usan (`iam:PassedToService`), evitando wildcard total. `ecr:*` se omite porque las Lambdas no usan ECR (bundle vía `NodejsFunction` → S3).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageInfraResources",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "ec2:*",
        "rds:*",
        "sqs:*",
        "lambda:*",
        "apigateway:*",
        "secretsmanager:*",
        "ssm:*",
        "logs:*",
        "iam:CreateRole",
        "iam:GetRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassRolesToServices",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::*:role/reto-geest-*",
        "arn:aws:iam::*:role/cdk-hnb659fds-*"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "lambda.amazonaws.com",
            "ec2.amazonaws.com",
            "cloudformation.amazonaws.com"
          ]
        }
      }
    }
  ]
}
```

**d) Configurar el environment `production`:**
Repo → Settings → **Environments** → **New environment** → `production`. Opcionalmente activa **Required reviewers** para exigir aprobación antes de desplegar.

**e) Añadir los secrets** (Settings → Secrets and variables → Actions):
`AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `NOTIFY_URL`.

### 5.2 Desplegar
- **Automático:** al hacer `push` a `main` (si los archivos de `packages/`, `infra/`, etc. cambiaron).
- **Manual:** repo → **Actions** → “Deploy to AWS” → **Run workflow**.

---

## 6. Verificación post-despliegue

1. Obtén la URL de la API:
   ```bash
   # desde infra/ (o consola → CloudFormation → ApiStack → Outputs → ApiUrl)
   npx cdk deploy --all --require-approval never 2>&1 | grep ApiUrl
   ```
   O en consola: **CloudFormation → ApiStack → Outputs → `ApiUrl`**.

2. Health check:
   ```bash
   curl -s <API_URL>/health
   # {"status":"ok"}
   ```

3. Probar el flujo completo (crear usuario → task → asignar → completar):
   ```bash
   API=<API_URL>

   # crear usuario
   curl -s -X POST $API/users -H 'content-type: application/json' \
        -d '{"name":"Ana","lastName":"Perez","email":"ana@example.com"}'
   # crear task
   curl -s -X POST $API/tasks -H 'content-type: application/json' -d '{"title":"Mi tarea"}'
   # asignar usuario al task
   curl -s -X POST $API/tasks/<TASK_ID>/assign \
        -H 'content-type: application/json' -d '{"userIds":["<USER_ID>"]}'
   # completar (último asignado archiva el task y encola la notificación)
   curl -s -X POST $API/tasks/<TASK_ID>/complete \
        -H 'content-type: application/json' -d '{"userId":"<USER_ID>"}'
   # ver historial de notificaciones
   curl -s $API/tasks/<TASK_ID>/notifications
   # inspeccionar DLQ
   curl -s $API/admin/dlq
   ```

4. **Alternativa en Node.js (sin curl, sin dependencias):** smoke-test automático que ejecuta el mismo flujo completo (health → crear usuario → crear task → asignar → completar → notificaciones → DLQ) con `fetch` nativo:

   ```bash
   API_URL="<API_URL>" npm run smoke:deploy
   # o directamente:
   API_URL="<API_URL>" node scripts/smoke-deploy.mjs
   ```

   Fija cuánto esperar por petición con `SMOKE_TIMEOUT_MS` (por defecto 15000). El script imprime cada comprobación y sale con código 0 si todo pasó, o 1 si algo falló (válido para CI).

5. **E2E continua (monitorización):** suite que corre en bucle hasta que se detiene (Ctrl+C), ejecutando cada ronda un escenario completo de flujos de éxito y error (usuarios, tareas, asignación, completado/archivo, notificaciones, DLQ) y acumulando resultados por check:

   ```bash
   API_URL="<API_URL>" npm run e2e:continuous
   ```

   Variables útiles: `E2E_API_URL` (o `API_URL`), `E2E_INTERVAL_MS` (pausa entre rondas, default 10000), `E2E_MAX_ROUNDS`, `E2E_ONCE=1` (una ronda, para CI), `E2E_FAIL_FAST=1`, `E2E_VERIFY_NOTIFICATION=1` (verifica que el Worker persiste la notificación), `E2E_LOG_DIR`/`E2E_LOG_FILE` (ruta del log). Cada corrida escribe **`logs/e2e-<fecha-hora>.log`** con una línea por check incluyendo datos relevantes de la respuesta (ids, `error.code`, `archived`, conteos de notificaciones/DLQ). Al salir imprime un resumen con la tasa de éxito por check y sale `0`/`1`. Si la API responde `429` (rate limit), sube `RATE_LIMIT_MAX` en la `ApiStack` o aumenta `E2E_INTERVAL_MS`.

6. Revisa los logs de Lambda (CloudWatch) para confirmar que el Worker entregó el webhook.

---

## 7. Variables de entorno finales de las Lambdas

| Lambda | Variables inyectadas |
|--------|----------------------|
| **API** | `DATABASE_URL`, `NOTIFICATION_QUEUE_URL`, `DLQ_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `NODE_ENV=production` |
| **Worker** | `DATABASE_URL`, `NOTIFY_URL`, `NODE_ENV=production` |
| **DB Migration** | `DATABASE_URL` (aplica `schema.sql` en el primer deploy) |

> `DATABASE_URL` se resuelve en deploy desde el secret de RDS; `NOTIFICATION_QUEUE_URL`/`DLQ_URL` se importan del `QueueStack`.

> **SSL obligatorio:** RDS viene con `force_ssl`. API, Worker y la Lambda de migración conectan con `ssl: { rejectUnauthorized: false }` — tráfico cifrado aceptando la cadena de CA de RDS. Sin SSL, RDS rechaza la conexión (`no pg_hba.conf entry ... no encryption`).

---

## 8. Actualizaciones y rollback

- **Actualizar:** haz `push` a `main` → el pipeline redeploya automáticamente (mismos stacks, `cdk deploy` solo aplica cambios).
- **Rollback:** en consola **CloudFormation** vuelve a “Rollback” una versión anterior de una stack, o redeploya un commit anterior con `workflow_dispatch`.

---

## 9. Troubleshooting

Errores comunes al desplegar en una cuenta nueva/compartida y cómo se resuelven (ya incorporados al código):

| Síntoma | Causa | Solución en el código |
|---------|-------|-----------------------|
| `The CIDR ... conflicts with another subnet` | Otro stack/entorno usa `10.0.0.0/16` | `VPC_CIDR` configurable (default `10.0.0.0/16`) |
| `DB subnet group doesn't meet AZ coverage` | VPC de 1 sola AZ | `maxAzs: 2` en `NetworkStack` |
| `Invalid rule description` | Carácter Unicode (`→`) en descripción de SG | Descripciones ASCII |
| `UnreservedConcurrentExecution below ... [10]` | `ReservedConcurrentExecutions` con límite de cuenta bajo | Sin reserva de concurrencia |
| `Partition "//sqs..." is not valid` | Grant IAM con URL de cola en vez de ARN | `SqsQueue.queueArn` en el policy |
| `no pg_hba.conf entry ... no encryption` | Conexión sin SSL a RDS | `ssl: { rejectUnauthorized: false }` |
| SQS / `complete` cuelga hasta el timeout (29 s) | NAT instance sin regla de entrada (tráfico de retorno) | `NatTrafficDirection.INBOUND_AND_OUTBOUND` |
| `POST /users` → 500 `INTERNAL_ERROR` | RDS sin tablas (esquema no aplicado) / falta SSL | Re-desplegar `DatabaseStack` (migración automática) |

> Si un despliegue falla a mitad, elimina los stacks huérfanos antes de reintentar: `aws cloudformation delete-stack --stack-name reto-geest-dev-<stack>` (o `cdk destroy`).

---

## 10. Teardown (eliminar infraestructura)

```bash
cd infra
NOTIFY_URL='https://example.com/webhook' npx cdk destroy --all --force
```
> Elimina todas las stacks y sus recursos (VPC, RDS, colas SQS, Lambdas, API Gateway). RDS se elimina porque usa `removalPolicy: DESTROY` (no apto para producción).

---

## 11. Costos

Diseño orientado a *free tier / mínimo costo*:
- VPC en **2 AZs** (subnets gratis; RDS exige el subnet group en ≥2 AZ) y **instancia RDS single-AZ** con `db.t3.micro` (eligible free tier).
- **1 NAT instance EC2** (`t3.micro`, Amazon Linux 2023) reemplaza al NAT gateway para el egress de las Lambdas → en cuentas nuevas es **gratuita durante 12 meses** (750 h/mes de EC2 free tier); tras el periodo, ~$7/mes vs ~$33/mes del NAT gateway gestionado.
- Las Lambdas y el NAT se sitúan en la **primera AZ**; únicamente la primera subnet privada lleva la ruta egress al NAT, de modo que el egress funciona con 1 solo NAT instance.

> La NAT instance usa una IP pública auto-asignada (no un Elastic IP) para mantener el costo mínimo; si la reinicias pierdes la IP pública. Para producción considera adjuntar un EIP (sin cargo mientras está asociado a la instancia). Consulta también la alternativa de VPC endpoints en `README.md`.
