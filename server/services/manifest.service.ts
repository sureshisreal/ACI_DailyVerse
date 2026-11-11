import fs from 'fs';
import path from 'path';
import type { VerseAnalysis } from '../../types';
import { sha256 } from '../utils/hash';
import { CLAUDE_ANALYZER_VERSION } from '../../ai/schema';
import { IMAGE_GENERATOR_VERSION } from './image-generation.service';
import { upcomingPostTime } from '../utils/postTime';

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const HISTORY_FILE = path.join(OUTPUT_DIR, 'history.json');

// Provenance markers for the narration/video pipeline in server.ts (audio synthesis, Whisper
// caption alignment, FFmpeg video assembly) - recorded into the manifest below for
// reproducibility/debugging, same idea as CLAUDE_ANALYZER_VERSION/IMAGE_GENERATOR_VERSION, but not
// tied to an actual disk cache (TTS and video are always generated fresh per request) - bump
// manually whenever that logic changes materially, so a manifest visibly shows what produced it.
export const TTS_VERSION = 4; // Piper devotional pacing; Tamil is Indic-Parler only now (single voice, no MMS-TTS fallback, per explicit request), QA-gated with retry; v4 softened the Tamil voice description toward a gentler, more comforting delivery
export const ALIGNMENT_VERSION = 1; // Whisper-tiny word-level alignment, used for /api/align-captions and TTS completeness/degeneracy QA
export const VIDEO_VERSION = 4; // 4: landscape meditation frame (title block + poster card), silence around narration, 0.8s fades. 3: static frame + fade in/out, optional hook-card intro (no Ken Burns zoom, no word-by-word highlighter - removed per explicit request)

type VideoLang = 'english' | 'tamil' | 'telugu';

function slugify(reference: string): string {
  return reference.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function base64ToBuffer(base64: string): Buffer {
  const stripped = base64.startsWith('data:') ? base64.replace(/^data:[^,]+,/, '') : base64;
  return Buffer.from(stripped, 'base64');
}

export interface SaveGenerationRequest {
  date: string; // YYYY-MM-DD
  reference: string;
  verses: { english: string; tamil: string; telugu: string };
  analysis: VerseAnalysis;
  // Poster assets - all optional so a video/meditation-only save (Poster unchecked) doesn't require
  // them; a poster save still provides all three together, exactly as before.
  backgroundImageBase64?: string;
  tamilEnglishPosterBase64?: string;
  teluguEnglishPosterBase64?: string;
  // Where the background came from (see /verse/analyze's imageSource): 'stock' means an unrelated
  // Picsum photo used during an image-service outage. Sent with poster saves only.
  imageProvider?: 'pollinations' | 'stock';
  // Narration Video / Meditation Video MP4s, one per language actually generated. Written alongside
  // whatever poster assets exist (or entirely on their own) and merged into the same manifest.json -
  // see the merge behavior in saveGeneration below, since poster and video/meditation generation
  // finish at very different times and shouldn't block on each other to get persisted.
  videos?: Partial<Record<VideoLang, string>>;
  meditations?: Partial<Record<VideoLang, string>>;
  // Per-language failure reasons for the videos/meditations above - the actual error (e.g. an
  // Indic-Parler timeout, a degenerate-output retry exhaustion) previously only ever lived in
  // transient React state on the client and was lost the moment the tab closed, leaving the
  // manifest's silently-missing asset as the only trace. Recorded here (keyed the same way as
  // `assets`, e.g. "ta-meditation") so a failure is diagnosable after the fact instead of just
  // absent.
  videoErrors?: Partial<Record<VideoLang, string>>;
  meditationErrors?: Partial<Record<VideoLang, string>>;
}

export interface HistoryEntry {
  date: string;
  reference: string;
  status: 'completed' | 'failed';
  path: string;
}

function readManifest(outputDir: string): any | null {
  try {
    const file = path.join(outputDir, 'manifest.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// Additive: a poster save and a later video/meditation save (they finish at different times, and
// either can happen without the other depending on which checkboxes were on) both write into the
// same manifest.json, each only ever adding to `assets`/`versions` rather than one overwriting what
// the other already recorded.
export function saveGeneration(req: SaveGenerationRequest): { outputDir: string; manifest: any } {
  const [year, month, day] = req.date.split('-');
  const slug = slugify(req.reference);
  const relativeDir = path.join(year, month, day, slug);
  const outputDir = path.join(OUTPUT_DIR, relativeDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const existing = readManifest(outputDir);
  const assets = new Set<string>(existing?.assets || []);
  const versions: Record<string, number | string> = { ...(existing?.versions || {}) };
  const errors: Record<string, string> = { ...(existing?.errors || {}) };

  const hasPosterAssets = req.backgroundImageBase64 && req.tamilEnglishPosterBase64 && req.teluguEnglishPosterBase64;
  if (hasPosterAssets) {
    fs.writeFileSync(path.join(outputDir, 'background.png'), base64ToBuffer(req.backgroundImageBase64!));
    fs.writeFileSync(path.join(outputDir, 'tamil-english.png'), base64ToBuffer(req.tamilEnglishPosterBase64!));
    fs.writeFileSync(path.join(outputDir, 'telugu-english.png'), base64ToBuffer(req.teluguEnglishPosterBase64!));
    ['background.png', 'tamil-english.png', 'telugu-english.png'].forEach((f) => assets.add(f));
    versions.claudeAnalyzer = CLAUDE_ANALYZER_VERSION;
    versions.imageGenerator = IMAGE_GENERATOR_VERSION;
  }

  for (const [lang, base64] of Object.entries(req.videos || {})) {
    if (!base64) continue;
    const filename = `${lang}-narration.mp4`;
    fs.writeFileSync(path.join(outputDir, filename), base64ToBuffer(base64));
    assets.add(filename);
    delete errors[`${lang}-narration`]; // a later successful save supersedes any earlier failure recorded for this asset
    versions.tts = TTS_VERSION;
    versions.alignment = ALIGNMENT_VERSION;
    versions.video = VIDEO_VERSION;
  }

  for (const [lang, base64] of Object.entries(req.meditations || {})) {
    if (!base64) continue;
    const filename = `${lang}-meditation.mp4`;
    fs.writeFileSync(path.join(outputDir, filename), base64ToBuffer(base64));
    assets.add(filename);
    delete errors[`${lang}-meditation`];
    versions.tts = TTS_VERSION;
    versions.alignment = ALIGNMENT_VERSION;
    versions.video = VIDEO_VERSION;
  }

  for (const [lang, message] of Object.entries(req.videoErrors || {})) {
    if (message) errors[`${lang}-narration`] = message;
  }
  for (const [lang, message] of Object.entries(req.meditationErrors || {})) {
    if (message) errors[`${lang}-meditation`] = message;
  }

  const verseHash = sha256(`${req.verses.english}|${req.verses.tamil}|${req.verses.telugu}`);
  const analysisHash = sha256(JSON.stringify(req.analysis));

  // A verse generated with posters for an upcoming date goes into the WhatsApp Channel queue for that
  // date automatically (see whatsapp.service.ts); an existing schedule is left as it is.
  const whatsappAt = hasPosterAssets && !existing?.whatsapp ? upcomingPostTime(req.date) : null;

  // Everything else a previous save or upload recorded (youtube, instagram, facebook, whatsapp, ...)
  // is carried over - rebuilding the manifest from scratch used to drop those records, so a re-saved
  // verse looked never-uploaded and could be published a second time.
  const { errors: _previousErrors, ...carried } = existing || {};
  const manifest = {
    ...carried,
    ...(whatsappAt ? { whatsapp: { at: whatsappAt.toISOString(), scheduledAt: new Date().toISOString() } } : {}),
    reference: req.reference,
    date: req.date,
    verseHash,
    analysisHash,
    versions,
    imageProvider: req.imageProvider ?? existing?.imageProvider ?? 'pollinations',
    analysisProvider: req.analysis.provider,
    assets: Array.from(assets).sort(),
    // Only present when something has actually failed - keeps the common all-succeeded manifest
    // exactly as before rather than always carrying an empty `errors: {}`.
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
    status: 'completed'
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  upsertHistory({ date: req.date, reference: req.reference, status: 'completed', path: relativeDir.split(path.sep).join('/') });

  return { outputDir, manifest };
}

function readHistory(): HistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function upsertHistory(entry: HistoryEntry): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const history = readHistory();
  const idx = history.findIndex((h) => h.date === entry.date && h.reference === entry.reference);
  if (idx >= 0) history[idx] = entry;
  else history.unshift(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export function getHistory(): HistoryEntry[] {
  return readHistory();
}

// Records a YouTube upload made from the generator screen against the saved copy of that video
// (manifest.youtube[file]) - the same record the library's own uploads write. The Instagram sync
// relies on it to find which local file to post once the YouTube video goes public. Best-effort: a
// missing folder/manifest just means nothing is recorded; it never fails the upload itself.
// Returns the library dir (output-relative) it recorded into, or null.
export function recordYoutubeUploadFor(date: string, reference: string, file: string, result: { videoId: string; url: string; publishAt?: string }): string | null {
  if (!/^[a-z]{2}-(narration|meditation)\.mp4$/.test(file) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-');
  const outputDir = path.join(OUTPUT_DIR, year, month, day, slugify(reference));
  const manifest = readManifest(outputDir);
  if (!manifest) return null;
  manifest.youtube = manifest.youtube || {};
  manifest.youtube[file] = {
    videoId: result.videoId, url: result.url, uploadedAt: new Date().toISOString(),
    ...(result.publishAt ? { publishAt: result.publishAt } : {}),
  };
  try {
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (err: any) {
    console.warn('Could not record YouTube upload in manifest:', err?.message || err);
    return null;
  }
  return path.relative(OUTPUT_DIR, outputDir).split(path.sep).join('/');
}
