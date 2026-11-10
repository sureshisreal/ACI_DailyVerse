"""Minimal Piper TTS CLI replacement.

The vendored piper1-gpl wheel's compiled espeak-ng bridge truncates/mishandles
long absolute paths and silently falls back to a hardcoded CI build path
(/Users/runner/work/piper1-gpl/...), which doesn't exist outside that build
machine. `python3 -m piper` always resolves its espeak_data_dir default via
__file__, which Python reports as a long absolute path here, triggering that
bug. Passing a short path explicitly (relative to this script's cwd) avoids
it, so this replicates just the single-file synthesis path from piper.__main__
with that one override.

Usage: python3 piper_synthesize.py <model_path> <output_wav_path> [length_scale] [sentence_silence] [volume]
Reads input text from stdin. Must be run with cwd = repo root.

length_scale scales the model's own default speaking rate (>1.0 = slower, <1.0 = faster).
Left unset (None) it falls back to whatever the voice's own config file specifies. sentence_silence
inserts that many seconds of silence between sentences - voice.synthesize() yields one audio chunk
per sentence, so this is just silence spliced between chunks (Piper has no native pause control).
volume scales output loudness (1.0 = unchanged). See synthesizeWithPiper in server.ts for the
devotional values actually used at runtime.
"""

import sys
import wave

from piper import PiperVoice, SynthesisConfig


def main() -> None:
    model_path, output_wav_path = sys.argv[1], sys.argv[2]
    length_scale = float(sys.argv[3]) if len(sys.argv) > 3 else None
    sentence_silence = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    volume = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
    text = sys.stdin.read()

    voice = PiperVoice.load(model_path, espeak_data_dir=".piper-venv/piper")
    syn_config = SynthesisConfig(length_scale=length_scale, volume=volume)

    with wave.open(output_wav_path, "wb") as wav_file:
        wav_params_set = False
        silence_bytes = b""
        for i, audio_chunk in enumerate(voice.synthesize(text, syn_config)):
            if not wav_params_set:
                wav_file.setframerate(audio_chunk.sample_rate)
                wav_file.setsampwidth(audio_chunk.sample_width)
                wav_file.setnchannels(audio_chunk.sample_channels)
                wav_params_set = True
                num_silence_samples = int(sentence_silence * audio_chunk.sample_rate)
                silence_bytes = b"\x00\x00" * (num_silence_samples * audio_chunk.sample_channels)
            if i > 0 and silence_bytes:
                wav_file.writeframes(silence_bytes)
            wav_file.writeframes(audio_chunk.audio_int16_bytes)


if __name__ == "__main__":
    main()
