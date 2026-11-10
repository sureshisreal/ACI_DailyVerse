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
# Codespaces secrets aren't in the environment of SSH sessions (e.g. `gh codespace ssh` restarts),
# so load any missing ones from the Codespaces-managed secrets file. Values are read literally (no eval).
SECRETS_FILE=/workspaces/.codespaces/shared/.env
if [ -r "$SECRETS_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    [ -z "${!BASH_REMATCH[1]}" ] && export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  done < "$SECRETS_FILE"
fi
# No Ollama in Codespaces: use Claude only, so a Claude failure (e.g. low credit balance) is reported as-is
# instead of as a misleading "Could not reach Ollama at localhost:11434". Override via a LLM_PROVIDER secret.
export LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"
# Double-detach (nohup + setsid + &) so Codespaces doesn't reap the server when this lifecycle command exits.
nohup setsid bash -c "echo \"[\$(date -u +%FT%TZ)] starting\" >> '$LOG'; exec npm run dev >> '$LOG' 2>&1" < /dev/null > /dev/null 2>&1 &
sleep 3
echo "DailyVerse starting on port 3000 - logs: tail -f $LOG"
