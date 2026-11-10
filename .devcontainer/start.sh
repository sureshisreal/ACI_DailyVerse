#!/usr/bin/env bash
# Start the DailyVerse server in the background if it isn't already running.
# Logs: .cache/dailyverse.log   Force restart: bash .devcontainer/start.sh --restart
cd "$(dirname "$0")/.." || exit 1
LOG="$PWD/.cache/dailyverse.log"; mkdir -p "$(dirname "$LOG")"
if [ "$1" = "--restart" ]; then pkill -f "tsx server.ts" 2>/dev/null || true; sleep 1; fi
if pgrep -f "tsx server.ts" >/dev/null; then
  echo "DailyVerse already running on port 3000 - logs: tail -f $LOG"
  exit 0
fi
[ -d node_modules ] || bash .devcontainer/setup.sh >> "$LOG" 2>&1
# Double-detach (nohup + setsid + &) so Codespaces doesn't reap the server when this lifecycle command exits.
nohup setsid bash -c "echo \"[\$(date -u +%FT%TZ)] starting\" >> '$LOG'; exec npm run dev >> '$LOG' 2>&1" < /dev/null > /dev/null 2>&1 &
sleep 3
echo "DailyVerse starting on port 3000 - logs: tail -f $LOG"
