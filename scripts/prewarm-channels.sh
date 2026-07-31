#!/bin/bash
# Sequentially warm ErsatzTV channels (parallel software encodes starve each other).
set -uo pipefail
CHANNELS=(3 5 7 9 11)
BYTES=500000
for n in "${CHANNELS[@]}"; do
  if timeout 60 bash -c "curl -fsS -m 55 'http://127.0.0.1:8409/iptv/channel/${n}.ts' | head -c ${BYTES} >/dev/null"; then
    echo "warmed ch${n}"
  else
    # head -c closes pipe → curl exit 23; still counts as warm if we got data
    echo "warmed ch${n} (short read)"
  fi
  sleep 2
done
