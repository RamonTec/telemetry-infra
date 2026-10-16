# telemetry-infra

Cómo se ejecuta la plataforma de telemetría: compose de todos los servicios, configuración compartida (realm de
Keycloak, Traccar, NATS) y el script `stack.sh`. **No contiene código de servicios**: cada microservicio construye
su imagen en su propio repo; aquí solo se juntan y se arrancan.

## Inicio rápido (local)

Requisitos: Docker con Compose v2 y los repos hermanos clonados junto a este (`../traccar-adapter`, …).

```bash
docker build -t traccar-adapter:local ../traccar-adapter   # o: ./stack.sh up --build
./stack.sh up            # arranca todo; la primera vez crea el usuario y el token de Traccar
./stack.sh ps
./stack.sh logs traccar-adapter
./stack.sh smoke         # prueba de punta a punta del stack en marcha
./stack.sh down          # para, conserva los datos
./stack.sh reset         # para y BORRA los volúmenes (pide confirmación)
```

| Servicio | URL desde el host | Dentro de la red `telemetry` |
|----------|-------------------|------------------------------|
| traccar-adapter | http://localhost:3000 | http://traccar-adapter:3000 |
| Keycloak (admin `admin`/`admin`) | http://localhost:8080 | http://keycloak:8080 |
| Traccar web (`admin@telemetry.local`/`admin`) | http://localhost:18082 | http://traccar:8082 |
| Traccar OsmAnd | `localhost:15055` | `traccar:5055` |
| NATS / monitor | `localhost:4222` / http://localhost:8222 | `nats://nats:4222` |

Los puertos de host se cambian en `env/local.env` o con variables de shell (`TRACCAR_WEB_PORT=28082 ./stack.sh up`):
la shell tiene prioridad sobre el archivo.

## Entornos

Un entorno = `compose.<env>.yml` (ajustes sobre `compose.yml`) + `env/<env>.env` (valores, versionado, sin secretos)
+ `env/<env>.secrets.env` (secretos, **no versionado**). `./stack.sh <cmd> --env <env>`; por defecto `local`.

| Entorno | Estado |
|---------|--------|
| `local` | listo |
| `sbx`, `prod` | sin definir: se crean sus dos archivos cuando exista el primer despliegue (ver [docs/environments.md](docs/environments.md)) |

## Prueba de punta a punta

`./stack.sh smoke` comprueba el stack en marcha y termina con `SMOKE PASSED` (exit 0) o `SMOKE FAILED` (exit 1):

1. traccar-adapter `ready` (Traccar, NATS y outbox `ok`).
2. Keycloak emite un token *client credentials* (`SMOKE_CLIENT_ID`) con el `iss`, `aud` y roles esperados.
3. traccar-adapter rechaza una petición sin token (401) y acepta `POST /groups` y `POST /devices` con el token real.
4. Traccar acepta una posición OsmAnd del device y el evento `position.reported` llega a `TELEMETRY_EVENTS`.

Es idempotente (mismo group y device en cada ejecución). A mano, desde el host:

1. Token: `POST http://localhost:8080/realms/telemetry/protocol/openid-connect/token` con
   `grant_type=client_credentials`, `client_id=core-service`, `client_secret=core-service-secret`.
2. `POST http://localhost:3000/groups` y `POST /devices` con `Authorization: Bearer <token>`.
3. Posición OsmAnd: `GET http://localhost:15055/?id=<IMEI>&lat=19.43&lon=-99.13&timestamp=<epoch>`.

Los tokens del realm `telemetry` se emiten siempre con `iss = http://keycloak:8080/realms/telemetry` (atributo
`frontendUrl` del realm), el issuer que validan los servicios dentro de la red, aunque el token se pida desde
`localhost`. El realm `master` (consola de admin) usa hostname dinámico y sigue la URL del navegador. En entornos
remotos esto se sustituye por `KC_HOSTNAME` con el dominio público.

## Contenido

| Ruta | Qué es |
|------|--------|
| `stack.sh` | Punto de entrada: `up`, `down`, `reset`, `logs`, `ps`, `bootstrap`, `smoke` |
| `compose.yml` | Servicios y red comunes a todos los entornos |
| `compose.local.yml` | Local: modos dev, puertos de host, imágenes construidas desde los repos hermanos |
| `env/local.env` | Valores de desarrollo (sin secretos reales) |
| `keycloak/realm-telemetry.json` | Realm `telemetry`: clients, roles, audiencias |
| `traccar/traccar.local.xml` | Config de Traccar local; las URLs y headers del forward vienen de `compose.yml` |
| `scripts/smoke.mjs` | Prueba de punta a punta (`./stack.sh smoke`) |
| `scripts/traccar-token.mjs` | Crea el primer usuario de Traccar y emite su token de API (`./stack.sh bootstrap`) |

## Keycloak: clients del realm

- **`traccar-adapter`** (receptor, bearer-only): roles de client `groups:write`, `devices:write`.
- **`core-service`** (llamante): secret `core-service-secret` (solo local), service account con ambos roles y
  audience mapper → `aud: traccar-adapter`. El `azp` del token es el `actor` en los logs de auditoría del adapter.
