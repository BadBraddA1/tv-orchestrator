#!/bin/bash
# Keep ErsatzTV channel transcoder sessions warm for near-instant Plex Live TV tunes.
set -uo pipefail
CHANNELS=(3 5 7 9 11)
BYTES=600000
warm() {
  local n=$1
  if timeout 90 curl -fsS -m 90 --range 0-$((BYTES-1)) \
      "http://127.0.0.1:8409/iptv/channel/${n}.ts" -o /dev/null; then
    echo "warmed ch${n}"
  else
    echo "warm fail ch${n}"
  fi
}
for n in "${CHANNELS[@]}"; do warm "$n" & done
wait
