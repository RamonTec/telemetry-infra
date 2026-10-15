#!/usr/bin/env bash
# Starts and manages the telemetry platform stack for one environment.
#
#   ./stack.sh <command> [--env <name>] [--build] [service...]
#
# Commands:
#   up         start the stack (runs bootstrap first if needed)
#   down       stop the stack, keep data
#   reset      stop the stack and DELETE its data volumes
#   logs       follow logs (all or the given services)
#   ps         list containers
#   bootstrap  create the Traccar admin user and its API token
#
# Environments: each one is compose.<env>.yml + env/<env>.env. Only "local" exists for now.
set -euo pipefail

cd "$(dirname "$0")"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

[[ $# -ge 1 ]] || usage 1
COMMAND=$1; shift
ENV_NAME=local
BUILD=()
SERVICES=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --env) ENV_NAME=${2:?--env needs a value}; shift 2 ;;
    --env=*) ENV_NAME=${1#--env=}; shift ;;
    --build) BUILD=(--build); shift ;;
    -h|--help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage 1 ;;
    *) SERVICES+=("$1"); shift ;;
  esac
done

ENV_FILE=env/$ENV_NAME.env
SECRETS_FILE=env/$ENV_NAME.secrets.env
OVERRIDE=compose.$ENV_NAME.yml
if [[ ! -f $ENV_FILE || ! -f $OVERRIDE ]]; then
  echo "Environment '$ENV_NAME' is not configured yet (missing $OVERRIDE or $ENV_FILE)." >&2
  exit 1
fi
[[ -f $SECRETS_FILE ]] || : > "$SECRETS_FILE"

compose() {
  docker compose -f compose.yml -f "$OVERRIDE" \
    --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" "$@"
}

has_token() { grep -q '^TRACCAR_API_TOKEN=.\+' "$SECRETS_FILE"; }

bootstrap() {
  echo "Bootstrapping Traccar API token for '$ENV_NAME'..."
  compose up -d "${BUILD[@]}" traccar
  # Throwaway container from the adapter image (it has Node); no adapter config needed.
  local token
  token=$(compose run --rm --no-deps -T \
    -e TRACCAR_ADMIN_EMAIL -e TRACCAR_ADMIN_PASSWORD \
    -v "$PWD/scripts:/scripts:ro" --entrypoint node \
    traccar-adapter /scripts/traccar-token.mjs)
  grep -v '^TRACCAR_API_TOKEN=' "$SECRETS_FILE" > "$SECRETS_FILE.tmp" || true
  echo "TRACCAR_API_TOKEN=$token" >> "$SECRETS_FILE.tmp"
  mv "$SECRETS_FILE.tmp" "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  echo "Token saved in $SECRETS_FILE"
}

# Export env-file values not already set in the shell (shell wins, like in Compose),
# so bootstrap's `-e NAME` pass-through sees them.
while IFS='=' read -r key value; do
  [[ $key =~ ^[A-Z_][A-Z0-9_]*$ && -z ${!key+x} ]] && export "$key=$value"
done < "$ENV_FILE"

case $COMMAND in
  up)
    has_token || bootstrap
    compose up -d "${BUILD[@]}" "${SERVICES[@]}"
    compose ps
    ;;
  down) compose down ;;
  reset)
    read -r -p "Delete all '$ENV_NAME' data volumes? [y/N] " answer
    [[ $answer == [yY] ]] || exit 1
    compose down -v
    : > "$SECRETS_FILE"
    ;;
  logs) compose logs -f "${SERVICES[@]}" ;;
  ps) compose ps ;;
  bootstrap) bootstrap ;;
  *) echo "Unknown command: $COMMAND" >&2; usage 1 ;;
esac
