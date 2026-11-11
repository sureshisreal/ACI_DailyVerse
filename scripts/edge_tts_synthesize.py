"""Synthesize narration with a Microsoft Edge neural voice (edge-tts) and record word timings.

Used by server.ts's synthesizeWithEdge (TTS_ENGINE=edge). Writes the audio as MP3 and, alongside it,
a JSON list of {"text", "start", "end"} (seconds from the start of the audio) for every spoken word -
the timings drive the video's reading highlighter. The edge-tts CLI can't emit word timings, hence
this small wrapper around its Python API.

Usage: edge_tts_synthesize.py --voice ta-IN-PallaviNeural --rate=-10% --text-file in.txt \
         --out-audio out.mp3 --out-words words.json
"""
import argparse
import asyncio
import json

import edge_tts

TICKS_PER_SECOND = 10_000_000  # edge-tts offsets/durations are in 100-nanosecond units


async def synthesize(text: str, voice: str, rate: str, out_audio: str, out_words: str) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(out_audio, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                words.append({"text": chunk["text"], "start": round(start, 3),
                              "end": round(start + chunk["duration"] / TICKS_PER_SECOND, 3)})
    with open(out_words, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--out-audio", required=True)
    parser.add_argument("--out-words", required=True)
    args = parser.parse_args()
    with open(args.text_file, encoding="utf-8") as f:
        text = f.read()
    asyncio.run(synthesize(text, args.voice, args.rate, args.out_audio, args.out_words))


if __name__ == "__main__":
    main()
