#!/bin/bash
# Creates one database (schema) and one user per service (architecture.md §6). Runs only on an empty volume.
set -euo pipefail
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS core CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS core_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS telemetry CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'core_service'@'%' IDENTIFIED BY '${CORE_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'telemetry_service'@'%' IDENTIFIED BY '${TELEMETRY_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON core.* TO 'core_service'@'%';
-- Prisma Migrate's shadow database (prisma migrate dev); not needed by migrate deploy.
GRANT ALL PRIVILEGES ON core_shadow.* TO 'core_service'@'%';
GRANT ALL PRIVILEGES ON telemetry.* TO 'telemetry_service'@'%';
SQL
