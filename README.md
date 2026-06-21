# Plataforma de Cobros QR para Comercios

MVP local-first para practicar un stack moderno de pagos: React, TypeScript,
NestJS, Docker, DynamoDB Local, colas/eventos con LocalStack, observabilidad,
idempotencia y CI/CD.

El diseño funcional y tecnico de referencia esta en:

- `Documento_Diseno_Tecnico_Cobros_QR.docx`

## Estructura

```text
payments-qr-platform/
  apps/
    frontend/       React + Vite
    backend/        NestJS API, SSE y workers
  packages/
    shared/         Tipos y contratos compartidos
  docker-compose.yml
```

## Servicios locales

| Servicio | Puerto | Responsabilidad |
| --- | ---: | --- |
| frontend | 5173 | UI de caja, QR, estado e historial |
| backend | 3000 | API REST, SSE y workers |
| dynamodb-local | 8000 | Persistencia local |
| localstack | 4566 | SQS, SNS y EventBridge |

## Comandos

```bash
pnpm install
pnpm dev
```

Con Docker:

```bash
docker compose up --build
```

Inicializacion de infraestructura local:

```bash
pnpm infra:init
```

Hoy el script `infra:init` deja un placeholder. El siguiente paso es crear las
tablas `Payments` e `IdempotencyKeys`, las colas, la DLQ, el bus y las reglas de
EventBridge descriptas en el documento.

## Contratos iniciales

Estados de pago:

- `PENDING`
- `PROCESSING`
- `APPROVED`
- `REJECTED`
- `EXPIRED`
- `CANCELLED`

Endpoints base:

- `POST /v1/payments`
- `GET /v1/payments/:paymentId`
- `GET /v1/payments`
- `POST /v1/payments/:paymentId/cancel`
- `POST /v1/payments/:paymentId/confirm`
- `GET /v1/payment-events`
- `GET /v1/health`

## Proximos pasos sugeridos

1. Implementar idempotencia real con DynamoDB.
2. Reemplazar el repositorio en memoria por adaptadores DynamoDB.
3. Crear `infra:init` con AWS SDK apuntando a LocalStack/DynamoDB Local.
4. Publicar `PaymentCreated` y consumirlo con un worker de procesamiento.
5. Conectar frontend con React Query, formulario validado y SSE.
