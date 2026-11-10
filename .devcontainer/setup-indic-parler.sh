#!/usr/bin/env bash
# Optional: Indic-Parler TTS (Tamil narration). Needs HF_TOKEN with access to ai4bharat/indic-parler-tts.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .indic-parler-venv
.indic-parler-venv/bin/pip install --quiet --upgrade pip
.indic-parler-venv/bin/pip install --quiet --index-url https://download.pytorch.org/whl/cpu torch
.indic-parler-venv/bin/pip install --quiet "transformers==4.46.1" "git+https://github.com/huggingface/parler-tts.git"
echo "✅ Indic-Parler installed - restart the app (bash .devcontainer/start.sh)"
