#!/usr/bin/env bash
# Install / upgrade FLOS edge agent on Wiren Board (public repo).
# Docker must already be installed.
#
# One-liner from Integrator UI (после «Выдать код»):
#   curl -fsSL https://raw.githubusercontent.com/mikolaysemyonov-code/flos-edge-agent/main/install.sh \
#     | bash -s -- --fresh --cloud-url https://app.example.com --project-id UUID --device-id wb-SERIAL --token TOKEN
#
set -euo pipefail

DEFAULT_GITHUB_SLUG="${FLOS_EDGE_AGENT_GITHUB_SLUG:-mikolaysemyonov-code/flos-edge-agent}"
DEFAULT_GIT_REF="${FLOS_GIT_REF:-main}"
DEFAULT_AGENT_DIR="${FLOS_AGENT_DIR:-/opt/flos/flos-edge-agent}"
DEFAULT_DATA_DIR="${FLOS_EDGE_DATA_DIR:-/mnt/data/flos-edge}"

GITHUB_SLUG="$DEFAULT_GITHUB_SLUG"
GIT_REF="$DEFAULT_GIT_REF"
AGENT_DIR="$DEFAULT_AGENT_DIR"
DATA_DIR="$DEFAULT_DATA_DIR"
DO_CLONE=false
UPGRADE_ONLY=false
DO_FRESH=false
DO_UNINSTALL=false
CLOUD_URL="${FLOS_CLOUD_BASE_URL:-}"
PROJECT_ID="${FLOS_PROJECT_ID:-}"
DEVICE_ID="${FLOS_DEVICE_ID:-}"
TOKEN="${FLOS_ENROLLMENT_TOKEN:-}"
AUTH_TOKEN="${FLOS_RUNTIME_HTTP_AUTH_TOKEN:-}"

raw_base() {
  echo "https://raw.githubusercontent.com/${GITHUB_SLUG}/${GIT_REF}"
}

usage() {
  sed -n '1,12p' "$0" | sed 's/^# \{0,1\}//'
  echo "Options: --clone --fresh --uninstall --upgrade-only --git-ref REF --agent-dir DIR --data-dir DIR --github-slug owner/repo"
  echo "         --cloud-url URL --project-id ID --device-id ID --token TOKEN"
  echo "         --auth-token TOKEN (optional Bearer for /runtime/apply)"
  echo "  --fresh         чистая установка: каталоги + сброс state/agent.state.json"
  echo "  --uninstall     остановить контейнер и удалить данные агента (для установки заново)"
  echo "  --upgrade-only  обновление без нового enrollment token (креды из \$DATA_DIR/.env)"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone) DO_CLONE=true; shift ;;
    --fresh) DO_FRESH=true; shift ;;
    --uninstall) DO_UNINSTALL=true; shift ;;
    --upgrade-only) UPGRADE_ONLY=true; shift ;;
    --git-ref) GIT_REF="${2:-}"; shift 2 ;;
    --agent-dir) AGENT_DIR="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --github-slug) GITHUB_SLUG="${2:-}"; shift 2 ;;
    --cloud-url) CLOUD_URL="${2:-}"; shift 2 ;;
    --project-id) PROJECT_ID="${2:-}"; shift 2 ;;
    --device-id) DEVICE_ID="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --auth-token) AUTH_TOKEN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[flos-edge-agent] unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "[flos-edge-agent] нужен curl" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[flos-edge-agent] docker не найден — установите Docker на WB и повторите." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "[flos-edge-agent] нужен docker compose plugin." >&2
  exit 1
fi

if [[ "$DO_UNINSTALL" == "true" ]]; then
  echo "[flos-edge-agent] удаляю контейнер и локальные данные агента ($DATA_DIR)…"
  if [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    (
      cd "$DATA_DIR"
      if [[ -f "$DATA_DIR/.env" ]]; then
        docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml" down --remove-orphans 2>/dev/null || true
      else
        docker compose -f "$DATA_DIR/docker-compose.yml" down --remove-orphans 2>/dev/null || true
      fi
    )
  fi
  docker rm -f flos-edge-agent 2>/dev/null || true
  rm -rf "$DATA_DIR/state"
  rm -f "$DATA_DIR/.env" "$DATA_DIR/docker-compose.yml"
  echo "[flos-edge-agent] агент удалён."
  echo "Для установки заново: в сервисе «Выдать код» → install.sh --fresh …"
  exit 0
fi

# CLI flags win. Read previous .env only for missing values — never `set -a; source`
# (that exports stale FLOS_* into the shell; docker compose then prefers shell over --env-file).
CLI_CLOUD_URL="$CLOUD_URL"
CLI_PROJECT_ID="$PROJECT_ID"
CLI_DEVICE_ID="$DEVICE_ID"
CLI_TOKEN="$TOKEN"
CLI_AUTH_TOKEN="$AUTH_TOKEN"

if [[ -f "$DATA_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  # Parse KEY=VALUE lines without exporting into this shell.
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in
      FLOS_CLOUD_BASE_URL) [[ -z "$CLI_CLOUD_URL" ]] && CLOUD_URL="$val" ;;
      FLOS_PROJECT_ID) [[ -z "$CLI_PROJECT_ID" ]] && PROJECT_ID="$val" ;;
      FLOS_DEVICE_ID) [[ -z "$CLI_DEVICE_ID" ]] && DEVICE_ID="$val" ;;
      FLOS_ENROLLMENT_TOKEN) [[ -z "$CLI_TOKEN" ]] && TOKEN="$val" ;;
      FLOS_RUNTIME_HTTP_AUTH_TOKEN) [[ -z "$CLI_AUTH_TOKEN" ]] && AUTH_TOKEN="$val" ;;
      FLOS_AGENT_DIR) AGENT_DIR="$val" ;;
    esac
  done < "$DATA_DIR/.env"
  [[ -n "$CLI_CLOUD_URL" ]] && CLOUD_URL="$CLI_CLOUD_URL"
  [[ -n "$CLI_PROJECT_ID" ]] && PROJECT_ID="$CLI_PROJECT_ID"
  [[ -n "$CLI_DEVICE_ID" ]] && DEVICE_ID="$CLI_DEVICE_ID"
  [[ -n "$CLI_TOKEN" ]] && TOKEN="$CLI_TOKEN"
  [[ -n "$CLI_AUTH_TOKEN" ]] && AUTH_TOKEN="$CLI_AUTH_TOKEN"
fi

if [[ -z "$CLOUD_URL" || -z "$PROJECT_ID" || -z "$DEVICE_ID" ]]; then
  echo "[flos-edge-agent] задайте --cloud-url --project-id --device-id (или env FLOS_* / $DATA_DIR/.env)." >&2
  exit 1
fi
if [[ "$UPGRADE_ONLY" != "true" && -z "$TOKEN" ]]; then
  echo "[flos-edge-agent] задайте --token (или FLOS_ENROLLMENT_TOKEN в .env)." >&2
  exit 1
fi
if [[ "$UPGRADE_ONLY" == "true" && ! -f "$DATA_DIR/.env" ]]; then
  echo "[flos-edge-agent] --upgrade-only: нет $DATA_DIR/.env" >&2
  exit 1
fi

CLOUD_URL="${CLOUD_URL%/}"
RAW="$(raw_base)"
REPO_URL="https://github.com/${GITHUB_SLUG}.git"

ensure_agent_files() {
  if [[ -d "$AGENT_DIR/.git" ]]; then
    echo "[flos-edge-agent] обновляю $AGENT_DIR ($GIT_REF)…"
    git -C "$AGENT_DIR" fetch --depth 1 origin "$GIT_REF"
    git -C "$AGENT_DIR" checkout -q "$GIT_REF" 2>/dev/null || git -C "$AGENT_DIR" checkout -q "origin/$GIT_REF"
    git -C "$AGENT_DIR" reset --hard "origin/$GIT_REF" 2>/dev/null || git -C "$AGENT_DIR" pull --ff-only origin "$GIT_REF"
    return
  fi
  if [[ "$DO_CLONE" == "true" ]]; then
    echo "[flos-edge-agent] git clone $REPO_URL → $AGENT_DIR ($GIT_REF)…"
    mkdir -p "$(dirname "$AGENT_DIR")"
    rm -rf "$AGENT_DIR"
    git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" "$AGENT_DIR"
    return
  fi
  # Always refresh from GitHub so field upgrades pick up fixes (no stale cache).
  echo "[flos-edge-agent] скачиваю файлы с GitHub ($RAW)…"
  mkdir -p "$AGENT_DIR/lib"
  for f in Dockerfile docker-compose.yml entrypoint.sh package.json reactor-edge-agent.mjs runtime-control-plane-http.mjs; do
    curl -fsSL "$RAW/$f" -o "$AGENT_DIR/$f"
  done
  curl -fsSL "$RAW/lib/mark-shield-discoverable-device.mjs" -o "$AGENT_DIR/lib/mark-shield-discoverable-device.mjs"
  chmod +x "$AGENT_DIR/entrypoint.sh"
}

ensure_agent_files

if [[ ! -f "$AGENT_DIR/docker-compose.yml" ]]; then
  echo "[flos-edge-agent] не найден docker-compose.yml в $AGENT_DIR" >&2
  exit 1
fi

mkdir -p "$DATA_DIR/state" /etc/wb-rules /etc/formlogic
if [[ "$DO_FRESH" == "true" ]]; then
  echo "[flos-edge-agent] --fresh: сброс state/agent.state.json"
  rm -f "$DATA_DIR/state/agent.state.json"
fi
cp "$AGENT_DIR/docker-compose.yml" "$DATA_DIR/docker-compose.yml"

cat > "$DATA_DIR/.env" <<EOF
FLOS_AGENT_DIR=$AGENT_DIR
FLOS_EDGE_DATA_DIR=$DATA_DIR
FLOS_CLOUD_BASE_URL=$CLOUD_URL
FLOS_PROJECT_ID=$PROJECT_ID
FLOS_DEVICE_ID=$DEVICE_ID
FLOS_ENROLLMENT_TOKEN=$TOKEN
FLOS_RUNTIME_HTTP_AUTH_TOKEN=$AUTH_TOKEN
FLOS_CONTROLLER_MQTT_URL=mqtt://127.0.0.1:1883
FLOS_STRICT_SIGNATURES=false
EOF
chmod 600 "$DATA_DIR/.env"

# Compose interpolates ${VAR} from the *shell* before --env-file. Force shell to match the file.
export FLOS_AGENT_DIR="$AGENT_DIR"
export FLOS_EDGE_DATA_DIR="$DATA_DIR"
export FLOS_CLOUD_BASE_URL="$CLOUD_URL"
export FLOS_PROJECT_ID="$PROJECT_ID"
export FLOS_DEVICE_ID="$DEVICE_ID"
export FLOS_ENROLLMENT_TOKEN="$TOKEN"
export FLOS_RUNTIME_HTTP_AUTH_TOKEN="$AUTH_TOKEN"
export FLOS_CONTROLLER_MQTT_URL="mqtt://127.0.0.1:1883"
export FLOS_STRICT_SIGNATURES="false"

echo "[flos-edge-agent] docker compose up --build…"
cd "$DATA_DIR"
set +e
docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml" up -d --build
COMPOSE_RC=$?
set -e
if [[ "$COMPOSE_RC" != "0" ]]; then
  echo "[flos-edge-agent] WARN: compose --build exit=$COMPOSE_RC — пробую up -d без rebuild…" >&2
  docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml" up -d || true
fi
# Never leave the field without a running agent after install/upgrade.
if ! docker ps --filter name=flos-edge-agent --format '{{.Names}}' | grep -q '^flos-edge-agent$'; then
  echo "[flos-edge-agent] WARN: контейнер не Running — docker start / compose up -d…" >&2
  docker start flos-edge-agent 2>/dev/null || true
  docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml" up -d || true
fi

echo "[flos-edge-agent] проверяю облако с контроллера…"
if curl -fsS --max-time 20 -o /dev/null "$CLOUD_URL/"; then
  echo "[flos-edge-agent] облако доступно: $CLOUD_URL"
else
  echo "[flos-edge-agent] WARN: $CLOUD_URL недоступен с щита (DNS/firewall/Tailscale). Enroll не пройдёт." >&2
fi

echo "[flos-edge-agent] жду http://127.0.0.1:18081/runtime/health…"
HEALTH_OK=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 2 "http://127.0.0.1:18081/runtime/health" 2>/dev/null | grep -q '"ok"'; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

if [[ "$HEALTH_OK" != "1" ]]; then
  echo "[flos-edge-agent] ERROR: /runtime/health не ответил за 45с." >&2
  echo "--- docker ps ---" >&2
  docker ps -a --filter name=flos-edge-agent >&2 || true
  echo "--- docker logs (tail 100) ---" >&2
  docker logs --tail 100 flos-edge-agent >&2 || true
  echo "---" >&2
  echo "Частые причины: порт 18081 занят, контейнер падает, нет FLOS_* в .env." >&2
  exit 1
fi

echo "---"
echo "Health OK:"
curl -sS --max-time 3 "http://127.0.0.1:18081/runtime/health" || true
echo
echo "В сервисе Integrator: «Проверить агент», затем Разметить щит."
echo "Если «агент не зарегистрирован»: docker logs --tail 50 flos-edge-agent | grep -E 'enroll|fetch'"
echo "Обновление:"
echo "  curl -fsSL $RAW/install.sh | bash -s -- --upgrade-only (креды из $DATA_DIR/.env)"
echo "Удаление (переустановка):"
echo "  curl -fsSL $RAW/install.sh | bash -s -- --uninstall"
