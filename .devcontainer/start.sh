#!/usr/bin/env bash
# (Re)start the DailyVerse server in the background. Logs: /tmp/dailyverse.log
cd "$(dirname "$0")/.."
pkill -f "tsx server.ts" 2>/dev/null || true
setsid nohup npm run dev > /tmp/dailyverse.log 2>&1 < /dev/null &
echo "DailyVerse starting on port 3000 - logs: tail -f /tmp/dailyverse.log"
