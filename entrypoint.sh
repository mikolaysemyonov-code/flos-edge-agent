#!/bin/sh
set -eu

if [ -n "${TS_AUTHKEY:-}" ]; then
  echo "[edge-agent] TS_AUTHKEY is set (sidecar mode expected)"
else
  echo "[edge-agent] TS_AUTHKEY is not set (local/sandbox mode)"
fi

exec node /app/reactor-edge-agent.mjs
