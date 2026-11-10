import './envLoader';
import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import { createServer as createViteServer } from 'vite';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { pipeline, env as transformersEnv } from '@xenova/transformers';
import { verseRouter } from './server/routes/verse.routes';
import { startInstagramSync } from './server/services/instagramSync.service';

// Configure FFmpeg and FFprobe
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Configure Transformers.js
transformersEnv.cacheDir = path.join(process.cwd(), '.cache', 'transformers');
transformersEnv.allowLocalModels = false;

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use('/api', verseRouter);

// --- Caption alignment (open-source Whisper via @xenova/transformers, runs fully locally/offline) ---
// Finds real word-level speech timing in a narration clip. Exposed standalone as /api/align-captions;
// also used by isNarrationAudioComplete below for TTS completeness/degeneracy QA. /api/video/generate
// no longer burns in a word-by-word highlighter (removed per explicit request), so it doesn't call
// this itself anymore.

type WordTiming = { text: string; start: number; end: number };

// Loaded once and reused across requests; multilingual tiny model covers en/ta/te.
let asrPipelinePromise: Promise<any> | null = null;
const getAsrPipeline = () => {
  if (!asrPipelinePromise) {
    asrPipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
  }
  return asrPipelinePromise;
};

// Actually running inference on that shared pipeline instance is a separate concern from loading it
// - the underlying native ONNX session isn't safe to invoke reentrantly, and since the Meditation
// Video's three languages now run concurrently (see runMeditationGeneration), their alignment/QA
// calls could otherwise land on it at the same instant. This serializes just the inference calls
// (a plain promise-chain mutex) while leaving TTS synthesis and ffmpeg encoding - the actual
// long-running, genuinely parallelizable work - unaffected. Whisper on a single narration clip is a
// few seconds of work, so queuing behind another in-flight call doesn't cost much.
let asrQueue: Promise<any> = Promise.resolve();
function runAsr(asr: any, samples: Float32Array, options: any): Promise<any> {
  const result = asrQueue.then(() => asr(samples, options));
  asrQueue = result.catch(() => {}); // one call's failure shouldn't jam the queue for the next
  return result;
}

// Separate mutex, Indic-Parler subprocesses only - deliberately NOT shared with asrQueue above or
// applied to Piper. Piper's ONNX voice model is tens of MB and safe to run concurrently with
// anything else here (that's what lets the Meditation Video's three languages actually run
// concurrently, per the comment above - serializing Piper too was tried and just made every
// meditation feel much slower, since English/Telugu no longer overlapped Tamil for no memory
// benefit). Indic-Parler is different: it's a full transformer model loaded fresh per subprocess
// (multiple GB), and two of them running at once - verified directly on this machine - pushed free
// memory under 1GB, the same kind of local-model thrashing this app's own README documents for why
// image generation moved off this machine entirely. This queue keeps that specific, heavy engine to
// one instance at a time system-wide without touching Piper's or Whisper's own concurrency.
let indicParlerQueue: Promise<any> = Promise.resolve();
function runIndicParlerSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = indicParlerQueue.then(fn);
  indicParlerQueue = result.catch(() => {}); // one call's failure shouldn't jam the queue for the next
  return result;
}

// TTS audio is passed around as raw 16-bit PCM mono @ 24kHz, base64-encoded (see synthesizeWithPiper
// / synthesizeIndicParlerOnce below, which resample their engines' native output to this fixed format).
function decodePcm16Base64(base64: string): { samples: Float32Array; sampleRate: number } {
  const buf = Buffer.from(base64, 'base64');
  const samples = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
  return { samples, sampleRate: 24000 };
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).map(w => w.trim()).filter(Boolean);
}

// Distributes words evenly across [start, end], weighting each by its character length
// so short words ("a", "is") don't linger on screen as long as long ones.
function proportionalWordTimings(words: string[], start: number, end: number): WordTiming[] {
  const weights = words.map(w => Math.max(1, w.replace(/[.,;:!?—""'']/g, '').length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const totalDur = Math.max(0.05, end - start);
  let t = start;
  return words.map((w, i) => {
    const dur = (weights[i] / totalWeight) * totalDur;
    const timing = { text: w, start: t, end: t + dur };
    t += dur;
    return timing;
  });
}

// Uses Whisper only to find real word/speech-segment boundaries in the audio;
// the on-screen text always stays our verified reference words (never the ASR's own transcription),
// since Whisper's Tamil/Telugu transcription accuracy isn't reliable enough to display directly.
async function alignWithWhisper(samples16k: Float32Array, words: string[], lang: string): Promise<WordTiming[] | null> {
  if (words.length === 0) return null;
  try {
    const asr = await getAsrPipeline();
    const whisperLanguage = lang === 'ta' ? 'tamil' : lang === 'te' ? 'telugu' : 'english';
    const output: any = await runAsr(asr, samples16k, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      language: whisperLanguage,
      task: 'transcribe',
    });

    const chunks: any[] = (output?.chunks || []).filter(
      (c: any) => Array.isArray(c?.timestamp) && c.timestamp[0] != null && c.timestamp[1] != null
    );
    if (chunks.length === 0) return null;

    // Word counts roughly line up: map our known words positionally onto Whisper's timing slots.
    if (Math.abs(chunks.length - words.length) <= Math.max(2, Math.round(words.length * 0.25))) {
      return words.map((w, i) => {
        const c = chunks[Math.min(i, chunks.length - 1)];
        return { text: w, start: c.timestamp[0], end: c.timestamp[1] };
      });
    }

    // Counts diverged too much to trust a positional map (common for low-resource languages) -
    // fall back to proportional spacing, but still anchored to Whisper's detected speech span
    // so we trim any leading/trailing silence.
    const start = chunks[0].timestamp[0];
    const end = chunks[chunks.length - 1].timestamp[1];
    return proportionalWordTimings(words, start, end);
  } catch (err: any) {
    console.warn('Whisper caption alignment failed, using proportional fallback:', err?.message || err);
    return null;
  }
}

// Reads sample rate + 16-bit PCM samples back out of a standard RIFF/WAVE file (the container
// /api/video/generate's audioBase64 arrives in - see wavEncoder.ts's wrapPcm16AsWav) by walking its
// chunks rather than assuming the minimal 44-byte header, so a 'fmt '/'data' chunk order or size
// this app didn't itself produce still decodes correctly.
function decodeWavPcm16(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV buffer');
  }
  let offset = 12;
  let sampleRate = 24000;
  let dataStart = -1, dataLen = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkId === 'fmt ') {
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
    } else if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataLen = Math.min(chunkSize, buffer.length - chunkDataStart);
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (dataStart < 0) throw new Error('WAV data chunk not found');
  const sampleCount = Math.floor(dataLen / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  return { samples, sampleRate };
}

app.post('/api/align-captions', async (req, res) => {
  const { audioBase64, text, lang = 'en' } = req.body;
  const words = splitWords(text || '');

  if (!audioBase64 || words.length === 0) {
    return res.status(400).json({ error: 'audioBase64 and text are required' });
  }

  try {
    const { samples, sampleRate } = decodePcm16Base64(audioBase64);
    const totalDuration = samples.length / sampleRate;
    const samples16k = resampleLinear(samples, sampleRate, 16000);

    const aligned = await alignWithWhisper(samples16k, words, lang);
    const result = aligned || proportionalWordTimings(words, 0.1, Math.max(0.3, totalDuration - 0.1));

    res.json({ words: result, duration: totalDuration });
  } catch (error: any) {
    console.warn('Error aligning captions, returning proportional-timing fallback:', error?.message || error);
    res.json({ words: proportionalWordTimings(words, 0, Math.max(1, words.length * 0.35)) });
  }
});

// --- Local neural TTS narration (optional, no API key) ---
// English and Telugu both have real trained Piper voices - checked the full rhasspy/piper-voices
// catalog (171 voices): Hindi, Malayalam, Marathi and Telugu are covered for Indian languages,
// Tamil isn't published there. Tamil instead runs via synthesizeWithIndicParler below.
const PIPER_VENV_PYTHON = path.join(process.cwd(), '.piper-venv', 'bin', 'python3');
const PIPER_SYNTHESIZE_SCRIPT = path.join(process.cwd(), 'scripts', 'piper_synthesize.py');
const PIPER_VOICES: Record<string, string> = {
  // Cori: UK English, female, single-speaker, high quality (24h LibriVox training set per its
  // model card) - swapped in place of ljspeech-high.
  en: path.join(process.cwd(), '.piper-voices', 'en_GB-cori-high.onnx'),
  // Padmavathi: Telugu, female, medium quality (no high-quality Telugu voice exists in the Piper
  // catalog) - swapped in place of maya-medium.
  te: path.join(process.cwd(), '.piper-voices', 'te_IN-padmavathi-medium.onnx'),
};
// Devotional narration delivery tuning - applies uniformly across all three local TTS engines
// (Piper here, MMS-TTS and Indic-Parler below). Speed and inter-sentence pauses are per-engine
// synthesis params (see each script in scripts/).
// length_scale > 1.0 slows the model's default rate down, giving each line room to breathe instead
// of being read at a brisk, flat, default pace - 1.10 reads at roughly 0.91x the model's baseline
// speed (requested range: 0.88-0.95x).
const PIPER_DEVOTIONAL_LENGTH_SCALE = 1.10;
const DEVOTIONAL_SENTENCE_SILENCE_SECONDS = 0.7; // pause between sentences (requested range: 0.5-1s)
const DEVOTIONAL_VOLUME = 0.92; // low-to-medium energy, not a full loudness cut
// A previous version of this function also pitch-shifted down ~0.5 semitone (asetrate/atempo
// trick) here. Pulled back out - that kind of blind resample-based pitch shift is a known source of
// a subtle phasey/robotic quality, and "natural" (i.e. untouched) was always one of the two
// acceptable pitch options, so it's not worth that risk for a marginal effect.

// Shared post-processing for every local TTS engine's raw WAV output: just the resample to this
// app's fixed 24kHz mono PCM16 narration format (pitch/tempo untouched from what the engine itself
// produced).
async function applyDevotionalPostProcessing(wavPath: string, tempDir: string): Promise<string> {
  const rawPath = path.join(tempDir, 'out.raw');
  await new Promise<void>((resolve, reject) => {
    ffmpeg(wavPath)
      .outputOptions(['-ar 24000', '-ac 1', '-f s16le'])
      .output(rawPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  return fs.readFileSync(rawPath).toString('base64');
}

async function synthesizeWithPiper(text: string, lang: 'en' | 'te' = 'en'): Promise<string | null> {
  const modelPath = PIPER_VOICES[lang];
  if (!modelPath || !fs.existsSync(modelPath)) return null;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piper-'));
  const wavPath = path.join(tempDir, 'out.wav');
  try {
    await new Promise<void>((resolve, reject) => {
      // Uses our scripts/piper_synthesize.py instead of `python3 -m piper` - see that file's
      // docstring for why (the vendored wheel mishandles this repo's long absolute path). Invokes
      // .piper-venv's own interpreter directly (like the MMS-TTS/Indic-Parler venvs below) rather
      // than the system python3 - piper-tts's compiled extensions (espeakbridge, onnxruntime) are
      // tied to the venv's Python ABI, so a PYTHONPATH-only trick against the system interpreter
      // can resolve the top-level `piper` package but still fail on its own native dependencies.
      const proc = spawn(PIPER_VENV_PYTHON, [
        PIPER_SYNTHESIZE_SCRIPT, modelPath, wavPath,
        String(PIPER_DEVOTIONAL_LENGTH_SCALE), String(DEVOTIONAL_SENTENCE_SILENCE_SECONDS), String(DEVOTIONAL_VOLUME)
      ], {
        cwd: process.cwd(),
        env: process.env
      });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`piper exited ${code}: ${stderr}`)));
      proc.stdin.write(text);
      proc.stdin.end();
    });

    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size === 0) return null;

    return await applyDevotionalPostProcessing(wavPath, tempDir);
  } catch (err: any) {
    console.warn('Piper TTS synthesis failed:', err?.message || err);
    return null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }
}

// Piper is deterministic (no autoregressive sampling, unlike Indic-Parler), so it's far less prone
// to degenerating into a repetition loop - but "far less prone" isn't "never": an empty/near-silent
// clip (e.g. a synthesis glitch) or an abnormally short result for the given text is still worth
// catching before it ships, using the same isNarrationAudioComplete check built for Indic-Parler
// (see its own comment for what it detects). There's no second engine to fall back to for
// English/Telugu the way Tamil falls back to MMS-TTS, so this retries the same engine once and
// accepts the better of the two attempts rather than erroring - one bad take is usually a one-off,
// not systematic, for a deterministic engine.
const PIPER_QA_MAX_ATTEMPTS = 2;

async function synthesizeWithPiperQA(text: string, lang: 'en' | 'te'): Promise<string | null> {
  let best: string | null = null;
  for (let attempt = 0; attempt < PIPER_QA_MAX_ATTEMPTS; attempt++) {
    const audioBase64 = await synthesizeWithPiper(text, lang);
    if (!audioBase64) continue;
    best = best || audioBase64; // first successful synthesis, kept as a fallback if QA never passes
    if (await isNarrationAudioComplete(audioBase64, lang)) return audioBase64;
    console.warn(`Piper output looked incomplete/degenerate (attempt ${attempt + 1}/${PIPER_QA_MAX_ATTEMPTS}), ${attempt < PIPER_QA_MAX_ATTEMPTS - 1 ? 'retrying' : 'accepting best available'}.`);
  }
  return best;
}

// Shared HuggingFace cache dir for the local Python-based TTS engine below (Indic-Parler) - named
// generically since MMS-TTS (which also used this) has been removed; Tamil now speaks with exactly
// one voice (Indic-Parler's "Jaya" - warm, conversational, female) rather than falling back to a
// second, differently-voiced engine when Jaya fails. That's a deliberate reliability tradeoff, not
// an oversight: Indic-Parler fails/degenerates on a real fraction of attempts and can occasionally
// take several minutes, and with the fallback gone, those cases now surface as a failed/slow Tamil
// narration instead of silently switching to a different-sounding voice.
const LOCAL_TTS_HF_HOME = path.join(process.cwd(), '.cache', 'huggingface');

// Indic Parler-TTS (ai4bharat/indic-parler-tts) is instruction-following, so "description" below is
// a natural-language prompt that actually shapes delivery (voice, warmth, pacing) - this is what
// makes it the only voice worth keeping for Tamil now that MMS-TTS is gone. The checkpoint is gated
// on Hugging Face: the account owner must accept its terms at
// https://huggingface.co/ai4bharat/indic-parler-tts and put a read-scoped access token in .env as
// HF_TOKEN, or synthesizeTamil below returns null (no narration) for Tamil entirely.
const INDIC_PARLER_VENV_PYTHON = path.join(process.cwd(), '.indic-parler-venv', 'bin', 'python3');
const INDIC_PARLER_SYNTHESIZE_SCRIPT = path.join(process.cwd(), 'scripts', 'indic_parler_synthesize.py');
const INDIC_PARLER_MODEL = 'ai4bharat/indic-parler-tts';
// Jaya is AI4Bharat's recommended default Tamil speaker for this model. Indic-Parler is
// instruction-following (unlike Piper/MMS-TTS), so delivery is entirely controlled via this
// natural-language prompt - no mechanical rate/pitch params passed to the script (contrast
// PIPER_DEVOTIONAL_LENGTH_SCALE etc. above).
//
// Softened per explicit request (comfortable/pleasant/realistic to listen to) from an earlier,
// more neutral "moderate speed, natural-to-medium pitch, conversational (not a slow devotional
// cadence)" version - that earlier phrasing was itself a deliberate move away from a stiff,
// pulpit-style delivery, and this keeps that same intent (still "conversational," not a formal
// sermon read) while asking for a genuinely soft, gentle, soothing pitch and an unhurried pace,
// rather than a brisk/neutral one - closer to how a caring friend or family member would speak
// quietly and reassuringly, not a public address. Low reverb, close/intimate recording, and
// input-punctuation-driven pausing are all kept unchanged from before.
const INDIC_PARLER_TAMIL_DESCRIPTION = "Jaya speaks in Tamil with a soft, warm, gentle female voice - like a caring friend speaking quietly and reassuringly, not a news reader or a formal preacher. Calm, unhurried, natural pace with a smoothly soft, soothing pitch - not flat, robotic, or theatrical. Very clear, close-sounding, intimate recording with low reverb and no background noise, as if speaking gently near the listener's ear. Natural pauses following the commas and punctuation in the text, giving the words room to breathe.";
// Splice gap between the pieces indic_parler_synthesize.py's own chunking falls back to for a long
// verse (see that script's docstring) - short, since those breaks are mid-sentence, not the fuller
// DEVOTIONAL_SENTENCE_SILENCE_SECONDS pause used between actual sentences elsewhere in this file.
const INDIC_PARLER_CHUNK_SILENCE_SECONDS = 0.2;
// Up to this many independent generation attempts before giving up on Indic-Parler for this text.
// See transcriptionLooksDegenerate below for why more than one is worth trying.
//
// No fallback engine and no word-count gate past this point anymore (both existed only to route
// around Indic-Parler's unreliability/slowness on long text). Per explicit direction, Tamil now
// speaks with exactly one voice ("Jaya," warm/conversational/female) for everything - verse and
// meditation reflection alike - rather than silently switching to a different-sounding fallback
// voice when Jaya fails. That risk (a failed Tamil narration on hard text, with nothing to fall
// back to) is the deliberate tradeoff of that choice, not an oversight - see synthesizeTamil below.
//
// Bumped 3 -> 5 after switching synthesis to MPS (see the device comment in
// indic_parler_synthesize.py): each attempt used to cost 20-30+ minutes on CPU, which is what
// capped this at 3 - more attempts than that was prohibitively expensive. On MPS a real attempt
// (model load + generate, including a multi-chunk meditation reflection) now measures in the
// 1-3 minute range, so 5 attempts buys meaningfully more headroom against Proverbs 3:5-6-style
// stochastic degeneration (verified directly: this exact verse has exhausted all 3 attempts and
// given up more than once) at a worst-case wait that's still far below the old 3-attempt/CPU cost.
const INDIC_PARLER_MAX_ATTEMPTS = 5;

// Hard ceiling on a single Indic-Parler subprocess attempt. Without this, a genuinely hung
// subprocess (a network stall pulling the model from Hugging Face, a stuck generation loop, or an
// MPS-specific stall - the exact failure mode that originally motivated staying CPU-only, see
// indic_parler_synthesize.py) has no way to ever resolve - proc.on('close') simply never fires -
// which doesn't just block that one request forever, it holds runIndicParlerSerialized's queue open,
// silently jamming every other Tamil request (verse or meditation, any date) behind it until the
// server is restarted.
//
// Lowered 30 -> 6 minutes after switching to MPS: real attempts (including a multi-chunk
// meditation reflection, plus the Whisper QA pass) now measure in the 1-3 minute range end to end,
// so 30 minutes was purely dead time on a genuine stall - it let one hung attempt eat the entire
// INDIC_PARLER_MAX_ATTEMPTS budget (confirmed directly: two real requests each hit this exact
// 30-minute timeout in a row). 6 minutes stays comfortably above every real attempt observed so
// far while cutting a true hang's cost enough that raising MAX_ATTEMPTS above is actually worth it
// rather than just multiplying dead time.
//
// That 6-minute figure was only ever validated against short text (a single verse, at most a
// couple dozen words). The Meditation Video's reflection narration (explanation + invitation +
// prayer, ~110-190 words - see ai/meditation.ts's word targets) is chunked by
// indic_parler_synthesize.py into ~18-word pieces (MAX_CHUNK_WORDS there), each individually
// retried up to 3x (CHUNK_DEGENERATE_MAX_ATTEMPTS there) against the model's own hard per-call
// ceiling (~30s - model.generation_config.max_length at this model's sample rate/hop length, see
// that script's comments). For a ~150-word reflection (~9 chunks), that per-chunk retry budget
// alone is 9 * 3 * 30s = ~13.5 minutes worst case - already past this fixed 6-minute ceiling before
// counting model-load time or any system load, independent of whether Indic-Parler is actually
// struggling. Confirmed directly: a from-scratch standalone run of the exact same reflection text
// (scripts/indic_parler_synthesize.py invoked directly, no server involved) produced clean,
// complete audio with zero degenerate-chunk retries, while the server's fixed-6-minute-budget path
// timed out on the same text on every attempt. Scaling the timeout with the actual input's worst
// case (below) fixes the mismatch instead of just padding the constant - a short verse still fails
// fast on a genuine hang, and a long reflection gets the time its own chunk count can legitimately
// need.
const INDIC_PARLER_MAX_CHUNK_WORDS = 18; // must mirror scripts/indic_parler_synthesize.py's MAX_CHUNK_WORDS
const INDIC_PARLER_CHUNK_DEGENERATE_MAX_ATTEMPTS = 3; // must mirror that script's CHUNK_DEGENERATE_MAX_ATTEMPTS
const INDIC_PARLER_CHUNK_WORST_CASE_SECONDS = 31; // that script's model.generate() hard per-chunk ceiling (~30.3s), rounded up
// Fixed allowance for process startup + loading the ~3.6GB model from disk/HF cache into MPS/CPU
// before generation even begins - itself variable under memory pressure, so generous on purpose.
const INDIC_PARLER_MODEL_LOAD_BUDGET_MS = 90 * 1000;
const INDIC_PARLER_MIN_TIMEOUT_MS = 6 * 60 * 1000; // floor: never less than the original constant, so a short verse still fails fast on a genuine hang

function indicParlerTimeoutMsFor(text: string): number {
  const wordCount = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
  const chunkCount = Math.max(1, Math.ceil(wordCount / INDIC_PARLER_MAX_CHUNK_WORDS));
  const worstCaseGenerationMs = chunkCount * INDIC_PARLER_CHUNK_DEGENERATE_MAX_ATTEMPTS * INDIC_PARLER_CHUNK_WORST_CASE_SECONDS * 1000;
  return Math.max(INDIC_PARLER_MIN_TIMEOUT_MS, INDIC_PARLER_MODEL_LOAD_BUDGET_MS + worstCaseGenerationMs);
}

// Indic Parler-TTS is autoregressive (generates audio token-by-token, sampling as it goes), so it
// can randomly collapse into repeating the same word or short phrase over and over instead of
// finishing the sentence - verified directly against this app's own Tamil Bible text: two different
// real verses (Esther 8:9, Nehemiah 9:6), including one using only common devotional vocabulary,
// both degenerated this way, while a third came out complete and natural. Since it's stochastic, a
// length/vocabulary rule can't reliably prevent it - this instead catches it after the fact by
// transcribing the result with the same local Whisper model align-captions uses, and looking for the
// unmistakable signature: real speech (even misheard by a weak model) has far more lexical variety
// in any short span than a handful of words stuck on repeat. That lets synthesizeWithIndicParler
// retry (a fresh sampling run often just doesn't repeat the same collapse) and, failing that, return
// null - with no fallback engine past this point (see synthesizeTamil below), that null means Tamil
// narration for this text fails outright rather than being heard in a different voice.
async function isNarrationAudioComplete(audioBase64: string, lang: 'ta' | 'te' | 'en'): Promise<boolean> {
  try {
    const { samples, sampleRate } = decodePcm16Base64(audioBase64);
    const durationSec = samples.length / sampleRate;

    // Tamil Whisper transcriptions are not reliable enough for this gate: the same valid WAV can be
    // transcribed as a long stream of repeated filler words such as "ஏன் ஏன் ஏன் ..." even when the
    // underlying audio is perfectly fine. Indic-Parler itself already does a per-chunk duration-based
    // sanity check in scripts/indic_parler_synthesize.py, so the extra Node-side ASR gate is doing
    // more harm than good for Tamil and causes false rejections. Keep the ASR-based degeneracy guard
    // for English/Telugu, where Whisper is much more trustworthy.
    if (lang === 'ta') {
      return durationSec >= 0.75 && samples.length > 0;
    }

    const samples16k = resampleLinear(samples, sampleRate, 16000);
    const asr = await getAsrPipeline();
    const whisperLanguage = lang === 'te' ? 'telugu' : 'english';
    // return_timestamps is what actually turns on Whisper's long-form (chunked) decoding in this
    // pipeline - without it, audio past the first several seconds silently goes untranscribed
    // instead of erroring, which let a near-empty transcription of a 22s clip sail right past the
    // repetition check below undetected (verified directly: dropping return_timestamps here turned
    // a 73-word transcription of known-degenerate audio into a 4-word one). alignWithWhisper above
    // sets the same option for the same reason.
    const output: any = await runAsr(asr, samples16k, {
      return_timestamps: 'word', chunk_length_s: 30, language: whisperLanguage, task: 'transcribe',
    });
    const text = output?.text || '';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    // Second, independent signal: even a weak model transcribing a genuinely full-length narration -
    // misheard words and all - keeps pace with the audio far above this rate. Well under half natural
    // speaking speed, so this only fires when Whisper is barely finding anything to say about a clip
    // that isn't actually short.
    const MIN_WORDS_PER_SECOND = 0.6;
    if (wordCount < durationSec * MIN_WORDS_PER_SECOND) return false;

    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 10) return false;
    for (let i = 0; i + 10 <= words.length; i++) {
      if (new Set(words.slice(i, i + 10)).size < 4) return false;
    }
    return true;
  } catch (err: any) {
    console.warn('Degeneration check failed, assuming audio is fine:', err?.message || err);
    return true;
  }
}

// One long-lived Indic-Parler process (scripts/indic_parler_synthesize.py --worker) instead of a
// fresh subprocess per narration. Every one-shot run re-loaded the ~3.6GB checkpoint before
// generating anything (INDIC_PARLER_MODEL_LOAD_BUDGET_MS above), and a Meditation Video needs
// several Tamil narrations (verse, reflection, up to two length re-takes), all queued one at a time
// behind runIndicParlerSerialized - so that load was paid over and over on the slowest path in the
// app. Requests still go through runIndicParlerSerialized, so the worker only ever has one in
// flight and memory use stays at one loaded model, same as before.
// - Crash/hang: a request that times out (indicParlerTimeoutMsFor) or a worker that exits kills the
//   process and fails whatever was pending; the next request starts a fresh one.
// - Idle: the loaded model holds several GB, so the worker exits after INDIC_PARLER_WORKER_IDLE_MS
//   without requests (default 10 min, env-tunable) and is re-loaded on the next Tamil narration.
const INDIC_PARLER_WORKER_IDLE_MS = (Number(process.env.INDIC_PARLER_WORKER_IDLE_MIN) || 10) * 60 * 1000;

class IndicParlerWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  private stderrTail = '';

  private start(): Promise<void> {
    const proc = spawn(INDIC_PARLER_VENV_PYTHON, [
      INDIC_PARLER_SYNTHESIZE_SCRIPT, '--worker', INDIC_PARLER_MODEL, INDIC_PARLER_TAMIL_DESCRIPTION,
      String(INDIC_PARLER_CHUNK_SILENCE_SECONDS)
    ], {
      cwd: process.cwd(),
      env: { ...process.env, HF_HOME: LOCAL_TTS_HF_HOME }
    });
    this.proc = proc;
    this.stderrTail = '';
    console.info('[indic-parler] Starting worker (loading model)...');

    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // not a protocol line
        }
        if (msg.ready) {
          console.info('[indic-parler] Worker ready.');
          resolveReady();
          return;
        }
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        msg.ok ? waiter.resolve() : waiter.reject(new Error(msg.error || 'indic-parler request failed'));
      });
      proc.stderr.on('data', (d) => {
        const chunk = d.toString();
        this.stderrTail = (this.stderrTail + chunk).slice(-4000);
        // The script's per-chunk retries explain an unusually slow narration - worth seeing live.
        for (const line of chunk.split('\n')) if (line.includes('looked degenerate')) console.warn(`[indic-parler] ${line.trim()}`);
      });
      this.rejectReady = rejectReady;
      proc.on('error', (err) => this.markGone(proc, err));
      // Without a listener, writing to a worker that just died (EPIPE) is an unhandled 'error'
      // event that crashes the whole server.
      proc.stdin.on('error', (err) => this.markGone(proc, err));
      proc.on('exit', (code, signal) => this.markGone(proc, new Error(`indic-parler worker exited (${signal || code}): ${this.stderrTail.trim().split('\n').slice(-5).join('\n')}`)));
    });
    return this.ready;
  }

  private rejectReady: ((err: Error) => void) | null = null;

  private markGone(proc: ChildProcessWithoutNullStreams, err: Error): void {
    if (this.proc !== proc) return; // an older, already-replaced worker
    this.proc = null;
    this.ready = null;
    this.rejectReady?.(err);
    this.rejectReady = null;
    for (const waiter of this.pending.values()) waiter.reject(err);
    this.pending.clear();
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const proc = this.proc;
    if (!proc) return;
    proc.kill('SIGKILL');
    // Forget the worker now rather than on its async 'exit' event - otherwise the next queued
    // request (runIndicParlerSerialized moves on as soon as a timeout rejects) still sees the
    // killed process as ready and writes to its closed stdin.
    this.markGone(proc, new Error('indic-parler worker stopped'));
  }

  // Writes the narration for `text` to `wavPath`. `timeoutMs` covers both a cold model load and the
  // generation itself, matching what the old one-shot subprocess had to fit inside.
  async synthesize(text: string, wavPath: string, timeoutMs: number): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // A stuck worker would otherwise hold runIndicParlerSerialized's queue forever.
        this.stop();
        reject(new Error(`indic-parler timed out after ${Math.round(timeoutMs / 60000)} minutes`));
      }, timeoutMs);
    });
    try {
      await Promise.race([this.ready ?? this.start(), timeout]);
      const proc = this.proc;
      if (!proc || !proc.stdin.writable) throw new Error('indic-parler worker is not running');
      const id = this.nextId++;
      const done = new Promise<void>((resolve, reject) => this.pending.set(id, { resolve, reject }));
      proc.stdin.write(JSON.stringify({ id, text, out: wavPath }) + '\n');
      await Promise.race([done, timeout]);
    } finally {
      clearTimeout(timer);
      if (this.proc) {
        this.idleTimer = setTimeout(() => {
          console.info('[indic-parler] Worker idle, shutting down to free memory.');
          this.stop();
        }, INDIC_PARLER_WORKER_IDLE_MS);
        this.idleTimer.unref();
      }
    }
  }
}

const indicParlerWorker = new IndicParlerWorker();
process.on('exit', () => indicParlerWorker.stop());

async function synthesizeIndicParlerOnce(text: string): Promise<string | null> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indic-parler-'));
  const wavPath = path.join(tempDir, 'out.wav');
  try {
    // Serialized against other Indic-Parler calls only (see runIndicParlerSerialized above) -
    // Piper and Whisper are unaffected and keep running concurrently with this. Bounded by
    // indicParlerTimeoutMsFor (see its comment) - scaled to this call's own text length rather than
    // a flat constant, since a long meditation reflection legitimately needs more headroom than a
    // short verse reading.
    await runIndicParlerSerialized(() => indicParlerWorker.synthesize(text, wavPath, indicParlerTimeoutMsFor(text)));

    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size === 0) return null;

    return await applyDevotionalPostProcessing(wavPath, tempDir);
  } catch (err: any) {
    console.warn('Indic Parler-TTS synthesis failed:', err?.message || err);
    return null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }
}

async function synthesizeWithIndicParler(text: string): Promise<string | null> {
  if (!fs.existsSync(INDIC_PARLER_VENV_PYTHON) || !process.env.HF_TOKEN) return null;

  for (let attempt = 1; attempt <= INDIC_PARLER_MAX_ATTEMPTS; attempt++) {
    const audioBase64 = await synthesizeIndicParlerOnce(text);
    if (!audioBase64) continue;
    if (await isNarrationAudioComplete(audioBase64, 'ta')) return audioBase64;
    console.warn(`Indic Parler-TTS output looked degenerate (attempt ${attempt}/${INDIC_PARLER_MAX_ATTEMPTS}), ${attempt < INDIC_PARLER_MAX_ATTEMPTS ? 'retrying' : 'giving up (no fallback voice)'}.`);
  }
  return null;
}

// Single-voice by design (see INDIC_PARLER_MAX_ATTEMPTS above for the reliability tradeoff this
// implies) - Tamil narration is Indic-Parler's "Jaya" or nothing, for both the verse and the
// meditation reflection, never a different-sounding fallback engine.
async function synthesizeTamil(text: string): Promise<{ audioBase64: string | null; provider: 'indic-parler' }> {
  return { audioBase64: await synthesizeWithIndicParler(text), provider: 'indic-parler' };
}

// Tamil-only: converts 1-999 to Tamil number words. Originally needed because facebook/mms-tts-tam's
// tokenizer was character-level with no text-normalization frontend (digit characters tokenized
// individually with no phonetic mapping, unlike Piper's espeak-ng frontend for English/Telugu,
// which already verbalizes numbers correctly on its own) - MMS-TTS is gone now (Tamil narration is
// Indic-Parler only, see synthesizeTamil below), but this stays: spelling numbers out in Tamil
// script is still correct/safe input for Indic-Parler too, and this has been the actual text it's
// spoken throughout this app's testing, not bare digits. Range is capped at 999, comfortably
// covering every real chapter (max 150, Psalms) and verse (max 176, Psalm 119) number in the Bible.
const TAMIL_ONES = ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'];
const TAMIL_TEENS = ['பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது'];
const TAMIL_TENS_COMBINING = ['', '', 'இருபத்து', 'முப்பத்து', 'நாற்பத்து', 'ஐம்பத்து', 'அறுபத்து', 'எழுபத்து', 'எண்பத்து', 'தொண்ணூற்று'];
const TAMIL_TENS_BARE = ['', 'பத்து', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'];

function numberToTamilWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n); // out of realistic range - fall back rather than guess
  if (n === 0) return 'பூஜ்யம்';
  if (n < 10) return TAMIL_ONES[n];
  if (n < 20) return TAMIL_TEENS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? TAMIL_TENS_BARE[tens] : `${TAMIL_TENS_COMBINING[tens]} ${TAMIL_ONES[ones]}`;
  }
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (remainder === 0) return hundreds === 1 ? 'நூறு' : `${TAMIL_ONES[hundreds]} நூறு`;
  const hundredsWord = hundreds === 1 ? 'நூற்று' : `${TAMIL_ONES[hundreds]} நூற்று`;
  return `${hundredsWord} ${numberToTamilWords(remainder)}`;
}

// "Psalm 23:1" / "Philippians 4:6-7" reads badly through TTS as-is - the colon and hyphen either
// get skipped, read as literal punctuation, or garble the two numbers together depending on the
// engine. Rewriting chapter:verse notation as a spoken phrase before handing it to the TTS engine
// fixes that regardless of engine/language.
function speakableReference(reference: string, lang: 'en' | 'ta' | 'te'): string {
  const match = /^(.*\D)\s*(\d+):(\d+)(?:-(\d+))?\s*$/.exec(reference.trim());
  if (!match) return reference;
  const [, book, chapter, verseStart, verseEnd] = match;
  if (lang === 'ta') {
    const chapterWords = numberToTamilWords(Number(chapter));
    const verseStartWords = numberToTamilWords(Number(verseStart));
    const verses = verseEnd ? `${verseStartWords} முதல் ${numberToTamilWords(Number(verseEnd))} வரை` : verseStartWords;
    return `${book.trim()} ${chapterWords}, வசனம் ${verses}`;
  }
  if (lang === 'te') {
    const verses = verseEnd ? `${verseStart} నుండి ${verseEnd} వరకు` : verseStart;
    return `${book.trim()} ${chapter}, వచనం ${verses}`;
  }
  const verses = verseEnd ? `verses ${verseStart} to ${verseEnd}` : `verse ${verseStart}`;
  return `${book.trim()} ${chapter}, ${verses}`;
}

// The Narration Video and the Meditation Video both open with the same verse reading, so without
// this the same text was synthesized twice per language - for Tamil that's a second full
// Indic-Parler run (model load + generation) queued behind runIndicParlerSerialized, the slowest
// step in the whole pipeline. Keyed on the exact narration text; holds the in-flight promise so a
// concurrent duplicate request (Video and Meditation now run side by side) waits on the first run
// instead of starting its own. Failed (null) results are dropped so a retry synthesizes afresh.
// Bounded: each entry is a few MB of PCM, and only the latest verse's clips are ever reused.
const NARRATION_CACHE_MAX = 24;
const narrationCache = new Map<string, Promise<{ audioBase64: string | null; provider: string }>>();

function synthesizeNarrationCached(
  narration: string,
  synthesize: () => Promise<{ audioBase64: string | null; provider: string }>
): Promise<{ audioBase64: string | null; provider: string }> {
  const cached = narrationCache.get(narration);
  if (cached) return cached;
  const pending = synthesize().then((result) => {
    if (!result.audioBase64) narrationCache.delete(narration);
    return result;
  }, (err) => {
    narrationCache.delete(narration);
    throw err;
  });
  narrationCache.set(narration, pending);
  while (narrationCache.size > NARRATION_CACHE_MAX) narrationCache.delete(narrationCache.keys().next().value!);
  return pending;
}

// Reads text aloud (no analysis/meditation about it, just narration - the meditation content
// itself lives in ai/meditation.ts). `reference` is optional: when given, a spoken citation is
// appended (verse-reading use case); when omitted, `text` is narrated as-is with no citation
// (e.g. meditation explanation/prayer text, which has no single verse reference of its own).
app.post('/api/verse-audio', async (req, res) => {
  const { text, reference } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  // No explicit language param on this endpoint - detect the script directly. Tamil
  // (U+0B80-U+0BFF) runs via the MMS-TTS/Indic-Parler fallback; Telugu (U+0C00-U+0C7F) and plain
  // Latin/English text both have Piper voices.
  const isTamilScript = /[஀-௿]/.test(text || '');
  const isTeluguScript = /[ఀ-౿]/.test(text || '');
  // "Reading from" itself must be localized too - it's spoken text, so leaving it in English
  // would mispronounce that phrase mid-narration even once the verse/reference are correct.
  //
  // Tamil deliberately has no "from"-equivalent suffix tacked onto the reference (unlike Telugu's
  // trailing நுండி/English's leading "Reading from") - the locative "இல்"/"இலிருந்து" case marker
  // is meant to fuse onto the word it attaches to, and reading it as a separate word right after a
  // bare digit ("... வசனம் 1 இல் இருந்து") came out grammatically wrong. Stating the reference
  // plainly after a pause avoids that risk.
  const narration = !reference ? text
    : isTamilScript ? `${text}. ${speakableReference(reference, 'ta')}.`
    : isTeluguScript ? `${text}. ${speakableReference(reference, 'te')} నుండి.`
    : `${text}. Reading from ${speakableReference(reference, 'en')}.`;
  const { audioBase64, provider } = await synthesizeNarrationCached(narration, async () => {
    if (isTamilScript) return synthesizeTamil(narration);
    return { audioBase64: await synthesizeWithPiperQA(narration, isTeluguScript ? 'te' : 'en'), provider: 'piper' };
  });
  if (audioBase64) {
    return res.json({ audioBase64, provider });
  }

  res.json({ audioBase64: null, error: `Local ${isTamilScript ? 'Tamil TTS' : 'Piper'} synthesis unavailable for verse audio.` });
});

// --- Server-side video generation with FFmpeg: static poster + fade in/out ---
// No Ken Burns zoom - the frame stays put. Previously also burned in a word-by-word highlighter
// (an ASS overlay lighting up each verse word's on-poster position via libass) - removed per
// explicit request, so this is now just the static frame (or intro+main concat, see hasIntro below)
// plus a short fade in/out.
app.post('/api/video/generate', async (req, res) => {
  try {
    const {
      imageBase64, audioBase64, width = 1080, height = 1920, fps = 30,
      // Verse Video's opening hook card (see components/posterRenderer.ts's renderHookCard) - shown
      // for introDurationSec while the audio speaks the hook+reference, before the main poster
      // takes over for the verse reading. Both optional and unrelated to each other's presence: a
      // caller that omits them gets exactly the prior single-image behavior, unchanged.
      introImageBase64, introDurationSec,
      // 'cover' (default, prior-only behavior): scale to fill the target frame and crop the
      // overflow - correct when the source image already matches the target's aspect ratio (the
      // normal case: posterRenderer.ts always renders at PORTRAIT_W x PORTRAIT_H, matching this
      // route's own 1080x1920 default). 'contain-blur': scale the source to fit ENTIRELY inside the
      // target frame with no cropping, filling the leftover bars with a blurred/darkened cover-fit
      // copy of the same image rather than plain black - used for the Meditation Video's 1920x1080
      // landscape canvas (see runMeditationGeneration in DailyVerseGenerator.tsx), whose poster is
      // still rendered at the app's standard 1080x1920 portrait (posterRenderer.ts's text-placement
      // and hero-clause layout are tightly tuned for a tall narrow frame and weren't rewritten for
      // landscape) - 'cover' on a portrait image forced into a landscape frame would crop out almost
      // all of the verse text instead of just the frame's edges.
      fitMode = 'cover'
    } = req.body as { fitMode?: 'cover' | 'contain-blur'; [key: string]: any };

    if (!imageBase64 || !audioBase64) {
      return res.status(400).json({ error: 'Image and audio are required' });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripture-lens-'));

    try {
      let imagePath: string;
      if (imageBase64.startsWith('data:')) {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        imagePath = path.join(tempDir, 'image.png');
        fs.writeFileSync(imagePath, base64Data, 'base64');
      } else {
        imagePath = path.join(tempDir, 'image.png');
        fs.writeFileSync(imagePath, imageBase64, 'base64');
      }

      const hasIntro = typeof introImageBase64 === 'string' && introImageBase64.length > 0
        && typeof introDurationSec === 'number' && introDurationSec > 0;
      let introImagePath: string | null = null;
      if (hasIntro) {
        const base64Data = introImageBase64.startsWith('data:') ? introImageBase64.replace(/^data:image\/\w+;base64,/, '') : introImageBase64;
        introImagePath = path.join(tempDir, 'intro.png');
        fs.writeFileSync(introImagePath, base64Data, 'base64');
      }

      let audioPath: string;
      let audioBuffer: Buffer;
      if (audioBase64.startsWith('data:')) {
        const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, '');
        audioBuffer = Buffer.from(base64Data, 'base64');
        audioPath = path.join(tempDir, 'audio.wav');
        fs.writeFileSync(audioPath, audioBuffer);
      } else {
        audioBuffer = Buffer.from(audioBase64, 'base64');
        audioPath = path.join(tempDir, 'audio.wav');
        fs.writeFileSync(audioPath, audioBuffer);
      }

      const outputPath = path.join(tempDir, 'output.mp4');

      // Verse Video's hook card (see hasIntro above) means the on-screen frame the audience sees
      // is no longer always just one static image - when present, the intro card plays for
      // introDurationSec before the main poster takes over. The fade/output options below are
      // written to layer on top of whichever of the two shapes above the video chain takes,
      // converging on the same `filterComplex`/`videoLabel` by the time fade gets appended.
      //
      // buildFitChain: `label` is this branch's ffmpeg pad label prefix (kept unique per input so
      // an intro+main pair's intermediate labels below never collide). 'cover' is the original
      // scale-to-fill-and-crop behavior (correct when the source already matches the target aspect
      // ratio). 'contain-blur' fits the whole source inside the frame with no cropping and fills the
      // leftover bars with a blurred, darkened cover-fit copy of the same image - see fitMode's
      // comment above for why this exists.
      // This fit chain used to live inside the main encode's filter_complex, which meant it ran once
      // per OUTPUT FRAME. Every one of those frames is identical here - the source is a still poster
      // looped by '-loop 1' - so all but the first frame's worth of that work was wasted, and for
      // 'contain-blur' the waste was severe: gblur=sigma=40 over a full 1920x1080 frame, repeated.
      // The Meditation Video is where that bites (verse + a 90-120s reflection is ~3600 frames at
      // 30fps, against a Verse Video's few hundred), which is why it was disproportionately slow
      // rather than just proportionally longer. The fit is now resolved ONCE into a still PNG below
      // and the encode simply loops that finished frame - byte-for-byte the same composition, a
      // fraction of the CPU. Written as a single-in/single-out graph for '-vf' (labels here are
      // internal to the graph, unlike the old version's caller-visible pad labels).
      function buildFitFilter(): string {
        if (fitMode === 'contain-blur') {
          return `split=2[bg][fg];` +
            `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=40,eq=brightness=-0.18:saturation=0.85[bgblur];` +
            `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgfit];` +
            `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,setsar=1`;
        }
        return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
      }

      // One ffmpeg pass over exactly one frame - milliseconds, even for the blurred landscape fit.
      function renderFittedFrame(srcPath: string, outPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(srcPath)
            .outputOptions(['-vf', buildFitFilter(), '-frames:v', '1'])
            .output(outPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
        });
      }

      const fittedMainPath = path.join(tempDir, 'fitted-main.png');
      await renderFittedFrame(imagePath, fittedMainPath);
      let fittedIntroPath: string | null = null;
      if (hasIntro && introImagePath) {
        fittedIntroPath = path.join(tempDir, 'fitted-intro.png');
        await renderFittedFrame(introImagePath, fittedIntroPath);
      }

      // Null when the encode needs no video filtering at all (the common single-image case with no
      // fade) - the already-fitted frame is then mapped straight through instead of being pushed
      // through a pointless filter graph.
      let filterComplex: string | null = null;
      let videoLabel = 'vcat';
      if (hasIntro) {
        filterComplex = `[0:v]fps=${fps}[introv];[1:v]fps=${fps}[mainv];[introv][mainv]concat=n=2:v=1:a=0[vcat]`;
      }

      // Decoded once and reused below for the fade in/out duration - best-effort polish, so a decode
      // failure (malformed audio) silently falls back to a plain fade-free video rather than failing
      // the request.
      let wav: { samples: Float32Array; sampleRate: number } | null = null;
      try {
        wav = decodeWavPcm16(audioBuffer);
      } catch (err: any) {
        console.warn('WAV decode failed, skipping fade:', err?.message || err);
      }

      // Fade in/out - the only camera-adjacent effect kept, replacing the removed Ken Burns zoom
      // (the word-by-word highlighter that used to render here was removed per explicit request -
      // see /api/align-captions above for the Whisper alignment it used to depend on, still used
      // elsewhere for TTS QA).
      let totalDuration: number | null = null;
      let fadeDur = 0;
      if (wav) {
        totalDuration = wav.samples.length / wav.sampleRate;
        const candidate = Math.min(0.5, totalDuration / 4);
        if (candidate > 0.05) fadeDur = candidate;
      }

      // Fast path for the ordinary case: one still poster, a fade at each end, no intro card.
      //
      // Two separate costs make the naive single-pass encode slow, and both only show up at length
      // (the Meditation Video's 90-120s reflection, not a Verse Video's few seconds):
      //   1. '-loop 1' on a PNG re-DECODES that PNG once per frame - thousands of full 1920x1080
      //      PNG decodes. Feeding the loop at '-framerate 1' instead decodes it ~1/30th as often and
      //      lets '-r' duplicate frames on the output side, which is nearly free.
      //   2. A fade filter in the graph forces every frame to be materialised and copied, which
      //      undoes (1) - even though the fade only actually changes the handful of frames inside
      //      its own half-second windows.
      // So the fade windows are encoded as their own short real-framerate segments, the long static
      // middle is encoded with no video filter at all, and the three are concatenated without
      // re-encoding. Same frames, same fade, a fraction of the work. Requires a known duration long
      // enough to hold both fades with a middle in between; anything else falls through to the
      // single-pass path below, which still benefits from the pre-fitted frame.
      const useSegmented = !hasIntro && totalDuration != null && fadeDur > 0 && totalDuration > fadeDur * 2 + 0.1;

      if (useSegmented && totalDuration != null) {
        const midDur = totalDuration - fadeDur * 2;
        const segmentOptions = [
          '-c:v libx264', '-tune stillimage', '-preset veryfast',
          `-r ${fps}`, '-pix_fmt yuv420p', '-an',
        ];
        // inputFps: the fade segments need real frames to ramp across, so they loop at the output
        // framerate. The middle has nothing changing, so it loops at 1fps and lets '-r' duplicate.
        const encodeSegment = (outPath: string, durationSec: number, inputFps: number, vf?: string) =>
          new Promise<void>((resolve, reject) => {
            ffmpeg()
              .input(fittedMainPath)
              .inputOptions(['-loop', '1', '-framerate', String(inputFps)])
              .outputOptions([...segmentOptions, '-t', durationSec.toFixed(3), ...(vf ? ['-vf', vf] : [])])
              .output(outPath)
              .on('end', () => resolve())
              .on('error', (err) => reject(err))
              .run();
          });

        const segIn = path.join(tempDir, 'seg-in.mp4');
        const segMid = path.join(tempDir, 'seg-mid.mp4');
        const segOut = path.join(tempDir, 'seg-out.mp4');
        await encodeSegment(segIn, fadeDur, fps, `fade=t=in:st=0:d=${fadeDur.toFixed(3)}`);
        await encodeSegment(segMid, midDur, 1);
        await encodeSegment(segOut, fadeDur, fps, `fade=t=out:st=0:d=${fadeDur.toFixed(3)}`);

        // All three came from the same source frame through the same encoder settings, so their
        // streams are concat-compatible and the video can be copied through rather than re-encoded.
        const concatListPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatListPath, [segIn, segMid, segOut].map((p) => `file '${p}'`).join('\n'));

        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(concatListPath).inputOptions(['-f', 'concat', '-safe', '0'])
            .input(audioPath)
            .outputOptions([
              '-c:v copy', '-c:a aac', '-b:a 192k', '-movflags faststart', '-shortest',
              '-t', totalDuration.toFixed(3), '-map', '0:v', '-map', '1:a',
            ])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run();
        });

        const videoBuffer = fs.readFileSync(outputPath);
        return res.json({ videoBase64: `data:video/mp4;base64,${videoBuffer.toString('base64')}`, success: true });
      }

      if (fadeDur > 0 && totalDuration != null) {
        const fadeOutStart = Math.max(0, totalDuration - fadeDur);
        const fadeExpr = `fade=t=in:st=0:d=${fadeDur.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDur.toFixed(3)}`;
        // With an intro there is already a graph to append to; without one this is the only filter
        // the encode needs, so it starts the graph from the looped still frame itself.
        filterComplex = filterComplex
          ? `${filterComplex};[${videoLabel}]${fadeExpr}[fadeout]`
          : `[0:v]${fadeExpr}[fadeout]`;
        videoLabel = 'fadeout';
      }

      const audioInputIndex = hasIntro ? 2 : 1;
      const outputOptions = [
        '-c:v libx264',
        '-tune stillimage',
        // x264's default preset is 'medium', which spends real time on motion estimation between
        // frames. There is no motion here - every frame is the same still poster apart from the
        // short fade - so that search finds nothing and only costs encode time. 'veryfast' produces
        // an effectively identical file for this content at a large speedup.
        '-preset veryfast',
        `-r ${fps}`,
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
        '-movflags faststart',
        '-shortest',
        // '-shortest' alone isn't reliable at trimming a looped still image to the audio's actual
        // length (observed padding the video several seconds past the audio in testing) - an
        // explicit '-t' pins the real duration whenever it's known from decoding the WAV above.
        ...(totalDuration != null ? ['-t', totalDuration.toFixed(3)] : []),
        ...(filterComplex
          ? ['-filter_complex', filterComplex, '-map', `[${videoLabel}]`]
          : ['-map', '0:v']),
        '-map', `${audioInputIndex}:a`,
      ];

      await new Promise<void>((resolve, reject) => {
        // Input order must match the numeric indices used in filterComplex/-map above: with an
        // intro, [0]=intro image, [1]=main poster, [2]=audio; without one, [0]=main poster,
        // [1]=audio (audioInputIndex tracks this exact split). These are the pre-fitted frames from
        // renderFittedFrame above, already at the exact output resolution, so nothing here needs
        // scaling, cropping or blurring again.
        const command = ffmpeg();
        if (hasIntro && fittedIntroPath) {
          command.input(fittedIntroPath).inputOptions(['-loop', '1', '-t', String(introDurationSec)]);
        }
        // With no video filter in play (no intro concat, no fade) nothing reads individual source
        // frames, so the still can be looped at 1fps and duplicated up to '-r' on the output side -
        // the same PNG-decode saving the segmented path above relies on. Any filter graph needs real
        // frames at the output rate, so those keep the default loop framerate.
        command.input(fittedMainPath).inputOptions(filterComplex ? ['-loop', '1'] : ['-loop', '1', '-framerate', '1']);
        command.input(audioPath);

        command
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      const videoBuffer = fs.readFileSync(outputPath);
      const videoBase64 = videoBuffer.toString('base64');

      res.json({
        videoBase64: `data:video/mp4;base64,${videoBase64}`,
        success: true
      });
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.warn('Error cleaning up temp directory:', err);
      }
    }
  } catch (error: any) {
    console.error('Error generating video:', error);
    res.status(500).json({ error: 'Failed to generate video: ' + error.message });
  }
});

// YouTube thumbnail generation moved client-side: components/posterRenderer.ts's renderThumbnail
// reuses the same canvas background treatment and smart text-placement search as the poster/hook
// card (this FFmpeg drawtext version could only draw text at a fixed position with no idea where
// the background was actually busy, and was never wired into the app UI to begin with).

// Vite or Static files serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    // YouTube -> Instagram auto-posting of videos once they turn public (no-op until configured).
    startInstagramSync();
  });
}

startServer();
