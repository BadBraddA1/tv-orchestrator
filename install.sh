#!/usr/bin/env bash
# One-command install for Proxmox / Debian / Ubuntu (R620).
#
# Usage (on the Proxmox host or a Docker-capable CT/VM):
#   curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh | bash
#
# Or from a clone:
#   ./install.sh
#
# Optional env overrides before/with the pipe:
#   INSTALL_DIR=/opt/tv-orchestrator
#   TV_LIBRARY_HOST=/mnt/plex/tv
#   DOWNLOADS_HOST=/mnt/nzbget/completed
#   NZBGET_URL=http://127.0.0.1:6789
#   NZBGEEK_API_KEY=...
#   NZBFINDER_API_KEY=...
#   ADMIN_USER=brad
#   ADMIN_PASS=secret
#   PLEX_URL=http://127.0.0.1:32400
#   PLEX_TOKEN=...
#   PORT=3080

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/BadBraddA1/tv-orchestrator.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tv-orchestrator}"
PORT_DEFAULT="${PORT:-3080}"

echo "==> TV Orchestrator — Proxmox / Docker install"
echo "    Target: $INSTALL_DIR"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# --- packages ----------------------------------------------------------------
if ! need_cmd curl || ! need_cmd git; then
  echo "==> Installing curl/git…"
  sudo apt-get update
  sudo apt-get install -y curl git ca-certificates
fi

# --- Docker ------------------------------------------------------------------
if ! need_cmd docker; then
  echo "==> Installing Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable --now docker || true
  fi
  # Allow current user to run docker without sudo when possible
  if id -nG "$USER" 2>/dev/null | grep -qw docker; then
    true
  else
    sudo usermod -aG docker "$USER" || true
    echo "    Note: you may need to log out/in (or use sudo) for docker group."
  fi
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

if ${DOCKER[@]} compose version >/dev/null 2>&1; then
  COMPOSE=(${DOCKER[@]} compose)
elif need_cmd docker-compose; then
  COMPOSE=(docker-compose)
  if ! docker-compose version >/dev/null 2>&1; then
    COMPOSE=(sudo docker-compose)
  fi
else
  echo "==> Installing Docker Compose plugin…"
  sudo apt-get update
  sudo apt-get install -y docker-compose-plugin || true
  if ${DOCKER[@]} compose version >/dev/null 2>&1; then
    COMPOSE=(${DOCKER[@]} compose)
  else
    echo "ERROR: docker compose not available" >&2
    exit 1
  fi
fi

# --- clone / update ----------------------------------------------------------
if [[ -f "$INSTALL_DIR/package.json" ]]; then
  echo "==> Updating existing checkout…"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" pull --ff-only || true
  fi
else
  echo "==> Cloning repo…"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x install.sh 2>/dev/null || true

# --- .env --------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "==> Creating .env from example…"
  cp .env.example .env
fi

set_env() {
  local key="$1"
  local value="$2"
  [[ -z "$value" ]] && return 0
  if grep -q "^${key}=" .env; then
    # Escape sed specials in value lightly
    local esc
    esc=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${esc}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

set_env PORT "$PORT_DEFAULT"
[[ -n "${ADMIN_USER:-}" ]] && set_env ADMIN_USER "$ADMIN_USER"
[[ -n "${ADMIN_PASS:-}" ]] && set_env ADMIN_PASS "$ADMIN_PASS"
[[ -n "${NZBGET_URL:-}" ]] && set_env NZBGET_URL "$NZBGET_URL"
[[ -n "${NZBGET_USER:-}" ]] && set_env NZBGET_USER "$NZBGET_USER"
[[ -n "${NZBGET_PASS:-}" ]] && set_env NZBGET_PASS "$NZBGET_PASS"
[[ -n "${NZBGEEK_API_KEY:-}" ]] && set_env NZBGEEK_API_KEY "$NZBGEEK_API_KEY"
[[ -n "${NZBGEEK_URL:-}" ]] && set_env NZBGEEK_URL "$NZBGEEK_URL"
[[ -n "${NZBFINDER_API_KEY:-}" ]] && set_env NZBFINDER_API_KEY "$NZBFINDER_API_KEY"
[[ -n "${NZBFINDER_URL:-}" ]] && set_env NZBFINDER_URL "$NZBFINDER_URL"
[[ -n "${PLEX_URL:-}" ]] && set_env PLEX_URL "$PLEX_URL"
[[ -n "${PLEX_TOKEN:-}" ]] && set_env PLEX_TOKEN "$PLEX_TOKEN"
[[ -n "${PUSHOVER_USER_KEY:-}" ]] && set_env PUSHOVER_USER_KEY "$PUSHOVER_USER_KEY"
[[ -n "${PUSHOVER_APP_TOKEN:-}" ]] && set_env PUSHOVER_APP_TOKEN "$PUSHOVER_APP_TOKEN"
[[ -n "${NTFY_TOPIC:-}" ]] && set_env NTFY_TOPIC "$NTFY_TOPIC"
[[ -n "${SESSION_SECRET:-}" ]] && set_env SESSION_SECRET "$SESSION_SECRET"

# Random session secret if still default
if grep -q '^SESSION_SECRET=change-this-to-a-long-random-string$' .env; then
  set_env SESSION_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '\n+/=' | head -c 48)"
fi

# Host mount paths for compose
TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-$INSTALL_DIR/media/tv}"
DOWNLOADS_HOST="${DOWNLOADS_HOST:-$INSTALL_DIR/media/downloads}"
mkdir -p "$TV_LIBRARY_HOST" "$DOWNLOADS_HOST" "$INSTALL_DIR/data"

# Persist compose host paths next to project for restarts
cat > .compose.env <<EOF
TV_LIBRARY_HOST=${TV_LIBRARY_HOST}
DOWNLOADS_HOST=${DOWNLOADS_HOST}
EOF

# --- build & run -------------------------------------------------------------
echo "==> Building and starting container…"
export TV_LIBRARY_HOST DOWNLOADS_HOST
${COMPOSE[@]} --env-file .compose.env up -d --build

# Detect LAN IP for hint
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[[ -z "$LAN_IP" ]] && LAN_IP="YOUR-R620-IP"

echo ""
echo "==> Install complete."
echo ""
echo "  UI:      http://${LAN_IP}:${PORT_DEFAULT}"
echo "  Dir:     ${INSTALL_DIR}"
echo "  Library: ${TV_LIBRARY_HOST}  →  /media/tv"
echo "  Downloads: ${DOWNLOADS_HOST}  →  /media/downloads"
echo ""
echo "  Login:   ADMIN_USER / ADMIN_PASS from ${INSTALL_DIR}/.env"
echo "  Logs:    ${COMPOSE[*]} -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo ""
echo "Next: edit ${INSTALL_DIR}/.env with NZBGet + indexer keys, then:"
echo "  cd ${INSTALL_DIR} && ${COMPOSE[*]} --env-file .compose.env up -d"
echo ""
