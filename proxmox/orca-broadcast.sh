#!/usr/bin/env bash
# Proxmox VE Helper-style installer for Orca Broadcast (+ ErsatzTV)
#
# Run in the Proxmox HOST shell (not inside a CT):
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/main/proxmox/orca-broadcast.sh)"
#
# Creates a Debian LXC, installs Docker, clones Orca, starts compose (Orca + ErsatzTV).
# Optional env overrides before running:
#   CTID=128  HN=orca  CORE_COUNT=2  RAM_SIZE=4096  DISK_SIZE=32  BRIDGE=vmbr0
#   CHANNELS_STAGING_HOST=/mnt/plex/rip/channels
#   DOWNLOADS_HOST=/mnt/plex/rip/completed
#   TV_LIBRARY_HOST="/mnt/plex/TV Shows"
#   MOVIE_LIBRARY_HOST=/mnt/plex/Movies
#   NZBGET_URL=http://10.0.0.210:6789
#   ADMIN_PASS=...
#   REPO_REF=main

set -euo pipefail

APP="Orca Broadcast"
REPO_URL="${REPO_URL:-https://github.com/BadBraddA1/tv-orchestrator.git}"
REPO_REF="${REPO_REF:-main}"
RAW_BASE="https://raw.githubusercontent.com/BadBraddA1/tv-orchestrator/${REPO_REF}"

# Defaults (community-script style)
CTID="${CTID:-}"
HN="${HN:-orca}"
CORE_COUNT="${CORE_COUNT:-2}"
RAM_SIZE="${RAM_SIZE:-4096}"
SWAP_SIZE="${SWAP_SIZE:-512}"
DISK_SIZE="${DISK_SIZE:-32}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_GATEWAY="${NET_GATEWAY:-}"
NET_IP="${NET_IP:-dhcp}"
OSTEMPLATE="${OSTEMPLATE:-}"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
# pct --features wants commas (config file uses semicolons)
FEATURES="${FEATURES:-nesting=1,keyctl=1}"

YW=$(echo "\033[33m")
BL=$(echo "\033[36m")
GN=$(echo "\033[1;92m")
RD=$(echo "\033[01;31m")
CL=$(echo "\033[m")
BFR="\\r\\033[K"
HOLD="-"
CM="${GN}✓${CL}"
CROSS="${RD}✗${CL}"

msg_info() { echo -ne " ${HOLD} ${YW}${1}...${CL}"; }
msg_ok() { echo -e "${BFR} ${CM} ${GN}${1}${CL}"; }
msg_error() { echo -e "${BFR} ${CROSS} ${RD}${1}${CL}"; }

header() {
  clear
  cat <<"EOF"
   ____                 ____                      __              __
  / __ \_____________ _/ __ )_________  ____ _____/ /____ ______  / /_
 / / / / ___/ ___/ __ `/ __  / ___/ __ \/ __ `/ __  / __ `/ ___/ / __ \
/ /_/ / /  / /__/ /_/ / /_/ / /  / /_/ / /_/ / /_/ / /_/ (__  ) / / / /
\____/_/   \___/\__,_/_____/_/   \____/\__,_/\__,_/\__,_/____(_)_/ /_/

EOF
  echo -e "${BL}Proxmox VE Helper — ${APP}${CL}"
  echo -e "Creates an LXC, installs Docker, runs Orca + ErsatzTV (Plex Live TV).\n"
}

die() { msg_error "$1"; exit 1; }

need_pve() {
  command -v pct >/dev/null 2>&1 || die "Run this on the Proxmox VE host (pct not found)."
  [[ "$(id -u)" -eq 0 ]] || die "Must run as root on the Proxmox host."
}

next_id() {
  pvesh get /cluster/nextid
}

select_storage() {
  local class="$1" # container|template
  local content content_label
  case "$class" in
    container) content=rootdir; content_label=Container ;;
    template) content=vztmpl; content_label=Template ;;
    *) die "bad storage class" ;;
  esac
  local -a menu=()
  while read -r line; do
    local tag free
    tag=$(echo "$line" | awk '{print $1}')
    free=$(echo "$line" | awk '{print $2}')
    [[ -n "$tag" ]] || continue
    menu+=("$tag" "$free" "OFF")
  done < <(pvesm status -content "$content" | awk 'NR>1 {printf "%s %s\n", $1, $6}')
  if [[ ${#menu[@]} -eq 0 ]]; then
    die "No storage with content=$content"
  fi
  # Non-interactive / single choice: prefer local-lvm, else first with most free
  if [[ "${NONINTERACTIVE:-0}" == "1" || ${#menu[@]} -eq 3 ]]; then
    local i
    for ((i=0; i<${#menu[@]}; i+=3)); do
      if [[ "${menu[$i]}" == "local-lvm" ]]; then
        echo "local-lvm"
        return
      fi
    done
    echo "${menu[0]}"
    return
  fi
  whiptail --backtitle "Proxmox VE Helper Scripts" --title "Select $content_label Storage" \
    --radiolist "Storage for $content_label:" 16 70 6 "${menu[@]}" 3>&1 1>&2 2>&3
}

prompt_defaults() {
  if whiptail --backtitle "Proxmox VE Helper Scripts" --title "$APP" \
    --yesno "Create LXC for Orca Broadcast + ErsatzTV?\n\nDefault: ${CORE_COUNT} vCPU · ${RAM_SIZE}MB RAM · ${DISK_SIZE}GB disk · Debian\nHostname: ${HN}" 12 70; then
    MODE=default
  else
    exit 0
  fi

  if whiptail --backtitle "Proxmox VE Helper Scripts" --title "$APP" \
    --yesno "Use advanced settings (CTID, storage, static IP, bind mounts)?" 10 70; then
    MODE=advanced
  fi
}

advanced_prompts() {
  CTID=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "Container ID" 8 60 "$(next_id)" 3>&1 1>&2 2>&3) || exit 1
  HN=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "Hostname" 8 60 "$HN" 3>&1 1>&2 2>&3) || exit 1
  CORE_COUNT=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "CPU cores" 8 60 "$CORE_COUNT" 3>&1 1>&2 2>&3) || exit 1
  RAM_SIZE=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "RAM (MB)" 8 60 "$RAM_SIZE" 3>&1 1>&2 2>&3) || exit 1
  DISK_SIZE=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "Disk (GB)" 8 60 "$DISK_SIZE" 3>&1 1>&2 2>&3) || exit 1
  BRIDGE=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "Bridge" 8 60 "$BRIDGE" 3>&1 1>&2 2>&3) || exit 1
  NET_IP=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "IP (dhcp or cidr e.g. 10.0.0.50/24)" 8 60 "$NET_IP" 3>&1 1>&2 2>&3) || exit 1
  if [[ "$NET_IP" != "dhcp" ]]; then
    NET_GATEWAY=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox "Gateway" 8 60 "${NET_GATEWAY:-10.0.0.1}" 3>&1 1>&2 2>&3) || exit 1
  fi

  CHANNELS_STAGING_HOST=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox \
    "Host path for Live-TV staging (bind-mount into CT)\nExample: /mnt/plex/rip/channels" 10 70 \
    "${CHANNELS_STAGING_HOST:-/mnt/plex/rip/channels}" 3>&1 1>&2 2>&3) || exit 1
  DOWNLOADS_HOST=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox \
    "Host path for NZBGet completed parent\nExample: /mnt/plex/rip/completed" 10 70 \
    "${DOWNLOADS_HOST:-/mnt/plex/rip/completed}" 3>&1 1>&2 2>&3) || exit 1
  TV_LIBRARY_HOST=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox \
    "Host TV library (optional / Seerr)\nExample: /mnt/plex/TV Shows" 10 70 \
    "${TV_LIBRARY_HOST:-/mnt/plex/TV Shows}" 3>&1 1>&2 2>&3) || exit 1
  MOVIE_LIBRARY_HOST=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox \
    "Host Movies library (optional / Seerr)\nExample: /mnt/plex/Movies" 10 70 \
    "${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}" 3>&1 1>&2 2>&3) || exit 1
}

ensure_template() {
  TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(select_storage template)}"
  msg_ok "Template storage: $TEMPLATE_STORAGE"
  msg_info "Refreshing template list"
  pveam update >/dev/null 2>&1 || true
  msg_ok "Template list refreshed"

  if [[ -z "$OSTEMPLATE" ]]; then
    OSTEMPLATE=$(pveam available -section system | grep -E 'debian-12-standard|debian-13-standard' | awk '{print $2}' | tail -1)
  fi
  [[ -n "$OSTEMPLATE" ]] || die "Could not find a Debian standard template"
  if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$OSTEMPLATE"; then
    msg_info "Downloading $OSTEMPLATE"
    pveam download "$TEMPLATE_STORAGE" "$OSTEMPLATE" >/dev/null
    msg_ok "Downloaded template"
  else
    msg_ok "Template present: $OSTEMPLATE"
  fi
}

create_ct() {
  CTID="${CTID:-$(next_id)}"
  STORAGE="${STORAGE:-$(select_storage container)}"
  msg_ok "Using CTID $CTID on storage $STORAGE"

  local net
  if [[ "$NET_IP" == "dhcp" ]]; then
    net="name=eth0,bridge=${BRIDGE},ip=dhcp"
  else
    net="name=eth0,bridge=${BRIDGE},ip=${NET_IP},gw=${NET_GATEWAY}"
  fi

  local unpriv=()
  if [[ "$UNPRIVILEGED" == "1" ]]; then
    unpriv+=(--unprivileged 1)
  fi

  msg_info "Creating LXC ${HN} (${CTID})"
  pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${OSTEMPLATE}" \
    --hostname "$HN" \
    --cores "$CORE_COUNT" \
    --memory "$RAM_SIZE" \
    --swap "$SWAP_SIZE" \
    --rootfs "${STORAGE}:${DISK_SIZE}" \
    --net0 "$net" \
    --features "$FEATURES" \
    --onboot 1 \
    --startup order=5 \
    --password "$(openssl rand -base64 24)" \
    "${unpriv[@]}" \
    >/dev/null
  msg_ok "LXC created"

  # Bind-mount media paths from Proxmox host into the CT (mp0..)
  local mpi=0
  add_mp() {
    local host_path="$1" ct_path="$2"
    [[ -n "$host_path" ]] || return 0
    if [[ ! -d "$host_path" ]]; then
      msg_info "Creating missing host path $host_path"
      mkdir -p "$host_path"
      msg_ok "Created $host_path"
    fi
    pct set "$CTID" -mp${mpi} "${host_path},mp=${ct_path}"
    mpi=$((mpi + 1))
  }

  add_mp "${CHANNELS_STAGING_HOST:-}" /mnt/channels
  add_mp "${DOWNLOADS_HOST:-}" /mnt/downloads
  add_mp "${TV_LIBRARY_HOST:-}" /mnt/tv
  add_mp "${MOVIE_LIBRARY_HOST:-}" /mnt/movies

  msg_info "Starting CT $CTID"
  pct start "$CTID"
  # wait for network
  for _ in $(seq 1 30); do
    if pct exec "$CTID" -- bash -c "ip -4 route | grep -q default" 2>/dev/null; then
      break
    fi
    sleep 2
  done
  msg_ok "CT $CTID started"
}

install_inside() {
  msg_info "Installing Docker + Orca inside CT"
  pct exec "$CTID" -- bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates openssl >/dev/null"

  # Pass through env for install.sh
  local export_env=(
    "REPO_URL=${REPO_URL}"
    "REPO_REF=${REPO_REF}"
    "INSTALL_DIR=/opt/tv-orchestrator"
    "CHANNELS_STAGING_HOST=/mnt/channels"
    "DOWNLOADS_HOST=/mnt/downloads"
    "TV_LIBRARY_HOST=/mnt/tv"
    "MOVIE_LIBRARY_HOST=/mnt/movies"
    "PORT=3080"
  )
  [[ -n "${NZBGET_URL:-}" ]] && export_env+=("NZBGET_URL=${NZBGET_URL}")
  [[ -n "${NZBGET_USER:-}" ]] && export_env+=("NZBGET_USER=${NZBGET_USER}")
  [[ -n "${NZBGET_PASS:-}" ]] && export_env+=("NZBGET_PASS=${NZBGET_PASS}")
  [[ -n "${NZBGEEK_API_KEY:-}" ]] && export_env+=("NZBGEEK_API_KEY=${NZBGEEK_API_KEY}")
  [[ -n "${NZBFINDER_API_KEY:-}" ]] && export_env+=("NZBFINDER_API_KEY=${NZBFINDER_API_KEY}")
  [[ -n "${TMDB_API_KEY:-}" ]] && export_env+=("TMDB_API_KEY=${TMDB_API_KEY}")
  [[ -n "${ADMIN_USER:-}" ]] && export_env+=("ADMIN_USER=${ADMIN_USER}")
  [[ -n "${ADMIN_PASS:-}" ]] && export_env+=("ADMIN_PASS=${ADMIN_PASS}")
  [[ -n "${PLEX_URL:-}" ]] && export_env+=("PLEX_URL=${PLEX_URL}")
  [[ -n "${PLEX_TOKEN:-}" ]] && export_env+=("PLEX_TOKEN=${PLEX_TOKEN}")

  pct exec "$CTID" -- bash -c "$(printf 'export %q; ' "${export_env[@]}") curl -fsSL '${RAW_BASE}/install.sh' | bash"
  msg_ok "Orca + ErsatzTV installed"
}

print_done() {
  local ip
  ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
  [[ -z "$ip" ]] && ip="<ct-ip>"
  echo ""
  echo -e "${GN}Completed successfully!${CL}"
  echo -e "  CTID:       ${BL}${CTID}${CL} (${HN})"
  echo -e "  Orca UI:    ${BL}http://${ip}:3080${CL}"
  echo -e "  ErsatzTV:   ${BL}http://${ip}:8409${CL}"
  echo -e "  Plex tuner: ${BL}http://${ip}:8409${CL}  (Settings → Live TV & DVR)"
  echo ""
  echo -e "  Staging:    host ${CHANNELS_STAGING_HOST:-?} → CT /mnt/channels → Docker /media/channels"
  echo -e "  Next: open Orca → Broadcast → Refresh schedule / fill"
  echo -e "  Update:     pct enter ${CTID} → cd /opt/tv-orchestrator && ./update.sh"
  echo ""
}

# --- main --------------------------------------------------------------------
header
need_pve

# Paste / oneinstall path: secrets + paths already exported → no whiptail
if [[ "${NONINTERACTIVE:-0}" == "1" || ( -n "${CHANNELS_STAGING_HOST:-}" && -n "${NZBGET_URL:-}" && -n "${ADMIN_PASS:-}" ) ]]; then
  NONINTERACTIVE=1
  MODE=env
  CHANNELS_STAGING_HOST="${CHANNELS_STAGING_HOST:-/mnt/plex/rip/channels}"
  DOWNLOADS_HOST="${DOWNLOADS_HOST:-/mnt/plex/rip/completed}"
  TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-/mnt/plex/TV Shows}"
  MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}"
  CTID="${CTID:-$(next_id)}"
  echo -e "${BL}Non-interactive install${CL} — CTID=${CTID} HN=${HN}"
  echo -e "  staging=${CHANNELS_STAGING_HOST}"
  echo -e "  downloads=${DOWNLOADS_HOST}"
else
  command -v whiptail >/dev/null 2>&1 || apt-get install -y whiptail >/dev/null
  prompt_defaults
  [[ "$MODE" == "advanced" ]] && advanced_prompts
  if [[ -z "${CHANNELS_STAGING_HOST:-}" ]]; then
    CHANNELS_STAGING_HOST=$(whiptail --backtitle "Proxmox VE Helper Scripts" --inputbox \
      "Host path for Live-TV staging (required)\nExample: /mnt/plex/rip/channels" 10 70 \
      "/mnt/plex/rip/channels" 3>&1 1>&2 2>&3) || exit 1
  fi
  DOWNLOADS_HOST="${DOWNLOADS_HOST:-/mnt/plex/rip/completed}"
  TV_LIBRARY_HOST="${TV_LIBRARY_HOST:-/mnt/plex/TV Shows}"
  MOVIE_LIBRARY_HOST="${MOVIE_LIBRARY_HOST:-/mnt/plex/Movies}"
fi

ensure_template
create_ct
install_inside
print_done
