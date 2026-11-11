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
# India time: "tomorrow" for the daily run and SOCIAL_POST_TIME (midnight go-live) are server local
# time, and Codespaces default to UTC - midnight UTC would be 5:30 AM in India.
export TZ="${TZ:-Asia/Kolkata}"
# LLM provider chain (see ai/claude.ts): Claude, then the fast free cloud fallbacks Gemini / Groq
# (used when their GEMINI_API_KEY / GROQ_API_KEY secrets are set), then - only if installed via
# bash .devcontainer/setup-ollama.sh - the slow local Ollama model. Without Ollama it is left out, so
# a failure is reported as-is instead of as "Could not reach Ollama at localhost:11434".
# Override via LLM_PROVIDER / OLLAMA_MODEL secrets.
if command -v ollama >/dev/null; then
  if ! curl -s -o /dev/null localhost:11434; then
    OLLAMA_KEEP_ALIVE=30m nohup setsid ollama serve >> "$PWD/.cache/ollama.log" 2>&1 < /dev/null &
    for i in $(seq 1 20); do curl -s -o /dev/null localhost:11434 && break; sleep 1; done
  fi
  export LLM_PROVIDER="${LLM_PROVIDER:-auto}"
  export OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:4b}"
  # Ollama on CPU handles one request at a time; a generation run sends several at once, so a queued
  # request can wait behind others well past the app's default 10-minute limit.
  export OLLAMA_TIMEOUT_MS="${OLLAMA_TIMEOUT_MS:-1800000}"
  # A local vision call takes minutes on this CPU; vision callers have their own fallbacks.
  export OLLAMA_VISION="${OLLAMA_VISION:-off}"
else
  export LLM_PROVIDER="${LLM_PROVIDER:-anthropic,gemini,groq}"
fi
# Narration voices: on this CPU-only machine the local engines are far too slow (Tamil Indic-Parler
# takes 20-30+ min per meditation), so use the fast Edge neural voices (seconds per clip), falling back
# to the local voices only if Edge fails. Set a TTS_ENGINE=local secret to use the local voices.
export TTS_ENGINE="${TTS_ENGINE:-edge}"
if [ "$TTS_ENGINE" = "edge" ] && [ ! -x .edge-tts-venv/bin/edge-tts ]; then
  { python3 -m venv .edge-tts-venv && .edge-tts-venv/bin/pip install --quiet "edge-tts==7.3.1"; } >> "$LOG" 2>&1
fi
# Keep the Tamil TTS model loaded for 30 idle minutes (= the codespace idle timeout), not the default 10.
export INDIC_PARLER_WORKER_IDLE_MIN="${INDIC_PARLER_WORKER_IDLE_MIN:-30}"
# Double-detach (nohup + setsid + &) so Codespaces doesn't reap the server when this lifecycle command exits.
nohup setsid bash -c "echo \"[\$(date -u +%FT%TZ)] starting\" >> '$LOG'; exec npm run dev >> '$LOG' 2>&1" < /dev/null > /dev/null 2>&1 &
sleep 3
echo "DailyVerse starting on port 3000 - logs: tail -f $LOG"

# Tamil (Indic-Parler) model load takes minutes on this CPU-only machine, and a first request that
# includes it outlasts GitHub port forwarding. So pre-load it in the background once the server is up
# (INDIC_PARLER_WORKER_IDLE_MIN above keeps it loaded as long as the codespace itself stays up.)
# Skipped with Edge voices: Tamil then only uses Indic-Parler as a fallback, and keeping its ~4.5 GB
# model loaded would just take memory and CPU from everything else.
if [ "$TTS_ENGINE" != "edge" ] && [ -x .indic-parler-venv/bin/python3 ]; then
  nohup setsid bash -c '
    for i in $(seq 1 60); do curl -s -o /dev/null localhost:3000/api/youtube/status && break; sleep 2; done
    echo "[$(date -u +%FT%TZ)] warming up Tamil TTS" >> "'"$LOG"'"
    curl -s -o /dev/null -m 900 -X POST -H "Content-Type: application/json" \
      -d "{\"text\":\"கர்த்தர் நல்லவர்.\",\"reference\":\"warmup\"}" localhost:3000/api/verse-audio
  ' < /dev/null > /dev/null 2>&1 &
  sleep 3  # give the detached warm-up time to leave this session before the lifecycle command exits
fi
