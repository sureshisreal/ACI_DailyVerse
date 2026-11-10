import fs from 'fs';
import path from 'path';
import { getDailyVerse } from './verse.service';
import { analyzeVerseWithClaude } from '../../ai/analyzer';
import { generateYouTubeMetadata, SERIES_DISPLAY_NAMES } from '../../ai/youtubeMetadata';
import { uploadVideoToYoutube, isYoutubeUploadConfigured, getYoutubeVideoStates } from './youtube.service';
import { postTimeForDate, upcomingPostTime } from '../utils/postTime';

// Browsing and publishing what previous runs already wrote to output/YYYY/MM/DD/<verse>/.
//
// Every other upload path in this app only reaches videos generated in the CURRENT browser session
// (see components/DailyVerseGenerator.tsx's VideoResult, which holds blob URLs that die with the
// page). That left a real backlog stranded: videos rendered days or weeks ago sit on disk with no
// way to publish them short of regenerating the whole verse. This service is the read-and-upload
// side of that backlog.
//
// Uploads run entirely server-side - the browser never re-downloads the video, it just names which
// file to publish - because shipping dozens of multi-megabyte MP4s through the page to upload them
// straight back out would be pointless.

const OUTPUT_DIR = path.join(process.cwd(), 'output');

export type LibraryVideoKind = 'short' | 'longform';

export interface LibraryVideo {
  file: string;
  kind: LibraryVideoKind;
  lang: 'en' | 'ta' | 'te';
  sizeBytes: number;
  // Present once this exact file has been uploaded - recorded back into the verse's manifest.json so
  // the state survives a restart and the same video is never published twice.
  uploaded?: { videoId: string; url: string; uploadedAt: string; publishAt?: string };
  // Same idea for Instagram (manifest.instagram, written by instagramSync.service.ts).
  instagram?: { permalink: string | null; postedAt: string };
  // A pending scheduled Instagram post (manifest.instagramScheduled) - see instagramSync.service.ts.
  instagramScheduled?: { at: string; lastError?: string; failed?: boolean };
  // Uploaded to the Facebook Page as a draft or natively scheduled post (manifest.facebook) - see
  // facebook.service.ts.
  facebook?: { videoId: string; url: string; state: 'draft' | 'scheduled'; scheduledFor?: string; uploadedAt: string };
}

// The still images a run produces alongside its videos: the two bilingual posters and the shared
// background they were composed over. Not uploadable to YouTube on their own - they are here to be
// looked at and downloaded, and the posters double as upload thumbnails (see POSTER_FOR_LANG).
export interface LibraryPoster {
  file: string;
  label: string;
  sizeBytes: number;
}

export interface LibraryEntry {
  dir: string;
  date: string;
  reference: string;
  // When this verse goes live on every channel: its date at SOCIAL_POST_TIME (see utils/postTime.ts).
  postAt: string | null;
  // WhatsApp Channel queue state for this verse's posters (manifest.whatsapp - see whatsapp.service.ts).
  whatsapp?: { at?: string; posted: string[] };
  videos: LibraryVideo[];
  posters: LibraryPoster[];
}

const LANG_PREFIX: Record<string, 'en' | 'ta' | 'te'> = { en: 'en', ta: 'ta', te: 'te' };

const POSTER_LABELS: Record<string, string> = {
  'tamil-english.png': 'Tamil + English poster',
  'telugu-english.png': 'Telugu + English poster',
  'background.png': 'Background',
};

// Which poster stands in as a video's YouTube thumbnail. The posters are bilingual (each pairs its
// language with English), so Tamil and Telugu match exactly; English has no poster of its own and
// borrows the Tamil+English one, which still carries the English verse.
const POSTER_FOR_LANG: Record<'en' | 'ta' | 'te', string[]> = {
  en: ['tamil-english.png', 'telugu-english.png'],
  ta: ['tamil-english.png'],
  te: ['telugu-english.png'],
};

// Videos are written by manifest.service.ts's saveGeneration as `<lang>-narration.mp4` /
// `<lang>-meditation.mp4`. Narration is the portrait 1080x1920 cut (the Shorts one); meditation is
// the landscape 1920x1080 cut.
//
// The second pattern is an older naming convention (`narration-tamil.mp4`) still sitting in a few
// early folders - matched too, because otherwise those videos are invisible in the library and there
// is no way to publish them at all.
function describeAsset(file: string): { kind: LibraryVideoKind; lang: 'en' | 'ta' | 'te' } | null {
  const modern = /^(en|ta|te)-(narration|meditation)\.mp4$/.exec(file);
  if (modern) {
    const lang = LANG_PREFIX[modern[1]];
    return lang ? { kind: modern[2] === 'narration' ? 'short' : 'longform', lang } : null;
  }

  const legacy = /^(narration|meditation)-(english|tamil|telugu)\.mp4$/.exec(file);
  if (legacy) {
    const byName: Record<string, 'en' | 'ta' | 'te'> = { english: 'en', tamil: 'ta', telugu: 'te' };
    const lang = byName[legacy[2]];
    if (!lang) return null;
    return { kind: legacy[1] === 'narration' ? 'short' : 'longform', lang };
  }

  return null;
}

function describePoster(file: string): LibraryPoster | null {
  const label = POSTER_LABELS[file];
  return label ? { file, label, sizeBytes: 0 } : null;
}

function readManifest(dirAbs: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirAbs, 'manifest.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// Resolves a caller-supplied relative dir against output/ and refuses anything that escapes it -
// this value arrives from an HTTP request, so '../../etc' must not be able to read or overwrite
// files outside the output tree.
function resolveEntryDir(dir: string): string {
  const abs = path.resolve(OUTPUT_DIR, dir);
  const root = path.resolve(OUTPUT_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Invalid library directory.');
  }
  return abs;
}

// Walks output/YYYY/MM/DD/<verse>/ for folders carrying a manifest, newest first. Folders whose
// manifest is missing or unreadable are skipped rather than failing the whole listing - a
// half-written folder from an interrupted run shouldn't hide the other 79.
export function listLibrary(): LibraryEntry[] {
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  const entries: LibraryEntry[] = [];
  const dirsOf = (p: string) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
  };

  for (const year of dirsOf(OUTPUT_DIR)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const month of dirsOf(path.join(OUTPUT_DIR, year))) {
      for (const day of dirsOf(path.join(OUTPUT_DIR, year, month))) {
        for (const slug of dirsOf(path.join(OUTPUT_DIR, year, month, day))) {
          const relDir = path.join(year, month, day, slug);
          const absDir = path.join(OUTPUT_DIR, relDir);
          const manifest = readManifest(absDir);
          if (!manifest) continue;

          const uploaded = manifest.youtube || {};
          const instagram = manifest.instagram || {};
          const instagramScheduled = manifest.instagramScheduled || {};
          const facebook = manifest.facebook || {};
          const videos: LibraryVideo[] = [];
          const posters: LibraryPoster[] = [];
          const sizeOf = (file: string) => {
            try { return fs.statSync(path.join(absDir, file)).size; } catch { return 0; }
          };

          for (const file of fs.readdirSync(absDir)) {
            const described = describeAsset(file);
            if (described) {
              const posted = instagram[file];
              const scheduled = instagramScheduled[file];
              videos.push({
                file,
                ...described,
                sizeBytes: sizeOf(file),
                uploaded: uploaded[file],
                instagram: posted ? { permalink: posted.permalink ?? null, postedAt: posted.postedAt } : undefined,
                instagramScheduled: scheduled && !posted
                  ? { at: scheduled.at, lastError: scheduled.lastError, failed: scheduled.failed }
                  : undefined,
                facebook: facebook[file],
              });
              continue;
            }
            const poster = describePoster(file);
            if (poster) posters.push({ ...poster, sizeBytes: sizeOf(file) });
          }
          // Kept when a verse has posters but no videos: most of this tree is poster-only runs, and
          // dropping them hid the majority of what has actually been generated.
          if (!videos.length && !posters.length) continue;

          videos.sort((a, b) => (a.kind === b.kind ? a.lang.localeCompare(b.lang) : a.kind === 'short' ? -1 : 1));
          posters.sort((a, b) => a.file.localeCompare(b.file));
          const date = manifest.date || `${year}-${month}-${day}`;
          entries.push({
            dir: relDir.split(path.sep).join('/'),
            date,
            reference: manifest.reference || slug,
            postAt: (upcomingPostTime(date) ?? postTimeForDate(date))?.toISOString() ?? null,
            ...(manifest.whatsapp
              ? { whatsapp: { at: manifest.whatsapp.at, posted: Object.keys(manifest.whatsapp.posted || {}) } }
              : {}),
            videos,
            posters,
          });
        }
      }
    }
  }

  entries.sort((a, b) => (a.date === b.date ? a.reference.localeCompare(b.reference) : b.date.localeCompare(a.date)));
  return entries;
}

// Resolves one asset inside the output tree for serving back to the browser (poster previews and
// downloads). Only the exact filenames this module already recognises are reachable - the same
// allowlist the listing uses - so this can't be turned into a general file reader.
export function resolveLibraryAsset(dir: string, file: string): { absPath: string; contentType: string } {
  const isVideo = Boolean(describeAsset(file));
  const isPoster = Boolean(describePoster(file));
  if (!isVideo && !isPoster) throw new Error(`Not a library asset: ${file}`);

  const absPath = path.join(resolveEntryDir(dir), file);
  if (!fs.existsSync(absPath)) throw new Error(`Not found: ${file}`);
  return { absPath, contentType: isVideo ? 'video/mp4' : 'image/png' };
}

// The verse date of a library folder: manifest.date, else the YYYY/MM/DD it sits under.
export function libraryEntryDate(dir: string): string {
  const dirAbs = resolveEntryDir(dir);
  const fromManifest = readManifest(dirAbs)?.date;
  if (fromManifest) return fromManifest;
  const [year, month, day] = path.relative(OUTPUT_DIR, dirAbs).split(path.sep);
  return `${year}-${month}-${day}`;
}

function recordUpload(dirAbs: string, file: string, result: { videoId: string; url: string; publishAt?: string }): void {
  const manifestPath = path.join(dirAbs, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.youtube = manifest.youtube || {};
    manifest.youtube[file] = {
      videoId: result.videoId, url: result.url, uploadedAt: new Date().toISOString(),
      ...(result.publishAt ? { publishAt: result.publishAt } : {}),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err: any) {
    // The upload itself already succeeded; failing to note it must not turn into a failed request.
    console.warn('Could not record upload in manifest:', err?.message || err);
  }
}

// Errors that make every FOLLOWING upload pointless too, as opposed to ones that only spoil this
// video. The daily quota is the one that actually bites: a YouTube upload costs ~1600 quota units
// against a default allowance of 10,000 per day, so a channel can publish roughly six videos a day.
// Run a backlog of ninety and the seventh onwards all fail identically - and without this
// distinction the client would keep marching through the remaining eighty, spending a Claude call on
// a title for each one before hitting the same wall.
const FATAL_REASONS = new Set([
  'quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded', 'rateLimitExceeded',
  'userRateLimitExceeded', 'authError', 'forbidden', 'insufficientPermissions',
]);

export class LibraryUploadError extends Error {
  fatal: boolean;
  reason?: string;
  constructor(message: string, fatal: boolean, reason?: string) {
    super(message);
    this.fatal = fatal;
    this.reason = reason;
  }
}

function classifyUploadError(err: any): LibraryUploadError {
  const apiError = err?.response?.data?.error ?? err?.errors?.[0] ?? err;
  const reason: string | undefined = apiError?.errors?.[0]?.reason ?? apiError?.reason;
  const status: number | undefined = err?.code ?? err?.response?.status;
  const message: string = apiError?.message || err?.message || 'Upload failed.';

  if (reason && FATAL_REASONS.has(reason)) {
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'uploadLimitExceeded') {
      return new LibraryUploadError(
        `YouTube daily upload quota reached (${reason}). A YouTube upload costs ~1600 of the default 10,000 units per day, so only about six videos can be published in 24 hours. The rest can be uploaded tomorrow, or request a quota increase in Google Cloud.`,
        true,
        reason,
      );
    }
    return new LibraryUploadError(message, true, reason);
  }

  // An expired or revoked refresh token fails every subsequent call the same way.
  if (status === 401 || /invalid_grant|invalid_client|deleted_client/i.test(message)) {
    return new LibraryUploadError(`YouTube authorization failed (${message}). Re-run scripts/youtube_authorize.ts.`, true, 'authError');
  }

  return new LibraryUploadError(message, false, reason);
}

const VERSE_TEXT_FOR: Record<'en' | 'ta' | 'te', (v: any) => { text: string; reference: string } | null> = {
  en: (v) => (v.english ? { text: v.english.text, reference: v.english.reference } : null),
  ta: (v) => (v.tamil ? { text: v.tamil.text, reference: v.tamil.reference } : null),
  te: (v) => (v.telugu ? { text: v.telugu.text, reference: v.telugu.reference } : null),
};

// Title/description for one verse in one language - the same Claude-written metadata a fresh upload
// gets. Also used for Instagram captions of videos that never went to YouTube.
export async function generateLibraryMetadata(reference: string, lang: 'en' | 'ta' | 'te') {
  const verse = getDailyVerse(reference);
  const langText = VERSE_TEXT_FOR[lang](verse);
  if (!langText) throw new Error(`No ${lang} verse text available for ${reference}.`);

  const analysis = await analyzeVerseWithClaude(
    reference,
    verse.english?.text || '',
    verse.tamil?.text || '',
    verse.telugu?.text || '',
  );
  if (!analysis.viewerSituation || !analysis.emotionalHook) {
    throw new Error('Verse analysis produced no viewer situation / hook to write a title from.');
  }

  return generateYouTubeMetadata(
    langText.reference,
    langText.text,
    lang,
    analysis.viewerSituation,
    analysis.emotionalHook,
    reference,
  );
}

// Which language a library video file is in, or null if it isn't a recognised video.
export function libraryVideoLang(file: string): 'en' | 'ta' | 'te' | null {
  return describeAsset(file)?.lang ?? null;
}

// Caption for posting a library video to Instagram / Facebook: the video's current YouTube title +
// description if it was uploaded there (so edits made in YouTube Studio carry over), otherwise the
// same Claude-written metadata a YouTube upload would get.
export async function buildLibraryCaption(dir: string, file: string): Promise<{ caption: string; title: string; youtubeVideoId?: string }> {
  const lang = libraryVideoLang(file);
  if (!lang) throw new Error(`Not a library video: ${file}`);
  const manifest = readManifest(resolveEntryDir(dir)) || {};
  const youtubeVideoId: string | undefined = manifest.youtube?.[file]?.videoId;
  if (youtubeVideoId && isYoutubeUploadConfigured()) {
    const yt = (await getYoutubeVideoStates([youtubeVideoId]).catch(() => new Map())).get(youtubeVideoId);
    if (yt) return { caption: [yt.title, yt.description].filter(Boolean).join('\n\n'), title: yt.title, youtubeVideoId };
  }
  if (!manifest.reference) throw new Error('Manifest has no verse reference to write a caption from.');
  const metadata = await generateLibraryMetadata(manifest.reference, lang);
  return { caption: [metadata.title, metadata.description].filter(Boolean).join('\n\n'), title: metadata.title, youtubeVideoId };
}

// Whether a library video file is a portrait Short or a landscape long-form video.
export function libraryVideoKind(file: string): LibraryVideoKind | null {
  return describeAsset(file)?.kind ?? null;
}

// Publishes one previously generated file. Title/description are regenerated rather than stored,
// because manifests written before this feature existed never recorded them - but both Claude steps
// are disk-cached (cache/analysis, cache/youtube-metadata), so a verse whose metadata was already
// produced once costs nothing to publish now.
//
// The custom 16:9 thumbnail is drawn on a browser canvas (posterRenderer.ts's renderThumbnail) and
// can't be produced here, so the verse's bilingual poster is used instead (see below).
//
// Goes up private, scheduled by YouTube to go public at the verse's date (upcomingPostTime) unless
// `publishAt` overrides it; a verse whose date has passed stays private.
export async function uploadLibraryVideo(dir: string, file: string, publishAt?: Date | null): Promise<{
  videoId: string; url: string; title: string; seriesLabel: string; warnings: string[]; publishAt?: string;
}> {
  const described = describeAsset(file);
  if (!described) throw new Error(`Not an uploadable video file: ${file}`);

  const dirAbs = resolveEntryDir(dir);
  const videoPath = path.join(dirAbs, file);
  if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${file}`);

  const manifest = readManifest(dirAbs);
  if (!manifest?.reference) throw new Error('Manifest missing or has no verse reference.');

  if (manifest.youtube?.[file]?.videoId) {
    throw new Error(`Already uploaded to YouTube (${manifest.youtube[file].url}).`);
  }

  const metadata = await generateLibraryMetadata(manifest.reference, described.lang);
  // Resolved from the same fixed lookup the /verse/youtube-metadata route uses, so a backlog upload
  // lands in exactly the playlist a freshly generated one would.
  const seriesLabel = SERIES_DISPLAY_NAMES[metadata.seriesKey][described.lang];

  // The bilingual poster this verse already rendered, reused as the video's thumbnail. The proper
  // thumbnail renderer (posterRenderer.ts's renderThumbnail) draws on a browser canvas and can't run
  // here, so without this a backlog upload would leave YouTube to pick an arbitrary frame.
  let thumbnailBuffer: Buffer | undefined;
  for (const candidate of POSTER_FOR_LANG[described.lang]) {
    const posterPath = path.join(dirAbs, candidate);
    if (fs.existsSync(posterPath)) {
      thumbnailBuffer = fs.readFileSync(posterPath);
      break;
    }
  }

  const goLive = publishAt === undefined ? upcomingPostTime(libraryEntryDate(dir)) : publishAt;
  let result;
  try {
    result = await uploadVideoToYoutube({
      videoBuffer: fs.readFileSync(videoPath),
      title: metadata.title,
      description: metadata.description,
      privacyStatus: 'private',
      publishAt: goLive ?? undefined,
      playlistTitle: seriesLabel,
      thumbnailBuffer,
    });
  } catch (err: any) {
    throw classifyUploadError(err);
  }

  const scheduled = goLive?.toISOString();
  recordUpload(dirAbs, file, { videoId: result.videoId, url: result.videoUrl, publishAt: scheduled });
  return { videoId: result.videoId, url: result.videoUrl, title: metadata.title, seriesLabel, warnings: result.warnings, publishAt: scheduled };
}
