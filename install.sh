#!/usr/bin/env bash
# Install / upgrade FLOS edge agent on Wiren Board (public repo).
# Docker must already be installed.
#
# One-liner from Integrator UI:
#   curl -fsSL https://raw.githubusercontent.com/mikolaysemyonov-code/flos-edge-agent/main/install.sh \
#     | bash -s -- --cloud-url https://app.example.com --project-id UUID --device-id wb-SERIAL --token TOKEN
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
  echo "Options: --clone --git-ref REF --agent-dir DIR --data-dir DIR --github-slug owner/repo"
  echo "         --cloud-url URL --project-id ID --device-id ID --token TOKEN"
  echo "         --auth-token TOKEN (optional Bearer for /runtime/apply)"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone) DO_CLONE=true; shift ;;
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

if [[ -f "$DATA_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$DATA_DIR/.env"
  set +a
  [[ -z "$CLOUD_URL" ]] && CLOUD_URL="${FLOS_CLOUD_BASE_URL:-}"
  [[ -z "$PROJECT_ID" ]] && PROJECT_ID="${FLOS_PROJECT_ID:-}"
  [[ -z "$DEVICE_ID" ]] && DEVICE_ID="${FLOS_DEVICE_ID:-}"
  [[ -z "$TOKEN" ]] && TOKEN="${FLOS_ENROLLMENT_TOKEN:-}"
  [[ -z "$AUTH_TOKEN" ]] && AUTH_TOKEN="${FLOS_RUNTIME_HTTP_AUTH_TOKEN:-}"
  [[ -n "${FLOS_AGENT_DIR:-}" ]] && AGENT_DIR="$FLOS_AGENT_DIR"
fi

if [[ -z "$CLOUD_URL" || -z "$PROJECT_ID" || -z "$DEVICE_ID" || -z "$TOKEN" ]]; then
  echo "[flos-edge-agent] задайте --cloud-url --project-id --device-id --token (или env FLOS_*)." >&2
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
  if [[ -f "$AGENT_DIR/Dockerfile" && -f "$AGENT_DIR/reactor-edge-agent.mjs" ]]; then
    echo "[flos-edge-agent] использую файлы в $AGENT_DIR"
    return
  fi
  if [[ "$DO_CLONE" == "true" ]]; then
    echo "[flos-edge-agent] git clone $REPO_URL → $AGENT_DIR ($GIT_REF)…"
    mkdir -p "$(dirname "$AGENT_DIR")"
    git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" "$AGENT_DIR"
    return
  fi
  echo "[flos-edge-agent] скачиваю файлы с GitHub ($RAW)…"
  mkdir -p "$AGENT_DIR"
  for f in Dockerfile docker-compose.yml entrypoint.sh package.json reactor-edge-agent.mjs runtime-control-plane-http.mjs; do
    curl -fsSL "$RAW/$f" -o "$AGENT_DIR/$f"
  done
  chmod +x "$AGENT_DIR/entrypoint.sh"
}

ensure_agent_files

if [[ ! -f "$AGENT_DIR/docker-compose.yml" ]]; then
  echo "[flos-edge-agent] не найден docker-compose.yml в $AGENT_DIR" >&2
  exit 1
fi

mkdir -p "$DATA_DIR/state" /etc/wb-rules /etc/formlogic
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
EOF
chmod 600 "$DATA_DIR/.env"

echo "[flos-edge-agent] docker compose up --build…"
cd "$DATA_DIR"
docker compose --env-file "$DATA_DIR/.env" -f "$DATA_DIR/docker-compose.yml" up -d --build

echo "---"
echo "Health на контроллере:"
echo "  curl -s http://127.0.0.1:18081/runtime/health"
echo "В сервисе Integrator: «Проверить агент», затем Разметить щит."
echo "Обновление:"
echo "  curl -fsSL $RAW/install.sh | bash -s -- --cloud-url … (те же флаги; креды подхватятся из $DATA_DIR/.env)"
