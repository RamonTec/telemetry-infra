# PADR-004 — Identidad de usuarios: tenant y roles en el token de Keycloak

- Estado: aceptado
- Fecha: 2026-10-16
- Alcance: **plataforma** — frontend, api-gateway, core-service, telemetry-service, realtime-gateway.
- Complementa PADR-002 (autenticación entre servicios). Decisiones de origen: architecture.md §12 y la fase 0 de
  core-service.

## Contexto
Los usuarios finales (empleados de cada empresa cliente y el operador de la plataforma) inician sesión en el frontend
Next.js contra Keycloak (un solo realm, `telemetry`). Cada servicio necesita saber, por petición, **quién** es, **de qué
tenant** y **con qué rol**, sin consultar otra fuente y sin que el usuario pueda alterarlo.

## Decisión
1. **Client del frontend `web-app`**: público, *Authorization Code + PKCE (S256)*. Un *audience mapper* añade
   `core-service` al `aud` del access token (se añadirán otros servicios cuando expongan API a usuarios).
2. **Tenant**: atributo de usuario **`tenant_id`** (UUID del tenant en core-service), declarado en el *user profile*
   del realm como **editable solo por administradores** (el usuario lo ve pero no puede cambiarlo desde la consola de
   cuenta). Un *user attribute mapper* lo emite en el claim **`tenant_id`** del access token.
3. **Roles**:
   - Roles de tenant como **client roles de `core-service`**: `tenant-admin`, `tenant-operator`, `tenant-viewer`,
     `driver` → `resource_access.core-service.roles`.
   - Operador de la plataforma como **rol de realm** `platform-operator` → `realm_access.roles`.
4. **Reglas de coherencia** (las aplica cada servicio al construir el actor; si no se cumplen → `403`):
   - Un usuario con algún rol de tenant **debe** tener `tenant_id`.
   - Un `platform-operator` **no** tiene `tenant_id` y no tiene roles de tenant.
   - Un token sin ningún rol reconocido no tiene acceso a nada salvo rutas públicas.
5. **Validación en cada servicio**: api-gateway valida el token, y **cada servicio vuelve a validarlo** (firma con el
   JWKS del realm, `iss`, `aud`, `exp`). Defensa en profundidad: ningún servicio confía en que la red sea interna ni en
   cabeceras puestas por otro servicio.
6. **Identificador del actor**: `sub` del token (id del usuario en Keycloak). En llamadas S2S (PADR-002), `azp`.

## Consecuencias
- (+) Un solo valor de tenant por usuario, fácil de validar; el aislamiento de datos (core-service ADR-0002) parte de un
  dato que el usuario no controla.
- (+) Mismo patrón de roles que traccar-adapter (client roles del servicio que los protege).
- (−) Un usuario no puede pertenecer a dos tenants; si hiciera falta, sería otro usuario (o un rediseño).
- (−) Cambiar el tenant o los roles de un usuario no afecta a tokens ya emitidos hasta que expiran (access token corto).
- Groups de Keycloak por tenant: **no** se usan como fuente del tenant; pueden añadirse solo para organizar la consola.
