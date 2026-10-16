# PADR-001 — Convenciones de plataforma: correlación, salud, errores y logging

- Estado: aceptado
- Fecha: 2026-10-13
- Origen: traccar-adapter ADR-0002 (movido aquí el 2026-10-15; fuente única, los servicios la referencian).
- Alcance: **plataforma** — aplica a api-gateway, core-service, traccar-adapter, telemetry-service y realtime-gateway.

## Contexto
Ningún servicio tiene aún convención para trazar una request entre servicios, exponer salud ni devolver errores. Sin una convención común, telemetry-service no podría correlacionar un evento NATS con la llamada REST que lo originó, y el frontend recibiría formatos de error distintos según el servicio.

## Decisión

### 1. Correlation ID
- Header: **`x-correlation-id`** en toda request y respuesta HTTP.
- Valor válido: 1-128 caracteres de `[A-Za-z0-9._-]`. Si falta o es inválido, el servicio receptor genera un **UUID v4**.
- api-gateway lo genera en el borde; cada servicio lo **reutiliza** y lo **propaga**:
  - en llamadas HTTP salientes, mismo header;
  - en mensajes NATS/JetStream, como header `x-correlation-id` del mensaje.
- Se devuelve siempre en el header de respuesta.

### 2. Salud
- `GET /health` — liveness: `200 {"status":"ok"}`, sin auth, sin consultar dependencias.
- `GET /health/ready` — readiness (opcional, por servicio): `200|503 {"status":"ok"|"error","checks":{"<dep>":"ok"|"error"}}`.

### 3. Formato de error HTTP
```json
{ "code": "NOT_FOUND", "message": "Human readable message", "correlationId": "…", "details": [] }
```
- `code`: SCREAMING_SNAKE_CASE, estable, parte del contrato (los clientes deciden por `code`, nunca por `message`).
- `details`: opcional, solo para errores de validación: `[{ "field": "imei", "issue": "must be 15 digits" }]`.
- Nunca se devuelve stack, nombres de clases ni mensajes de dependencias.

| code | HTTP |
|------|------|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `UPSTREAM_UNAVAILABLE` | 503 |
| `INTERNAL_ERROR` | 500 |

Los servicios pueden añadir códigos propios de dominio (p.ej. `DEVICE_NOT_FOUND` → 404) mapeados a uno de esos status.

### 4. Logging
- Librería: **`nestjs-pino`** (pino + pino-http), reemplazando el logger por defecto de Nest (`app.useLogger`).
- Una línea JSON por evento en **stdout**. Sin ficheros, sin pretty-print fuera de desarrollo local.
- Campos obligatorios:

| Campo | Contenido |
|-------|-----------|
| `time` | ISO-8601 UTC |
| `level` | etiqueta: `debug` \| `info` \| `warn` \| `error` |
| `service` | nombre del servicio (`package.json#name`) |
| `context` | clase/módulo emisor |
| `msg` | mensaje en inglés |
| `correlationId` | presente siempre que haya request o mensaje en curso |

- Log de request (automático, pino-http) con `req.method`, `req.url`, `res.statusCode`, `responseTime` (ms). Nivel: `error` si 5xx, `warn` si 4xx, `info` en otro caso; `debug` para `/health*`.
- `LOG_LEVEL` (`debug|info|warn|error`, defecto `info`) controla el nivel mínimo.
- **Redacción obligatoria**: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]` y cualquier header de token compartido. Nunca se loguean bodies completos de requests HTTP por defecto.

## Consecuencias
- (+) Una búsqueda por `correlationId` reconstruye el recorrido REST → NATS → consumidor.
- (+) Clientes y api-gateway manejan errores de todos los servicios con un solo parser.
- (−) Cada servicio debe configurar nestjs-pino y un exception filter equivalente; candidato a librería compartida cuando haya ≥ 2 servicios implementándolo.
