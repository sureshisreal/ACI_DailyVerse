"""Tamil narration via AI4Bharat's Indic Parler-TTS (ai4bharat/indic-parler-tts).

Upgrade path from the now-removed mms_tts_synthesize.py: MMS-TTS's facebook/mms-tts-tam checkpoint
was natively 16kHz and purely parametric (no control over delivery). Indic Parler-TTS is natively
~44kHz and, unlike Piper/MMS-TTS, is instruction-following - the "description" argument is a natural-language
prompt (speaker name + delivery style) that actually shapes the voice and pace, the same lever the
old Gemini TTS prompts used to give us. See synthesizeWithIndicParler in server.ts for the
devotional description actually used at runtime.

Parler-TTS is autoregressive (it generates audio token-by-token conditioned on what it's already
generated, like an LLM), so - unlike VITS-based MMS-TTS, which always produces exactly the audio
its parametric duration predictor computes in one deterministic pass - a long prompt can push it
into a degenerate repetition loop: it gets partway through the verse, then gets stuck re-generating
the same word or syllable over and over instead of continuing, and the real remainder of the verse
never gets spoken at all. Verified directly against this codebase's own Bible text: a 16-word verse
came out complete and natural, but a 36-word verse (Esther 8:9) degenerated after ~6 words into
"முன்னும் முன்னும் முன்னும் ..." and never reached the back half of the sentence. The fix is the
same one mms_tts_synthesize.py already uses for its own, unrelated reason (no native pause control):
split the text into pieces and synthesize each separately. Splitting first on sentence-ending
punctuation preserves natural one-pass prosody for anything short enough to be safe as-is (the
common case for a single Bible verse); only a piece that's still long after that gets force-split on
clause punctuation, which is what actually keeps each individual generate() call short enough to
stay reliable. (Tried adding no_repeat_ngram_size as a second layer of defense - made things worse:
it bans repeated token n-grams in the raw audio-codec token stream, where local repetition is often
exactly what a sustained sound or natural pause legitimately looks like, so it fights the model into
producing more garbled near-repeats instead of fewer. Chunk length alone is the fix.)

Usage: python3 indic_parler_synthesize.py <output_wav_path> <model_id> <description> [chunk_silence]
Reads input text from stdin.

Worker mode: python3 indic_parler_synthesize.py --worker <model_id> <description> [chunk_silence]
Loads the model ONCE, prints {"ready": true} on stdout, then handles one JSON request per stdin line
({"id": ..., "text": ..., "out": <wav path>}) and answers each with one JSON line
({"id": ..., "ok": true} or {"id": ..., "ok": false, "error": ...}). Exits on stdin EOF. Loading the
~3.6GB checkpoint was a fixed cost paid on every single narration in one-shot mode - several per
Meditation Video, all queued one at a time - so server.ts keeps one of these alive instead (see
IndicParlerWorker there). stdout carries only these protocol lines; anything a library prints goes
to stderr.
"""

import json

import re
import sys
import wave

import numpy as np
import torch
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer

# Empirical safe ceiling - see the module docstring's Esther 8:9 test. Comfortably above the length
# of a typical single Bible verse, so most verses stay a single natural generate() call and only
# genuinely long ones get split.
MAX_CHUNK_WORDS = 18

# Per-chunk degenerate-repetition retry. A chunk this short (<=18 words) should never legitimately
# need anywhere near the model's own hard per-call ceiling - checked directly against this install:
# model.generation_config.max_length is 2610 codec frames, which at this model's 44.1kHz sampling
# rate and 512 hop_length works out to ~30.3s of audio. Parler-TTS is autoregressive and stops early
# via its eos token on a normal completion; the "stuck repeating the same word/syllable" degenerate
# failure mode (see module docstring) instead runs the generation all the way out to that ceiling
# producing garbage, rather than a short chunk finishing in the ~2-9s a real 18-word-or-fewer phrase
# actually takes. That gap between "normal" and "hit the ceiling" is large enough that a plain
# duration check catches it without needing any transcription/ASR - and unlike the whole-narration
# Whisper-based QA in server.ts, this retries only the one bad chunk (cheap) instead of every chunk
# in the narration (which is what made longer multi-chunk texts, e.g. a 200+ word meditation
# reflection, fail so much more often than a short verse: more chunks means a much higher chance at
# least one of them degenerates, and the old whole-text retry re-paid the cost of every already-good
# chunk alongside the bad one every time).
CHUNK_DEGENERATE_MAX_ATTEMPTS = 3
CHUNK_DEGENERATE_SECONDS_PER_WORD = 1.0  # generous upper bound - normal devotional pace is well under 0.5s/word
CHUNK_DEGENERATE_MIN_SECONDS = 4.0  # floor so a 1-2 word chunk isn't flagged just from fixed per-call overhead


def split_into_chunks(text: str) -> list[str]:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if not sentences:
        return [text]

    chunks = []
    for sentence in sentences:
        if len(sentence.split()) <= MAX_CHUNK_WORDS:
            chunks.append(sentence)
            continue
        # Too long to risk in one generate() call - fall back to clause punctuation (the same
        # boundaries posterRenderer.ts's splitIntoClauses uses on the frontend).
        parts = [p.strip() for p in re.split(r"(?<=[,;:।])\s+", sentence) if p.strip()]
        buf: list[str] = []
        for part in parts:
            part_words = part.split()
            if buf and len(buf) + len(part_words) > MAX_CHUNK_WORDS:
                chunks.append(" ".join(buf))
                buf = part_words
            else:
                buf.extend(part_words)
        if buf:
            chunks.append(" ".join(buf))
    return chunks


def load_synthesizer(model_id: str, description: str, chunk_silence: float):
    """Loads the model once and returns synthesize(text, output_wav_path)."""
    # Re-verified directly (2026-08-27, torch 2.13): MPS now finishes a short phrase's generate()
    # in ~8s and a near-MAX_CHUNK_WORDS (18-word) chunk in ~30s, vs. CPU not finishing even the
    # short phrase within 5 minutes. This reverses an earlier decision recorded here that MPS hung
    # for 5+ minutes on even a single short verse - whatever caused that no longer reproduces on
    # this torch/transformers version, and CPU-only generation is what was actually behind Tamil
    # meditation/verse audio taking tens of minutes (or timing out) end to end.
    device = "cuda:0" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(device)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    description_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)

    description_inputs = description_tokenizer(description, return_tensors="pt").to(device)

    sample_rate = model.config.sampling_rate
    silence = np.zeros(int(chunk_silence * sample_rate), dtype=np.float32)

    def generate_chunk(chunk_text: str) -> np.ndarray:
        prompt_inputs = tokenizer(chunk_text, return_tensors="pt").to(device)
        word_count = max(1, len(chunk_text.split()))
        max_reasonable_seconds = max(CHUNK_DEGENERATE_MIN_SECONDS, word_count * CHUNK_DEGENERATE_SECONDS_PER_WORD)

        best_audio = None
        for attempt in range(1, CHUNK_DEGENERATE_MAX_ATTEMPTS + 1):
            with torch.no_grad():
                generation = model.generate(
                    input_ids=description_inputs.input_ids,
                    attention_mask=description_inputs.attention_mask,
                    prompt_input_ids=prompt_inputs.input_ids,
                    prompt_attention_mask=prompt_inputs.attention_mask,
                )
            audio = generation.cpu().numpy().squeeze()
            best_audio = audio
            duration = audio.shape[-1] / sample_rate
            if duration <= max_reasonable_seconds:
                return audio
            print(
                f"Chunk looked degenerate ({duration:.1f}s for {word_count} words, "
                f"attempt {attempt}/{CHUNK_DEGENERATE_MAX_ATTEMPTS}), "
                f"{'retrying' if attempt < CHUNK_DEGENERATE_MAX_ATTEMPTS else 'accepting best available'}.",
                file=sys.stderr,
            )
        return best_audio

    def synthesize(text: str, output_wav_path: str) -> None:
        audio_chunks = []
        for i, chunk_text in enumerate(split_into_chunks(text)):
            if i > 0 and chunk_silence > 0:
                audio_chunks.append(silence)
            audio_chunks.append(generate_chunk(chunk_text))

        audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
        audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)

        with wave.open(output_wav_path, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_int16.tobytes())

        # A long-lived worker otherwise keeps every generation's intermediate buffers cached on the GPU.
        if device == "mps":
            torch.mps.empty_cache()

    return synthesize


def run_worker(model_id: str, description: str, chunk_silence: float) -> None:
    protocol = sys.stdout
    sys.stdout = sys.stderr  # keep stray library prints off the protocol channel

    def reply(message: dict) -> None:
        protocol.write(json.dumps(message, ensure_ascii=False) + "\n")
        protocol.flush()

    synthesize = load_synthesizer(model_id, description, chunk_silence)
    reply({"ready": True})

    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            synthesize(request["text"].strip(), request["out"])
            reply({"id": request_id, "ok": True})
        except Exception as err:  # one bad request must not take the loaded model down with it
            reply({"id": request_id, "ok": False, "error": f"{type(err).__name__}: {err}"})


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        model_id, description = sys.argv[2], sys.argv[3]
        chunk_silence = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
        run_worker(model_id, description, chunk_silence)
        return

    output_wav_path, model_id, description = sys.argv[1], sys.argv[2], sys.argv[3]
    chunk_silence = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
    text = sys.stdin.read().strip()
    load_synthesizer(model_id, description, chunk_silence)(text, output_wav_path)


if __name__ == "__main__":
    main()
