# PADR-005 — Alta de tenants y aprovisionamiento de usuarios en Keycloak

- Estado: aceptado
- Fecha: 2026-10-20
- Alcance: **plataforma** — Keycloak (realm `telemetry`), frontend, api-gateway, core-service; afecta a telemetry-service
  y realtime-gateway (estado del tenant).
- Complementa PADR-002 (auth entre servicios) y PADR-004 (identidad, `tenant_id` y roles). Origen: core-service,
  fase 1 (`docs/product/phases/01-tenancy.md`).

## Contexto
Un tenant se crea por autoregistro público o lo da de alta el operador de plataforma. Su primer usuario (el titular)
necesita una cuenta en Keycloak con `tenant_id` y el rol `tenant-admin`. PADR-004 declara `tenant_id` editable solo por
administradores, así que el registro nativo de Keycloak no puede crear el tenant ni asignar ese atributo. Además, un
tenant puede vencer sin verificarse, suspenderse, cerrarse y reactivarse, y cada cambio afecta a sus usuarios.

## Decisión
1. **Dueño del alta**: core-service. El formulario (frontend → api-gateway → core-service) crea el tenant y su titular
   en MySQL; core-service crea el usuario en Keycloak. **El registro nativo de Keycloak queda deshabilitado**
   (`registrationAllowed: false`).
2. **Credencial del aprovisionamiento**: el service account del client confidencial existente **`core-service`**
   (PADR-002) recibe los roles `realm-management` **`manage-users`**, **`view-users`** y **`query-users`**. Ninguno más.
3. **Usuario creado por core-service**: `username` = correo, `email`, `firstName`, `lastName`, `emailVerified: false`,
   `enabled: true`, atributo `tenant_id`, client role `core-service/tenant-admin`. core-service asigna solo roles de una
   **lista permitida** (`tenant-*`, `driver`); nunca roles de realm ni de `realm-management`.
4. **Contraseña**: core-service **nunca** la recibe ni la guarda. Tras crear el usuario llama a
   `execute-actions-email` con `[VERIFY_EMAIL, UPDATE_PASSWORD]`, `client_id=web-app` y el `redirect_uri` del
   frontend; el usuario verifica el correo y define su contraseña en Keycloak. Vigencia del enlace: 72 h; core-service
   puede reenviarlo mientras el alta esté pendiente.
5. **Detección de la verificación**: claim estándar `email_verified` del access token (scope `email`). Al primer
   `GET /v1/me` con `email_verified = true`, core-service activa el tenant. Sin listeners ni extensiones (SPI) en
   Keycloak.
6. **Ciclo de vida** (siempre desde core-service, por outbox e idempotente):
   | Evento del tenant | En Keycloak |
   |-------------------|-------------|
   | Alta | Crear usuario + enviar acciones |
   | Vencimiento (alta sin verificar) | **Eliminar** el usuario (nunca tuvo actividad; libera el correo) |
   | Suspensión | Nada (core-service aplica solo lectura) |
   | Cierre | `enabled: false` a todos los usuarios del tenant **salvo el titular** |
   | Reactivación | `enabled: true` a los deshabilitados por el cierre |
7. **Configuración del realm**: `verifyEmail: true`, `resetPasswordAllowed: true`, `loginWithEmailAllowed: true`,
   `duplicateEmailsAllowed: false`, protección contra fuerza bruta activa, SMTP configurado por entorno (local: un
   capturador de correo), y **tema propio** de login, correo y cuenta para frontend.
8. **Estado del tenant fuera del token**: el token no lleva el estado del tenant. core-service lo aplica en cada
   petición. Los demás servicios que atiendan usuarios de tenant lo obtendrán de los eventos de dominio de core-service
   (core-service fase 5); hasta entonces, el frontend no ofrece esas funciones a tenants no activos.

## Consecuencias
- (+) Una sola fuente de verdad del alta (core-service) y un atributo `tenant_id` que el usuario nunca controla.
- (+) Las contraseñas solo existen en Keycloak; recuperación, verificación y bloqueo por fuerza bruta vienen de serie.
- (+) Sin código en Keycloak: todo es configuración del realm y Admin API.
- (−) `manage-users` permite gestionar **cualquier** usuario del realm, incluido el operador de plataforma. Mitigación:
  lista permitida de roles en core-service, auditoría de cada llamada y secreto del client solo en core-service.
  Revisar *fine-grained admin permissions* de Keycloak para acotarlo a usuarios con `tenant_id`.
- (−) Hasta core-service fase 5, telemetry-service y realtime-gateway no conocen el estado del tenant: el titular de
  un tenant cerrado (que conserva el login) podría llamarlos directamente.
- (−) El SMTP pasa a ser una dependencia del alta en todos los entornos.
