# PADR-003 — Contrato de eventos de telemetría en JetStream

- Estado: aceptado
- Fecha: 2026-10-13
- Origen: traccar-adapter ADR-0004 (movido aquí el 2026-10-15; fuente única, los servicios la referencian).
- Alcance: **plataforma** — productor: traccar-adapter; consumidores: telemetry-service y otros futuros.

## Contexto
FR6, FR9 y FR10 exigen un formato propio de la plataforma, deduplicación y un dead-letter, pero el planning no fija subjects ni el formato de los mensajes. Además, JetStream **no admite puntos en el nombre de un stream**, así que `telemetry.events` no puede ser el nombre del stream, solo un prefijo de subject.

## Decisión

### Streams y subjects
| Stream | Subjects | Contenido |
|--------|----------|-----------|
| `TELEMETRY_EVENTS` | `telemetry.events.position`, `telemetry.events.device-event` | eventos normalizados (FR9) |
| `TELEMETRY_DEADLETTER` | `telemetry.deadletter.traccar` | payloads que no se pudieron procesar (FR10) |

Configuración mínima (NFR6):

| Parámetro | `TELEMETRY_EVENTS` | `TELEMETRY_DEADLETTER` |
|-----------|--------------------|------------------------|
| Almacenamiento | `file` | `file` |
| Retención | `limits` | `limits` |
| `max_age` | 7 días | 30 días |
| `duplicate_window` | 10 min (≥ ventana de reintentos de Traccar) | 10 min |

Los valores se pueden configurar por variables de entorno.

### Headers de todo mensaje
- `Nats-Msg-Id`: `traccar-position-<deviceId>-<fixTime en epoch ms>` (ver enmienda 2026-10-15), `traccar-event-<eventId>` o, en el dead-letter, `traccar-deadletter-<sha256 del body>`. Los prefijos evitan que choquen los distintos espacios de ids; el hash hace que un reintento del mismo body no genere un dead-letter duplicado.
- `x-correlation-id`: según PADR-001 §1.

### Formato común (`TELEMETRY_EVENTS`)
```json
{
  "id": "traccar-position-4-1792091219000",
  "type": "position.reported",
  "version": 1,
  "source": "traccar",
  "occurredAt": "2026-10-13T12:00:00.000Z",
  "receivedAt": "2026-10-13T12:00:01.000Z",
  "correlationId": "…",
  "data": { }
}
```
- `id` coincide con `Nats-Msg-Id`. `type` ∈ {`position.reported`, `device.event`}. Si un cambio rompe el contrato, se incrementa `version` y se mantiene la anterior durante la migración.
- `data` de `position.reported`: `positionId` (o `null`), `deviceId`, `groupId`, `fixTime`, `deviceTime`, `serverTime`, `valid`, `latitude`, `longitude`, `altitude`, `speedKmh`, `course`, `accuracy`, `attributes` (objeto, sin transformar).
- `data` de `device.event`: `eventId`, `eventType` (tipo de Traccar sin transformar, p.ej. `alarm`), `deviceId`, `groupId`, `eventTime`, `positionId` (o `null`), `attributes`.
- Unidades: **km/h** (Traccar envía nudos; se convierte una sola vez, aquí). Las fechas en ISO-8601 UTC.

### Dead-letter (`TELEMETRY_DEADLETTER`)
```json
{
  "id": "traccar-deadletter-<sha256>",
  "source": "traccar",
  "kind": "position|event|unknown",
  "reason": "INVALID_JSON|SCHEMA_MISMATCH|MISSING_GROUP|PAYLOAD_TOO_LARGE|PROCESSING_ERROR",
  "detail": "texto corto, sin secretos",
  "receivedAt": "…",
  "correlationId": "…",
  "rawPayload": "<body original>",
  "rawEncoding": "utf8|base64",
  "truncated": false
}
```
- `rawPayload` es el body tal cual: en `utf8` si es UTF-8 válido y en `base64` si no lo es. Si el body supera 64 KiB solo se guardan los primeros 64 KiB y `truncated` vale `true` (siempre ocurre con `PAYLOAD_TOO_LARGE`). El `id` se calcula sobre el body completo.

### Enmienda 2026-10-15 — id de `position.reported`
Las capturas reales de Traccar 6.15.3 (spec 007, T01) muestran que el forward de posiciones se envía **antes de persistir**: `position.id` llega siempre como `0`. Un `id` basado en él (`traccar-position-0`) haría que JetStream descartara como duplicadas todas las posiciones tras la primera.
- El `id` de una posición pasa a ser `traccar-position-<deviceId>-<fixTime en epoch ms>`: clave natural, estable entre reintentos de Traccar del mismo fix y distinta entre fixes del mismo device.
- `data.positionId` es `number | null`: `null` cuando Traccar envía `0`.
- Los eventos no cambian: `event.id` y `event.positionId` sí son reales.

## Consecuencias
- (+) Los consumidores filtran por subject y deduplican por `id`. Las unidades se normalizan en un solo lugar.
- (+) El dead-letter conserva el body byte a byte, incluido el JSON inválido.
- (−) Cambiar este contrato requiere coordinar con los consumidores (versionado).
