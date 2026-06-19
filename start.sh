#!/usr/bin/env bash
set -e

echo "Starting Layer 4 sidecar (background)..."
python3 scripts/layer4_server.py &
SIDECAR_PID=$!

# Wait for sidecar health before starting Next.js (max 60s)
echo "Waiting for sidecar health..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
    echo "Sidecar healthy after ${i}x2s."
    break
  fi
  sleep 2
done

echo "Starting Next.js on port ${PORT:-3000}..."
exec npm run start -- -p "${PORT:-3000}"

# If Next.js exits, also kill the sidecar (container should fully stop)
trap "kill $SIDECAR_PID" EXIT
