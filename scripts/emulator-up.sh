#!/usr/bin/env bash
# Start the local stack: AWS emulator, Postgres+pgvector, Ollama; then pull the
# configured models into Ollama.
#
# Every failure exits non-zero with the reason. Nothing is retried silently and
# no fallback service is substituted: if the emulator image cannot be pulled or
# the configured emulator does not serve a mandated service, the probe
# (bun run emulator:probe) reports that gap.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_FILE="config/config.env"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[emulator:up] FAILED: $CONFIG_FILE not found (run from the workspace root)." >&2
  exit 1
fi

read_config() {
  local key="$1" fallback="$2"
  local value
  value="$(awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$CONFIG_FILE")"
  if [[ -z "$value" ]]; then
    echo "$fallback"
  else
    echo "$value"
  fi
}

OLLAMA_CHAT_MODEL="$(read_config OLLAMA_CHAT_MODEL llama3.2:3b)"
OLLAMA_EMBED_MODEL="$(read_config OLLAMA_EMBED_MODEL nomic-embed-text)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[emulator:up] FAILED: no docker CLI on PATH. Install docker (or Podman with the docker shim) first." >&2
  exit 1
fi

# On a Podman-backed machine the compose provider talks to the user socket, which
# may simply not be running yet. This is a local prerequisite, not a hidden retry:
# if it still cannot connect the script fails and says so.
if ! docker ps >/dev/null 2>&1; then
  echo "[emulator:up] docker daemon unreachable; attempting: systemctl --user start podman.socket"
  systemctl --user start podman.socket >/dev/null 2>&1 || true
  if ! docker ps >/dev/null 2>&1; then
    echo "[emulator:up] FAILED: cannot reach the container daemon (DOCKER_HOST=${DOCKER_HOST:-unset}). Start Docker or 'systemctl --user start podman.socket' first." >&2
    exit 1
  fi
fi

COMPOSE_CMD=()
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(podman-compose)
else
  echo "[emulator:up] FAILED: no compose implementation found (tried: docker compose, docker-compose, podman-compose)." >&2
  exit 1
fi

# The emulator container needs the container-runtime socket to start Lambda
# function containers. Rootless Podman keeps it under XDG_RUNTIME_DIR, not at
# /var/run/docker.sock, so the exact path is discovered rather than assumed.
if [[ -z "${DOCKER_SOCKET:-}" ]]; then
  socket_path=""
  if command -v podman >/dev/null 2>&1; then
    socket_path="$(podman info --format '{{.Host.RemoteSocket.Path}}' 2>/dev/null || true)"
  fi
  if [[ -z "$socket_path" && -n "${XDG_RUNTIME_DIR:-}" && -S "$XDG_RUNTIME_DIR/podman/podman.sock" ]]; then
    socket_path="$XDG_RUNTIME_DIR/podman/podman.sock"
  fi
  if [[ -z "$socket_path" && -S /var/run/docker.sock ]]; then
    socket_path="/var/run/docker.sock"
  fi
  if [[ -z "$socket_path" ]]; then
    echo "[emulator:up] FAILED: could not locate the container-runtime socket; set DOCKER_SOCKET explicitly." >&2
    exit 1
  fi
  export DOCKER_SOCKET="$socket_path"
fi
if [[ ! -S "$DOCKER_SOCKET" ]]; then
  echo "[emulator:up] FAILED: DOCKER_SOCKET=$DOCKER_SOCKET is not a socket." >&2
  exit 1
fi
echo "[emulator:up] container-runtime socket: $DOCKER_SOCKET"

echo "[emulator:up] using: ${COMPOSE_CMD[*]} --env-file $CONFIG_FILE"
"${COMPOSE_CMD[@]}" --env-file "$CONFIG_FILE" -f compose.yaml up -d

echo "[emulator:up] waiting for Postgres to become healthy (container signal-postgres)…"
postgres_state=""
for _ in $(seq 1 60); do
  postgres_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' signal-postgres 2>/dev/null || echo missing)"
  if [[ "$postgres_state" == "healthy" ]]; then
    break
  fi
  sleep 2
done
if [[ "$postgres_state" != "healthy" ]]; then
  echo "[emulator:up] FAILED: signal-postgres did not become healthy (last state: $postgres_state)." >&2
  exit 1
fi
echo "[emulator:up] postgres: healthy"

echo "[emulator:up] waiting for the Ollama API on http://localhost:11434…"
ollama_ready="no"
for _ in $(seq 1 60); do
  if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    ollama_ready="yes"
    break
  fi
  sleep 2
done
if [[ "$ollama_ready" != "yes" ]]; then
  echo "[emulator:up] FAILED: Ollama did not answer on http://localhost:11434." >&2
  exit 1
fi
echo "[emulator:up] ollama: reachable"

for model in "$OLLAMA_CHAT_MODEL" "$OLLAMA_EMBED_MODEL"; do
  echo "[emulator:up] pulling model $model (this downloads on first run)…"
  if ! docker exec signal-ollama ollama pull "$model"; then
    echo "[emulator:up] FAILED: could not pull model $model." >&2
    exit 1
  fi
done

echo "[emulator:up] running containers:"
docker compose --env-file "$CONFIG_FILE" -f compose.yaml ps 2>/dev/null || docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
echo "[emulator:up] done — next: bun run emulator:probe"
