#!/usr/bin/env bash
# Start the DailyVerse server in the background if it isn't already running.
# Logs: /tmp/dailyverse.log   Force restart: bash .devcontainer/start.sh --restart
cd "$(dirname "$0")/.."
if [ "$1" = "--restart" ]; then pkill -f "tsx server.ts" 2>/dev/null || true; sleep 1; fi
if pgrep -f "tsx server.ts" >/dev/null; then
  echo "DailyVerse already running on port 3000 - logs: tail -f /tmp/dailyverse.log"
  exit 0
fi
[ -d node_modules ] || { echo "node_modules missing - running setup first"; bash .devcontainer/setup.sh >> /tmp/dailyverse-setup.log 2>&1; }
# setsid -f forks into a new session so Codespaces doesn't reap it when the lifecycle command exits.
setsid -f bash -c 'npm run dev >> /tmp/dailyverse.log 2>&1 < /dev/null'
echo "DailyVerse starting on port 3000 - logs: tail -f /tmp/dailyverse.log"
