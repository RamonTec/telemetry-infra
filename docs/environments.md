# Modelo de entornos

## Principios
1. **Una imagen por servicio para todos los entornos.** Lo que cambia es la configuración, nunca la imagen.
2. **Configuración por variables de entorno.** Los servicios validan su config al arrancar y fallan nombrando la
   variable que falta.
3. **Secretos fuera de git.** `env/<env>.secrets.env` está en `.gitignore`; en entornos remotos los secretos vendrán
   de un gestor de secretos o de las variables del CI/CD.
4. **Se define al desplegar.** sbx y prod no existen todavía; sus archivos se crean el día del primer despliegue.

## Qué cambiará al crear `sbx` / `prod`
| Tema | local | sbx / prod (por decidir) |
|------|-------|--------------------------|
| Imágenes | construidas desde los repos hermanos | publicadas en un registro (GHCR) con versión fija |
| Keycloak | `start-dev`, H2 en el contenedor, realm importado | `start` con base de datos propia y TLS |
| Traccar | H2, `registerUnknown=true` | base de datos propia, config revisada (`traccar-adapter/docs/ops/traccar-config.md`) |
| NATS | un nodo, sin auth | autenticación (`NATS_CREDS_FILE`) y, si hace falta, clúster |
| Puertos | todos publicados al host | solo el gateway público; el webhook del adapter, nunca |
| traccar-adapter | 1 réplica | ≥ 2 réplicas, cada una con su volumen de outbox, y un balanceador delante del webhook |
| Secretos | generados por `stack.sh bootstrap` | gestor de secretos / CI |
| Plataforma | Docker Compose | Compose en un VPS al principio; Kubernetes solo si la escala lo pide |
