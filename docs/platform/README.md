# Documentación de plataforma

Lo que aplica a **todos** los servicios. Cada servicio documenta lo suyo en su repo y referencia esto.

| Documento | Qué es |
|-----------|--------|
| [architecture.md](architecture.md) | Producto, arquitectura, comunicación, datos, auth, despliegue y pendientes |
| [decisions/](decisions/) | Decisiones de plataforma (PADR) |
| [../environments.md](../environments.md) | Modelo de entornos (local, sbx, prod) |

## Decisiones de plataforma (PADR)
| ID | Decisión | Antes |
|----|----------|-------|
| [PADR-001](decisions/0001-http-logging-conventions.md) | Correlación, salud, errores y logging HTTP | traccar-adapter ADR-0002 |
| [PADR-002](decisions/0002-service-to-service-auth.md) | Autenticación entre servicios (Keycloak, client credentials) | traccar-adapter ADR-0003 |
| [PADR-003](decisions/0003-telemetry-event-contract.md) | Contrato de eventos de telemetría en JetStream | traccar-adapter ADR-0004 |
| [PADR-004](decisions/0004-user-identity-and-tenant-claims.md) | Identidad de usuarios: `tenant_id` y roles en el token | — |

Una decisión nueva que afecte a más de un servicio se escribe aquí como `PADR-NNN`; las de un solo servicio, como
ADR en su repo.
