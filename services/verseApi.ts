import type { PosterDesign, VerseAnalysis } from '../types';

export interface VerseResult {
  text: string;
  reference: string;
}

export interface DailyVerse {
  reference: string;
  english: VerseResult | null;
  tamil: VerseResult | null;
  telugu: VerseResult | null;
}

export interface AnalyzeResult {
  analysis: VerseAnalysis;
  backgroundImageBase64: string;
  contentType: string;
  cached: boolean;
  // 'stock': the image service was down and this is an unrelated stock photo - see the server's
  // /verse/analyze.
  imageSource?: 'pollinations' | 'stock';
}

export interface ImageServiceStatus {
  available: boolean;
}

// Thrown on a non-2xx response. `data` carries the parsed error body (e.g. verse/analyze still
// returns a valid `analysis` alongside the error when Claude succeeded but image generation
// failed), so callers can tell a partial failure from a total one instead of losing that detail to
// a bare message.
export class ApiError extends Error {
  data: any;
  constructor(message: string, data: any) {
    super(message);
    this.data = data;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  // __httpStatus: the server's real status when a keep-alive already committed a 200 for a slow
  // request (see server/utils/keepAliveJson.ts).
  const status = typeof data.__httpStatus === 'number' ? data.__httpStatus : response.status;
  if (!response.ok || status >= 400) {
    throw new ApiError(data.error || `HTTP error! status: ${status}`, data);
  }
  return data;
}

// Step 1: exact English/Tamil/Telugu verse text from the local SQLite Bible databases. No AI.
export function lookupVerse(reference: string): Promise<DailyVerse> {
  return postJson<DailyVerse>('/api/verse/lookup', { reference });
}

// Step 2: Claude analysis (cached) -> ONE background image via Pollinations.ai (cached), shared by
// Poster, Video, and Meditation alike (see components/DailyVerseGenerator.tsx) - one Claude call and
// one Pollinations call per verse regardless of how many of the three outputs are requested.
// forceRegenerate (the "Regenerate image" action) keeps the same cached Claude analysis - same
// theme/concept/color-grade assignment for this verse - but skips the image cache so a brand new
// Pollinations photo is generated and replaces the cached one for this verse, for all three outputs.
export function analyzeAndGenerateBackground(
  reference: string,
  english: string,
  tamil: string,
  telugu: string,
  forceRegenerate?: boolean
): Promise<AnalyzeResult> {
  return postJson<AnalyzeResult>('/api/verse/analyze', { reference, english, tamil, telugu, forceRegenerate });
}

export interface VersePortion {
  decision: 'full' | 'portion';
  english: string;
  tamil: string;
  telugu: string;
  reason: string;
}

export interface VersePortionResult {
  portion: VersePortion;
}

// How much of the verse the poster shows (see ai/versePortionSelector.ts): a shorter portion only
// when it's a complete, meaning-preserving thought in English AND Tamil AND Telugu at once,
// otherwise the full verse in all three - never a shorter portion in only some languages. Never
// rejects: on any failure the server resolves to the full verse, so this call always resolves.
export function selectVersePortion(
  reference: string,
  english: string,
  tamil: string,
  telugu: string
): Promise<VersePortionResult> {
  return postJson<VersePortionResult>('/api/verse/portion', { reference, english, tamil, telugu });
}

export interface SaveGenerationPayload {
  date: string;
  reference: string;
  verses: { english: string; tamil: string; telugu: string };
  analysis: VerseAnalysis;
  // Poster assets - all three together, or omit all three (a video/meditation-only save). See
  // server/services/manifest.service.ts's saveGeneration for the merge behavior: a poster save and
  // a later video/meditation save both write into the same manifest.json.
  backgroundImageBase64?: string;
  tamilEnglishPosterBase64?: string;
  teluguEnglishPosterBase64?: string;
  imageProvider?: 'pollinations' | 'stock';
  videos?: Partial<Record<'english' | 'tamil' | 'telugu', string>>;
  meditations?: Partial<Record<'english' | 'tamil' | 'telugu', string>>;
  // Per-language failure reasons, recorded into the manifest even when some/all languages fail -
  // see server/services/manifest.service.ts's saveGeneration.
  videoErrors?: Partial<Record<'english' | 'tamil' | 'telugu', string>>;
  meditationErrors?: Partial<Record<'english' | 'tamil' | 'telugu', string>>;
}

export function saveGeneration(payload: SaveGenerationPayload): Promise<{ success: boolean; outputDir: string; manifest: any }> {
  return postJson('/api/verse/save', payload);
}

export async function getImageServiceStatus(): Promise<ImageServiceStatus> {
  const response = await fetch('/api/image-service/status');
  if (!response.ok) {
    throw new Error(`Failed to check image service status: ${response.status}`);
  }
  return response.json();
}

export interface VerseAudioResult {
  // Raw 16-bit PCM mono @ 24kHz, base64-encoded (server.ts's fixed narration format) - not a
  // playable file by itself, needs a WAV/container header added before use (see
  // components/wavEncoder.ts). Null when no local TTS voice is available for this text's language.
  audioBase64: string | null;
  provider?: string;
  error?: string;
  // When each word is spoken (seconds from the start of the audio) - provided by the Edge voices;
  // drives the video's reading highlighter. Absent for the local engines (see alignCaptions).
  words?: { text: string; start: number; end: number }[];
}

// Local, offline narration (Piper for English/Telugu, MMS-TTS/Indic Parler-TTS for Tamil) - reads
// `text` aloud in whichever script it's written in. `reference` is optional: given, a spoken
// citation is appended (verse-reading use case); omitted, `text` is narrated as-is (e.g. meditation
// explanation/prayer text, which has no single verse reference of its own). See server.ts's
// /api/verse-audio handler.
export function synthesizeVerseAudio(text: string, reference?: string): Promise<VerseAudioResult> {
  return postJson<VerseAudioResult>('/api/verse-audio', { text, reference });
}

export interface VideoGenerateResult {
  success: boolean;
  videoBase64: string; // data:video/mp4;base64,...
}

// FFmpeg narration video (one background image + one narration audio track), static (no Ken Burns
// zoom) plus a short fade in/out - see server.ts's /api/video/generate handler. Previously also
// burned in a word-by-word highlighter lighting up each verse word's on-poster position in sync
// with the narration - removed per explicit request.
//
// introImageBase64/introDurationSec are the Verse Video's opening hook card (see
// components/posterRenderer.ts's renderHookCard) - shown for introDurationSec while the audio
// speaks the hook+reference, before this image takes over for the verse reading. Both optional:
// omitting them (Meditation Video, or any caller that doesn't want a hook) reproduces the exact
// prior single-image behavior.
export function generateNarrationVideo(
  imageBase64: string,
  audioBase64: string,
  opts?: {
    width?: number; height?: number; fps?: number;
    introImageBase64?: string; introDurationSec?: number;
    // 'cover' (default): scale-to-fill-and-crop, correct when imageBase64 already matches
    // width/height's aspect ratio. 'contain-blur': fit the whole image inside the frame with no
    // cropping, filling the leftover bars with a blurred cover-fit copy of the same image - for a
    // target aspect ratio that doesn't match the source (e.g. the Meditation Video's 1920x1080
    // landscape canvas around posterRenderer.ts's always-portrait 1080x1920 poster). See
    // server.ts's /api/video/generate handler for the actual filter chain.
    fitMode?: 'cover' | 'contain-blur';
    // Reading highlighter - see components/wordHighlight.ts and server.ts's parseHighlight.
    highlight?: {
      layerImagesBase64: string[];
      words: { x: number; y: number; w: number; h: number; layer: number; start: number; end: number }[];
    };
  }
): Promise<VideoGenerateResult> {
  return postJson<VideoGenerateResult>('/api/video/generate', {
    imageBase64,
    audioBase64,
    width: opts?.width ?? 1080,
    height: opts?.height ?? 1920,
    fps: opts?.fps ?? 30,
    introImageBase64: opts?.introImageBase64,
    introDurationSec: opts?.introDurationSec,
    fitMode: opts?.fitMode ?? 'cover',
    highlight: opts?.highlight,
  });
}

// Word timings for narration audio from an engine that doesn't report them (the local Piper /
// Indic-Parler voices) - Whisper alignment against the given text, server-side.
export function alignCaptions(audioBase64: string, text: string, lang: 'en' | 'ta' | 'te'): Promise<{ words: { text: string; start: number; end: number }[] }> {
  return postJson('/api/align-captions', { audioBase64, text, lang });
}

export interface MeditationText {
  explanation: string;
  prayer: string;
}

export interface MeditationResult {
  meditation: { en: MeditationText; ta: MeditationText; te: MeditationText };
}

// Devotional meditation (explanation + prayer, warm/universal/non-judgmental tone - see
// ai/meditation.ts) for one verse, in all three languages at once. No static fallback: a failure
// here is a real error, not something to silently paper over with placeholder devotional prose.
export function generateMeditationContent(
  reference: string,
  english: string,
  tamil: string,
  telugu: string
): Promise<MeditationResult> {
  return postJson<MeditationResult>('/api/verse/meditation', { reference, english, tamil, telugu });
}

export interface AdjustMeditationResult {
  meditation: MeditationText;
}

// Runtime-enforcement step for the Meditation Video (target: 120-180s total) - see
// runMeditationGeneration in DailyVerseGenerator.tsx, which measures the actual synthesized verse+
// explanation+prayer audio and calls this to rewrite just one language's text toward a target word
// count when the total falls outside that range. See ai/meditation.ts's adjustMeditationLength.
export function adjustMeditationLength(
  reference: string,
  verseText: string,
  lang: 'en' | 'ta' | 'te',
  priorExplanation: string,
  priorPrayer: string,
  targetTotalWords: number
): Promise<AdjustMeditationResult> {
  return postJson<AdjustMeditationResult>('/api/verse/meditation/adjust', {
    reference, verseText, lang, priorExplanation, priorPrayer, targetTotalWords
  });
}

export type SeriesKey = 'morning' | 'night' | 'anxiety' | 'strength' | 'family' | 'general';

export interface YouTubeMetadata {
  title: string;
  thumbnailText: string;
  description: string;
  seriesKey: SeriesKey;
}

export interface YouTubeMetadataResult {
  metadata: YouTubeMetadata;
  // Localized display name for metadata.seriesKey, resolved server-side (see
  // ai/youtubeMetadata.ts's SERIES_DISPLAY_NAMES) - not AI-generated, kept out of the client bundle.
  seriesLabel: string;
}

// Upload metadata (title/thumbnail text/description/series) for one verse's video in one language -
// see ai/youtubeMetadata.ts. Call once a Video or Meditation is actually being generated for that
// language, using the same viewerSituation/emotionalHook already produced by analyzeAndGenerateBackground.
// canonicalReference is the language-independent verse identity (e.g. "Psalm 23:1", the same string
// for all three languages' calls) - kept separate from `reference` (that language's localized book
// name) so the server caches all three languages' metadata for one verse in a single file.
export function generateYouTubeMetadata(
  reference: string,
  verseText: string,
  lang: 'en' | 'ta' | 'te',
  viewerSituation: string,
  emotionalHook: string,
  canonicalReference: string
): Promise<YouTubeMetadataResult> {
  return postJson<YouTubeMetadataResult>('/api/verse/youtube-metadata', {
    reference, verseText, lang, viewerSituation, emotionalHook, canonicalReference
  });
}

// Whether the server has YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN configured (see
// scripts/youtube_authorize.ts) - drives whether the "Upload to YouTube" action is shown at all.
export async function getYoutubeUploadStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/youtube/status');
  if (!response.ok) throw new Error(`Failed to check YouTube upload status: ${response.status}`);
  return response.json();
}

// YouTube -> Instagram auto-posting (server/services/instagramSync.service.ts): videos uploaded to
// YouTube are posted to Instagram as Reels once they turn public there.
export interface InstagramSyncStatus {
  instagramConfigured: boolean;
  youtubeConfigured: boolean;
  intervalMinutes: number;
  enabledSince: string | null;
  lastRunAt: string | null;
  lastSummary: string | null;
  recentPosts: { reference: string; file: string; permalink: string | null; postedAt: string }[];
  scheduled: { reference: string; dir: string; file: string; at: string; lastError?: string; failed?: boolean }[];
}

export async function getInstagramSyncStatus(): Promise<InstagramSyncStatus> {
  const response = await fetch('/api/instagram/status');
  if (!response.ok) throw new Error(`Failed to check Instagram status: ${response.status}`);
  return response.json();
}

export function runInstagramSync(): Promise<{ ran: boolean; summary: string }> {
  return postJson('/api/instagram/sync', {});
}

export interface YoutubeUploadResult {
  videoId: string;
  videoUrl: string;
  playlistId?: string;
  warnings: string[];
  // Set when the upload was scheduled for the verse's date (Instagram + Facebook follow it too).
  publishAt?: string;
}

// Publishes one already-generated video straight to the channel via the YouTube Data API (see
// server/services/youtube.service.ts) - videoBase64/thumbnailBase64 are the same bytes already
// sitting in the browser as blob URLs (see VideoResult in DailyVerseGenerator.tsx), re-encoded once
// for this call. playlistTitle, if given, creates/reuses a playlist of that exact name and adds the
// video to it - this is what turns the existing seriesLabel text into a real, browsable playlist.
export function uploadToYoutube(params: {
  videoBase64: string;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
  thumbnailBase64?: string;
  playlistTitle?: string;
  // The saved copy under output/ - lets the server record this upload in that verse's manifest.
  output?: { date: string; reference: string; file: string };
}): Promise<YoutubeUploadResult> {
  return postJson<YoutubeUploadResult>('/api/youtube/upload', params);
}

// --- Library: previously generated videos sitting in output/ ---

export interface LibraryVideo {
  file: string;
  kind: 'short' | 'longform';
  lang: 'en' | 'ta' | 'te';
  sizeBytes: number;
  // publishAt = YouTube's scheduled go-live (the video stays private until then).
  uploaded?: { videoId: string; url: string; uploadedAt: string; publishAt?: string };
  instagram?: { permalink: string | null; postedAt: string };
  instagramScheduled?: { at: string; lastError?: string; failed?: boolean };
  facebook?: { videoId: string; url: string; state: 'draft' | 'scheduled'; scheduledFor?: string; uploadedAt: string };
}

export interface LibraryPoster {
  file: string;
  label: string;
  sizeBytes: number;
}

export interface LibraryEntry {
  dir: string;
  date: string;
  reference: string;
  // Go-live time on every channel: the verse's date at the server's SOCIAL_POST_TIME.
  postAt: string | null;
  whatsapp?: { at?: string; posted: string[] };
  videos: LibraryVideo[];
  posters: LibraryPoster[];
}

// URL for one poster/video straight out of output/ - used for poster previews and download links.
export function libraryFileUrl(dir: string, file: string): string {
  return `/api/library/file?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`;
}

// Everything past runs wrote to disk (see server/services/library.service.ts). Unlike the videos in
// DailyVerseGenerator's own state, these outlive the browser session - this is the only route to the
// backlog of already-rendered videos that were never published.
export async function fetchLibrary(): Promise<LibraryEntry[]> {
  const response = await fetch('/api/library');
  if (!response.ok) throw new Error('Could not load the output library.');
  const data = await response.json();
  return data.entries as LibraryEntry[];
}

export interface LibraryUploadResult {
  videoId: string;
  url: string;
  title: string;
  seriesLabel: string;
  warnings: string[];
  publishAt?: string;
}

// Publishes one backlog file. The video never travels through the browser - the server reads it
// from disk, regenerates its title/description via Claude and uploads it, so this call sends only
// the two identifiers naming which file to publish.
export function uploadLibraryVideo(dir: string, file: string): Promise<LibraryUploadResult> {
  return postJson<LibraryUploadResult>('/api/library/upload', { dir, file });
}

// Posts one backlog video to Instagram as a Reel right now (server reads the file from disk). The
// caption is the video's YouTube title/description if it is on YouTube, else freshly written.
export function postLibraryVideoToInstagram(dir: string, file: string): Promise<{ mediaId: string; permalink: string | null; postedAt: string }> {
  return postJson('/api/library/instagram', { dir, file });
}

// Schedules a backlog video's Instagram post for `at` (ISO time), or cancels it with `at = null`.
// The server posts it at that time - it has to be running then.
export function scheduleLibraryVideoForInstagram(dir: string, file: string, at: string | null): Promise<unknown> {
  return postJson('/api/library/instagram/schedule', { dir, file, at });
}

export type ChannelOutcome =
  | { state: 'scheduled'; at: string }
  | { state: 'unpublished' | 'already' | 'skipped' | 'error'; detail: string };

export interface ScheduleAllResult {
  at: string | null;
  youtube: ChannelOutcome;
  instagram: ChannelOutcome;
  facebook: ChannelOutcome;
}

// Schedules a backlog video on YouTube, Instagram and Facebook for one go-live time - its verse date
// (entry.postAt) unless `at` overrides it. Past dates stay unpublished everywhere.
export function scheduleLibraryVideoEverywhere(dir: string, file: string, at: string | null = null): Promise<ScheduleAllResult> {
  return postJson('/api/library/schedule-all', { dir, file, at });
}

// --- WhatsApp Channel queue (server/services/whatsapp.service.ts) ---

export interface WhatsAppQueueItem {
  dir: string;
  reference: string;
  date: string;
  at: string;
  posters: { file: string; label: string; postedAt: string | null; caption: string | null }[];
}

export interface WhatsAppQueue {
  channelUrl: string;
  due: WhatsAppQueueItem[];
  upcoming: WhatsAppQueueItem[];
}

export async function getWhatsAppQueue(): Promise<WhatsAppQueue> {
  const response = await fetch('/api/whatsapp/queue');
  if (!response.ok) throw new Error(`Failed to load the WhatsApp queue: ${response.status}`);
  return response.json();
}

// Queues a verse's posters for `at` (ISO) or, with no `at`, the verse's own date. Resolves
// `scheduled: null` when that date has passed (nothing queued).
export function scheduleWhatsApp(dir: string, at: string | null = null): Promise<{ scheduled: { at: string } | null }> {
  return postJson('/api/library/whatsapp/schedule', { dir, at });
}

export function cancelWhatsApp(dir: string): Promise<unknown> {
  return postJson('/api/library/whatsapp/schedule', { dir, cancel: true });
}

export async function getWhatsAppCaption(dir: string, file: string): Promise<{ caption: string | null; channelUrl: string }> {
  const response = await fetch(`/api/library/whatsapp/caption?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP error! status: ${response.status}`);
  return data;
}

export function markWhatsAppPosted(dir: string, file: string, posted = true): Promise<unknown> {
  return postJson('/api/library/whatsapp/posted', { dir, file, posted });
}

export async function getFacebookStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/facebook/status');
  if (!response.ok) throw new Error(`Failed to check Facebook status: ${response.status}`);
  return response.json();
}

// Uploads a backlog video to the Facebook Page as an unpublished draft (`at = null`) or scheduled by
// Facebook itself for `at` (ISO time) - nothing goes public immediately.
export function sendLibraryVideoToFacebook(dir: string, file: string, at: string | null): Promise<NonNullable<LibraryVideo['facebook']>> {
  return postJson('/api/library/facebook', { dir, file, at });
}

// Claude-designed poster layout/typography variants for a background already generated (see
// ai/posterDesign.ts). Resolves to an empty list when Claude is unavailable - the automatic layout
// is always available regardless.
export function fetchPosterDesigns(payload: {
  backgroundImageBase64: string;
  reference: string;
  english: string;
  tamil: string;
  telugu: string;
  theme?: string;
  emotion?: string;
  accentColor?: string;
}): Promise<{ designs: PosterDesign[] }> {
  return postJson('/api/verse/poster-designs', payload);
}

// Ready-to-paste captions for posting each poster on the channel's YouTube Posts tab (see
// ai/postCaption.ts). The YouTube API can't create community posts, so posting itself is manual.
export function fetchPostCaptions(payload: {
  reference: string;
  english: string;
  tamil: string;
  telugu: string;
  tamilReference: string;
  teluguReference: string;
  viewerSituation?: string;
  emotionalHook?: string;
}): Promise<{ captions: { tamil: string; telugu: string } }> {
  return postJson('/api/verse/post-captions', payload);
}
