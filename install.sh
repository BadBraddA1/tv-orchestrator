#!/usr/bin/env bash
# One-command install for Proxmox / Debian / Ubuntu (R620).
#
# Usage (on the Proxmox host or a Docker-capable CT/VM):
#   curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/install.sh | bash
#
# Works as root (Proxmox) or as a normal user with sudo.
#
# Optional env overrides:
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
REPO_REF="${REPO_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tv-orchestrator}"
PORT_DEFAULT="${PORT:-3080}"

echo "==> Orca (TV Orchestrator) — Docker install"
echo "    Target: $INSTALL_DIR"
echo "    Ref:    $REPO_REF"
echo "    User:   $(id -un) (uid=$(id -u))"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# Prefer no sudo on Proxmox (root); use sudo only when not root.
run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    echo "ERROR: need root or sudo to run: $*" >&2
    exit 1
  fi
}

# --- packages ----------------------------------------------------------------
if ! need_cmd curl || ! need_cmd git; then
  echo "==> Installing curl/git…"
  run_root apt-get update
  run_root apt-get install -y curl git ca-certificates
fi

# --- Docker ------------------------------------------------------------------
if ! need_cmd docker; then
  echo "==> Installing Docker…"
  # get.docker.com already elevates when needed; as root just pipe to sh
  if [[ "$(id -u)" -eq 0 ]]; then
    curl -fsSL https://get.docker.com | sh
  else
    curl -fsSL https://get.docker.com | run_root sh
  fi
  if need_cmd systemctl; then
    run_root systemctl enable --now docker || true
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    run_root usermod -aG docker "$USER" || true
    echo "    Note: log out/in may be needed for docker group."
  fi
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    echo "ERROR: docker installed but daemon not responding" >&2
    exit 1
  fi
  DOCKER=(sudo docker)
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
elif need_cmd docker-compose && docker-compose version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
elif need_cmd docker-compose; then
  COMPOSE=(sudo docker-compose)
else
  echo "==> Installing Docker Compose plugin…"
  run_root apt-get update
  run_root apt-get install -y docker-compose-plugin || true
  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
  else
    echo "ERROR: docker compose not available" >&2
    exit 1
  fi
fi

# --- clone / update ----------------------------------------------------------
checkout_ref() {
  local dir="$1"
  git -C "$dir" fetch --tags --force origin 2>/dev/null || git -C "$dir" fetch --force origin || true
  if git -C "$dir" rev-parse "refs/tags/${REPO_REF}" >/dev/null 2>&1; then
    git -C "$dir" checkout -f "tags/${REPO_REF}"
  elif git -C "$dir" rev-parse "origin/${REPO_REF}" >/dev/null 2>&1; then
    git -C "$dir" checkout -B "${REPO_REF}" "origin/${REPO_REF}"
  else
    git -C "$dir" pull --ff-only || true
  fi
}

if [[ -f "$INSTALL_DIR/package.json" ]]; then
  echo "==> Updating existing checkout…"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    checkout_ref "$INSTALL_DIR"
  fi
else
  echo "==> Cloning repo (${REPO_REF})…"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null \
    || git clone "$REPO_URL" "$INSTALL_DIR"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    checkout_ref "$INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR"
chmod +x install.sh update.sh 2>/dev/null || true

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
[[ -n "${TMDB_API_KEY:-}" ]] && set_env TMDB_API_KEY "$TMDB_API_KEY"
[[ -n "${TAUTULLI_URL:-}" ]] && set_env TAUTULLI_URL "$TAUTULLI_URL"
[[ -n "${TAUTULLI_API_KEY:-}" ]] && set_env TAUTULLI_API_KEY "$TAUTULLI_API_KEY"
[[ -n "${SESSION_SECRET:-}" ]] && set_env SESSION_SECRET "$SESSION_SECRET"

if grep -q '^SESSION_SECRET=change-this-to-a-long-random-string$' .env; then
  set_env SESSION_SECRET "$(head -c 48 /dev/urandom | base64 | tr -d '\n+/=' | head -c 48)"
fi

TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-$INSTALL_DIR/media/tv}"
MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST:-$INSTALL_DIR/media/movies}"
DOWNLOADS_HOST="${DOWNLOADS_HOST:-$INSTALL_DIR/media/downloads}"
mkdir -p "$TV_LIBRARY_HOST" "$MOVIE_LIBRARY_HOST" "$DOWNLOADS_HOST" "$INSTALL_DIR/data"

cat > .compose.env <<EOF
TV_LIBRARY_HOST="${TV_LIBRARY_HOST}"
MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST}"
DOWNLOADS_HOST="${DOWNLOADS_HOST}"
COMPOSE_HOST_DIR=${INSTALL_DIR}
EOF
printf '%s\n' "$INSTALL_DIR" > .hostdir

echo "==> Building and starting container…"
export TV_LIBRARY_HOST MOVIE_LIBRARY_HOST DOWNLOADS_HOST
"${COMPOSE[@]}" --env-file .compose.env up -d --build

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[[ -z "$LAN_IP" ]] && LAN_IP="YOUR-HOST-IP"

echo ""
echo "==> Orca install complete."
echo ""
echo "  UI:        http://${LAN_IP}:${PORT_DEFAULT}"
echo "  Dir:       ${INSTALL_DIR}"
echo "  Ref:       ${REPO_REF}"
echo "  Library:   ${TV_LIBRARY_HOST}  →  /media/tv"
echo "  Movies:    ${MOVIE_LIBRARY_HOST}  →  /media/movies"
echo "  Downloads: ${DOWNLOADS_HOST}  →  /media/downloads"
echo ""
echo "  Login:     create admin in first-run setup (or ADMIN_USER / ADMIN_PASS in .env)"
echo "  Logs:      cd ${INSTALL_DIR} && ${COMPOSE[*]} --env-file .compose.env logs -f"
echo ""
echo "Fleet notes: docs/DEPLOY.md — pin REPO_REF=vX.Y.Z for mass rollouts"
echo ""
