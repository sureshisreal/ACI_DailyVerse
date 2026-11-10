#!/usr/bin/env bash
# Optional: Indic-Parler TTS (Tamil narration). Needs HF_TOKEN with access to ai4bharat/indic-parler-tts.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .indic-parler-venv
.indic-parler-venv/bin/pip install --quiet --upgrade pip
# torch and torchaudio must be a matching pair (torchaudio's compiled ops fail to load otherwise), and
# torchaudio's newest CPU build is 2.11.x - so pin both, and re-pin after parler-tts in case it pulls others.
TORCH_PAIR=("torch==2.11.0+cpu" "torchaudio==2.11.0+cpu")
CPU_INDEX=(--index-url https://download.pytorch.org/whl/cpu)
.indic-parler-venv/bin/pip install --quiet "${CPU_INDEX[@]}" "${TORCH_PAIR[@]}"
.indic-parler-venv/bin/pip install --quiet "transformers==4.46.1" "git+https://github.com/huggingface/parler-tts.git"
.indic-parler-venv/bin/pip install --quiet "${CPU_INDEX[@]}" "${TORCH_PAIR[@]}"
echo "✅ Indic-Parler installed - restart the app (bash .devcontainer/start.sh)"
