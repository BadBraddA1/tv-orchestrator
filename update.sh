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
#   COMPOSE_HOST_DIR=/root/tv-orchestrator   # required when run from inside the container

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

# Quote KEY=value lines that contain spaces (e.g. /mnt/plex/TV Shows).
fix_compose_env_quotes() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local tmp key val
  tmp="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      if [[ "$val" != \"*\" && "$val" != \'*\' && "$val" == *" "* ]]; then
        printf '%s="%s"\n' "$key" "$val" >> "$tmp"
      else
        printf '%s\n' "$line" >> "$tmp"
      fi
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$file"
  mv "$tmp" "$file"
}

# Ensure COMPOSE_HOST_DIR= (absolute path on the Proxmox host) is in .compose.env
ensure_compose_host_dir() {
  local host_dir="$1"
  local file="$2"
  touch "$file"
  if grep -qE '^COMPOSE_HOST_DIR=' "$file" 2>/dev/null; then
    # rewrite line
    local tmp
    tmp="$(mktemp)"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^COMPOSE_HOST_DIR= ]]; then
        printf 'COMPOSE_HOST_DIR=%s\n' "$host_dir" >> "$tmp"
      else
        printf '%s\n' "$line" >> "$tmp"
      fi
    done < "$file"
    mv "$tmp" "$file"
  else
    printf 'COMPOSE_HOST_DIR=%s\n' "$host_dir" >> "$file"
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
  MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}"
  DOWNLOADS_HOST="${DOWNLOADS_HOST:-$INSTALL_DIR/media/downloads}"
  mkdir -p "$TV_LIBRARY_HOST" "$MOVIE_LIBRARY_HOST" "$DOWNLOADS_HOST" data
  cat > .compose.env <<EOF
TV_LIBRARY_HOST="${TV_LIBRARY_HOST}"
MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST}"
DOWNLOADS_HOST="${DOWNLOADS_HOST}"
EOF
fi

# Ensure movies mount is present for upgrades from TV-only installs
if ! grep -qE '^MOVIE_LIBRARY_HOST=' .compose.env 2>/dev/null; then
  echo "MOVIE_LIBRARY_HOST=\"${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}\"" >> .compose.env
fi
mkdir -p "${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}" 2>/dev/null || true

fix_compose_env_quotes .compose.env

# Real host path for docker compose volume binds (daemon sees host FS, not /host/project)
if [[ -n "${COMPOSE_HOST_DIR:-}" ]]; then
  HOST_COMPOSE_DIR="$COMPOSE_HOST_DIR"
elif [[ -f .hostdir ]]; then
  HOST_COMPOSE_DIR="$(tr -d '\n' < .hostdir)"
elif [[ "$INSTALL_DIR" != "/host/project" ]]; then
  HOST_COMPOSE_DIR="$(pwd -P)"
else
  echo "ERROR: Running inside the container without COMPOSE_HOST_DIR." >&2
  echo "  On Proxmox once:  cd /root/tv-orchestrator && ./update.sh" >&2
  echo "  That writes .hostdir / COMPOSE_HOST_DIR so in-app update works next time." >&2
  exit 1
fi

# Persist host path for future in-app updates (when we run on the real host)
if [[ "$INSTALL_DIR" != "/host/project" ]]; then
  printf '%s\n' "$(pwd -P)" > .hostdir
  ensure_compose_host_dir "$(pwd -P)" .compose.env
  HOST_COMPOSE_DIR="$(pwd -P)"
fi

echo "    Compose dir (host): $HOST_COMPOSE_DIR"

# Do NOT `source .compose.env` — unquoted spaces become shell commands.

echo "==> Rebuilding container…"
"${COMPOSE[@]}" \
  --project-directory "$HOST_COMPOSE_DIR" \
  -f "$HOST_COMPOSE_DIR/docker-compose.yml" \
  --env-file "$HOST_COMPOSE_DIR/.compose.env" \
  up -d --build

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2- || true)"
PORT="${PORT:-3080}"

echo ""
echo "==> Updated."
echo "  UI:   http://${LAN_IP:-localhost}:${PORT}"
echo "  Env:  $(tr '\n' ' ' < .compose.env)"
echo "  Logs: ${COMPOSE[*]} --env-file .compose.env logs -f --tail=80"
echo ""
