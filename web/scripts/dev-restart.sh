#!/usr/bin/env bash
# Kills whatever's bound to the dev port (if anything), starts `next dev`
# in the background, and waits for it to actually answer before returning.
set -euo pipefail

PORT="${PORT:-3000}"
LOGFILE="${DEV_LOG:-/tmp/next-dev.log}"

PID="$(lsof -ti:"$PORT" -sTCP:LISTEN || true)"
if [ -n "$PID" ]; then
  kill "$PID" || true
  sleep 1
fi

nohup npm run dev > "$LOGFILE" 2>&1 &
disown

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT" > /dev/null; then
    echo "Dev server up at http://localhost:$PORT (log: $LOGFILE)"
    exit 0
  fi
  sleep 1
done

echo "Dev server did not come up within 30s — check $LOGFILE" >&2
exit 1
