#!/usr/bin/env bash
# One-time Codespaces setup: Node deps + Piper (English/Telugu narration).
# Indic-Parler TTS is heavy (~1.3 GB + multi-GB model) - install on demand with:
#   bash .devcontainer/setup-indic-parler.sh
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci || npm install

if [ ! -x .piper-venv/bin/python3 ]; then
  python3 -m venv .piper-venv
  .piper-venv/bin/pip install --quiet --upgrade pip
  .piper-venv/bin/pip install --quiet "piper-tts==1.7.0"
fi

mkdir -p .piper-voices
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main
fetch() { [ -s ".piper-voices/$2" ] || curl -fsSL "$BASE/$1/$2" -o ".piper-voices/$2"; }
for f in en_GB-cori-high.onnx en_GB-cori-high.onnx.json; do fetch en/en_GB/cori/high "$f"; done
for f in te_IN-padmavathi-medium.onnx te_IN-padmavathi-medium.onnx.json; do fetch te/te_IN/padmavathi/medium "$f"; done

echo "✅ DailyVerse setup complete"
