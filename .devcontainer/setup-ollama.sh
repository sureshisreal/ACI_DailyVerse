#!/usr/bin/env bash
# Optional: free local LLM fallback for when Claude is unavailable (e.g. no API credits).
# Installs Ollama + a small Gemma 3 model (image support + Tamil/Telugu) sized for this CPU-only
# codespace. Expect several minutes per long answer (e.g. meditations) and weaker Indic output than Claude.
# After install, .devcontainer/start.sh starts Ollama and switches LLM_PROVIDER to "auto"
# (Claude first, Ollama on billing/auth errors). Model override: OLLAMA_MODEL secret.
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL="${OLLAMA_MODEL:-gemma3:4b}"

if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

# The installer can't start a systemd service here, so run a temporary server for the pull.
if ! curl -s -o /dev/null localhost:11434; then
  nohup setsid ollama serve > /tmp/ollama-setup.log 2>&1 < /dev/null &
  for i in $(seq 1 30); do curl -s -o /dev/null localhost:11434 && break; sleep 1; done
fi
ollama pull "$MODEL"
echo "✅ Ollama + $MODEL installed - restart the app: bash .devcontainer/start.sh --restart"
