#!/usr/bin/env bash
# Pull latest TV Orchestrator and rebuild the container on Proxmox.
#
# On the host:
#   cd /root/tv-orchestrator && ./update.sh
#
# Or one-liner:
#   curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/update.sh | bash
#
# Optional:
#   INSTALL_DIR=/root/tv-orchestrator

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/BadBraddA1/tv-orchestrator.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tv-orchestrator}"

echo "==> TV Orchestrator update"
echo "    Dir: $INSTALL_DIR"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "==> Not installed yet — cloning…"
  need_cmd git || { run_root apt-get update && run_root apt-get install -y git; }
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
git fetch origin
git pull --ff-only origin main || git reset --hard origin/main

chmod +x install.sh update.sh 2>/dev/null || true

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    echo "ERROR: docker daemon not responding" >&2
    exit 1
  fi
  DOCKER=(sudo docker)
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
elif need_cmd docker-compose; then
  COMPOSE=(docker-compose)
else
  echo "ERROR: docker compose not found" >&2
  exit 1
fi

if [[ ! -f .compose.env ]]; then
  TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-$INSTALL_DIR/media/tv}"
  DOWNLOADS_HOST="${DOWNLOADS_HOST:-$INSTALL_DIR/media/downloads}"
  mkdir -p "$TV_LIBRARY_HOST" "$DOWNLOADS_HOST" data
  cat > .compose.env <<EOF
TV_LIBRARY_HOST=${TV_LIBRARY_HOST}
DOWNLOADS_HOST=${DOWNLOADS_HOST}
EOF
fi

# Load host mount paths
set -a
# shellcheck disable=SC1091
source .compose.env
set +a

echo "==> Rebuilding container…"
"${COMPOSE[@]}" \
  --project-directory "$INSTALL_DIR" \
  -f "$INSTALL_DIR/docker-compose.yml" \
  --env-file "$INSTALL_DIR/.compose.env" \
  up -d --build

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2- || true)"
PORT="${PORT:-3080}"

echo ""
echo "==> Updated."
echo "  UI:   http://${LAN_IP:-localhost}:${PORT}"
echo "  Logs: ${COMPOSE[*]} --env-file .compose.env logs -f --tail=80"
echo ""
