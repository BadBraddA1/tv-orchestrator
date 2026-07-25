#!/bin/bash
# Bind-mount existing TV show folders into /mnt/channels/library/* so ErsatzTV
# (which already mounts /media/channels) can play them without re-downloading.
set -euo pipefail
BASE=/mnt/channels/library
mkdir -p "$BASE"

bind() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  if mountpoint -q "$dest"; then
    echo "already mounted $dest"
    return 0
  fi
  if [[ ! -d "$src" ]]; then
    echo "MISSING $src"
    return 1
  fi
  mount --bind "$src" "$dest"
  echo "bound $src -> $dest"
}

bind "/mnt/tv/Bluey (2018)" "$BASE/toon-box"
bind "/mnt/tv/KN" "$BASE/kitchen-heat"
bind "/mnt/tv/motorway cops catching britains speeders" "$BASE/cops-motorway"
bind "/mnt/tv/Rookie Cops 2022" "$BASE/cops-rookie"
bind "/mnt/tv/Come Fly with Me (2010)" "$BASE/comedy"

# Persist across reboot via fstab inside CT (optional)
FSTAB=/etc/fstab
ensure_fstab() {
  local src="$1" dest="$2"
  grep -qF "$dest" "$FSTAB" 2>/dev/null && return 0
  echo "$src $dest none bind,nofail 0 0" >> "$FSTAB"
  echo "fstab + $dest"
}
ensure_fstab "/mnt/tv/Bluey (2018)" "$BASE/toon-box"
ensure_fstab "/mnt/tv/KN" "$BASE/kitchen-heat"
ensure_fstab "/mnt/tv/motorway cops catching britains speeders" "$BASE/cops-motorway"
ensure_fstab "/mnt/tv/Rookie Cops 2022" "$BASE/cops-rookie"
ensure_fstab "/mnt/tv/Come Fly with Me (2010)" "$BASE/comedy"

ls -la "$BASE"
find "$BASE/toon-box" -name "*.mkv" | head -5
echo "mkv count toon-box: $(find "$BASE/toon-box" -name "*.mkv" | wc -l)"
echo "avi/mkv kitchen: $(find "$BASE/kitchen-heat" \( -name "*.mkv" -o -name "*.avi" -o -name "*.mp4" \) | wc -l)"
