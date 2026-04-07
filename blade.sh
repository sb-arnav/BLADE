#!/bin/bash
# Start Blade — backend + Tauri dev

echo "Starting Blade backend..."
cd "$(dirname "${BASH_SOURCE[0]}")"
backend/start.sh &
BACKEND_PID=$!

echo "Waiting for backend..."
until curl -s http://localhost:7731/health > /dev/null; do sleep 0.5; done
echo "Backend ready."

echo "Starting Blade app..."
npm run tauri dev

kill $BACKEND_PID
