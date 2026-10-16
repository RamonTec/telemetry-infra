# PADR-002 — Autenticación entre servicios con Keycloak (client credentials)

- Estado: aceptado
- Fecha: 2026-10-13
- Origen: traccar-adapter ADR-0003 (movido aquí el 2026-10-15; fuente única, los servicios la referencian).
- Alcance: **plataforma** — toda llamada REST servicio→servicio.

## Contexto
El planning protege el webhook de Traccar, pero no define cómo se autentican los servicios entre sí. Confiar solo en la red Docker deja que cualquier contenedor comprometido de esa red cree o deshabilite devices. Keycloak ya forma parte del stack.

## Decisión
- Cada servicio **llamante** es un client confidencial de Keycloak (realm único) y obtiene un access token con el grant `client_credentials`. Lo cachea hasta poco antes de `exp`.
- Cada servicio **llamado** es un client de Keycloak cuyo `clientId` es el nombre del servicio (p.ej. `traccar-adapter`) y define **client roles** por capacidad.
- La llamada lleva `Authorization: Bearer <jwt>`. El servicio llamado valida **localmente**, sin introspección por request:
  - firma con las claves JWKS del issuer (cacheadas, con refresco cuando aparece un `kid` desconocido);
  - `iss` igual al issuer configurado;
  - `aud` contiene el `clientId` propio;
  - `exp`/`nbf` vigentes, con una tolerancia de reloj de ≤ 30 s;
  - el rol requerido está en `resource_access.<clientId>.roles`.
- Respuestas (formato PADR-001): sin token, token inválido o expirado → `401 UNAUTHORIZED`; token válido sin el rol → `403 FORBIDDEN`.
- Identidad del llamante para auditoría: claim `azp` (client que pidió el token). Se loguea como `actor`.
- Quedan exentos `GET /health*` y los endpoints que tienen su propio mecanismo (p.ej. el webhook de Traccar, con token compartido).
- La red Docker interna se mantiene como **segunda** barrera, no como la única.

### Roles de traccar-adapter
| Rol | Permite |
|-----|---------|
| `groups:write` | crear groups |
| `devices:write` | registrar, deshabilitar y habilitar devices |

core-service recibe ambos roles mediante un *service account role mapping*.

## Consecuencias
- (+) Identidad por servicio, tokens que expiran, rotación de secretos centralizada y el mismo patrón para los 5 servicios.
- (+) Sin llamada a Keycloak por request: solo la descarga de JWKS, cacheada.
- (−) Cada servicio llamado necesita un guard JWT; es candidato a librería compartida.
- (−) Arranque en frío: si Keycloak no está disponible y no hay JWKS en caché, las requests protegidas responden 401.
