#!/usr/bin/env bash
# Brad's homelab one-install — run as root on the Proxmox VE host.
#
# Includes: Orca Broadcast LXC (Orca UI + ErsatzTV for Plex Live TV).
#
# On this Mac (prep / copy to clipboard):
#   ~/bin/oneinstall          # prints instructions + copies Proxmox paste script
#
# On Proxmox host (after node is up):
#   curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/oneinstall.sh | bash
#   # or copy ~/.config/orca-broadcast/run-on-proxmox.sh onto the host and bash it
#
# Secrets live in /root/orca-broadcast.env on Proxmox (or ~/.config/orca-broadcast/install.env on Mac).

set -euo pipefail

APP="Orca Broadcast oneinstall"
RAW_HELPER="https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh"

YW="\033[33m"; GN="\033[1;92m"; BL="\033[36m"; RD="\033[01;31m"; CL="\033[m"

is_proxmox() { command -v pct >/dev/null 2>&1 && [[ -d /etc/pve ]]; }

load_env() {
  local candidates=(
    "${ORCA_ENV:-}"
    "/root/orca-broadcast.env"
    "$HOME/.config/orca-broadcast/install.env"
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/orca-broadcast.env"
  )
  local f
  for f in "${candidates[@]}"; do
    [[ -n "$f" && -f "$f" ]] || continue
    # shellcheck disable=SC1090
    set -a
    # strip comments / blank
    # shellcheck disable=SC1091
    source <(grep -v '^\s*#' "$f" | grep -v '^\s*$' || true)
    set +a
    echo -e "${GN}✓${CL} Loaded env from $f"
    return 0
  done
  return 1
}

defaults_if_missing() {
  export CHANNELS_STAGING_HOST="${CHANNELS_STAGING_HOST:-/mnt/plex/rip/channels}"
  export DOWNLOADS_HOST="${DOWNLOADS_HOST:-/mnt/plex/rip/completed}"
  export TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-/mnt/plex/TV Shows}"
  export MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}"
  export NZBGET_URL="${NZBGET_URL:-http://10.0.0.210:6789}"
  export NZBGET_USER="${NZBGET_USER:-nzbget}"
  export PLEX_URL="${PLEX_URL:-http://10.0.0.235:32400}"
  export ADMIN_USER="${ADMIN_USER:-brad}"
  export HN="${HN:-orca}"
  export CORE_COUNT="${CORE_COUNT:-2}"
  export RAM_SIZE="${RAM_SIZE:-4096}"
  export DISK_SIZE="${DISK_SIZE:-32}"
}

need_secrets() {
  local missing=0
  for k in NZBGET_PASS NZBGEEK_API_KEY NZBFINDER_API_KEY TMDB_API_KEY ADMIN_PASS; do
    if [[ -z "${!k:-}" ]]; then
      echo -e "${RD}✗${CL} Missing $k — put it in /root/orca-broadcast.env"
      missing=1
    fi
  done
  return "$missing"
}

mac_prep() {
  local conf="$HOME/.config/orca-broadcast"
  mkdir -p "$conf"
  if [[ ! -f "$conf/install.env" ]]; then
    echo -e "${RD}No $conf/install.env — create it first.${CL}"
    exit 1
  fi
  # Refresh paste script from install.env
  python3 - <<'PY'
from pathlib import Path
env = {}
for line in Path.home().joinpath(".config/orca-broadcast/install.env").read_text().splitlines():
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip()
keys = [
    "CHANNELS_STAGING_HOST", "DOWNLOADS_HOST", "TV_LIBRARY_HOST", "MOVIE_LIBRARY_HOST",
    "NZBGET_URL", "NZBGET_USER", "NZBGET_PASS", "NZBGEEK_API_KEY", "NZBFINDER_API_KEY",
    "TMDB_API_KEY", "ADMIN_USER", "ADMIN_PASS", "PLEX_URL",
]
lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Brad oneinstall — paste into Proxmox host shell as root",
    "# Installs Orca Broadcast LXC (Orca :3080 + ErsatzTV :8409)",
    "",
]
for k in keys:
    v = env.get(k, "").replace("'", "'\\''")
    lines.append(f"export {k}='{v}'")
lines += [
    "",
    "export NONINTERACTIVE='1'",
    "",
    'bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"',
    "",
]
out = Path.home() / ".config/orca-broadcast/run-on-proxmox.sh"
out.write_text("\n".join(lines))
out.chmod(0o700)
print(out)
PY
  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "$conf/run-on-proxmox.sh"
    echo -e "${GN}✓${CL} Copied Proxmox oneinstall to clipboard."
  fi
  echo ""
  echo -e "${BL}${APP}${CL} — Proxmox not set up yet? When the node is ready:"
  echo "  1. Open Proxmox → Shell (root)"
  echo "  2. Paste (Cmd+V) and Enter"
  echo "  3. Or: scp ~/.config/orca-broadcast/run-on-proxmox.sh root@PROXMOX:/root/ && ssh root@PROXMOX bash /root/run-on-proxmox.sh"
  echo ""
  echo "  Script: $conf/run-on-proxmox.sh"
  if [[ -f "$conf/install.env" ]]; then
    # show admin login only
    grep -E '^(ADMIN_USER|ADMIN_PASS)=' "$conf/install.env" || true
  fi
  echo ""
  echo "  After install: Orca http://<ct-ip>:3080  ·  ErsatzTV http://<ct-ip>:8409"
  echo "  Plex → Live TV & DVR → tuner http://<ct-ip>:8409"
}

proxmox_run() {
  echo -e "${BL}${APP}${CL} on Proxmox host"
  if ! load_env; then
    echo -e "${YW}No env file found.${CL} Create /root/orca-broadcast.env with NZBGET_*/keys/ADMIN_PASS"
    exit 1
  fi
  defaults_if_missing
  need_secrets || exit 1
  [[ "$(id -u)" -eq 0 ]] || { echo "Run as root"; exit 1; }
  bash -c "$(curl -fsSL "$RAW_HELPER")"
}

main() {
  if is_proxmox; then
    proxmox_run
  else
    mac_prep
  fi
}

main "$@"
