import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { CheckCircle2, Circle, Loader2, XCircle, Download, UploadCloud, RefreshCw } from 'lucide-react';
import ministryLogoUrl from './ACI.png';
import Button from './Button';
import VersePlanPicker, { getPlanEntry, type VersePlanEntry } from './VersePlanPicker';
import type { PosterDesign, VerseAnalysis } from '../types';
import {
  lookupVerse,
  analyzeAndGenerateBackground,
  selectVersePortion,
  fetchPosterDesigns,
  fetchPostCaptions,
  saveGeneration,
  getImageServiceStatus,
  synthesizeVerseAudio,
  generateNarrationVideo,
  alignCaptions,
  generateMeditationContent,
  adjustMeditationLength,
  generateYouTubeMetadata,
  getYoutubeUploadStatus,
  uploadToYoutube,
  ApiError,
  type DailyVerse,
  type MeditationText,
  type VersePortion,
} from '../services/verseApi';
import { loadImage, base64ToImageDataUrl, renderVersePosterHighlightSet, renderCornerPoster, renderThumbnail, renderMeditationFrame, meditationCardRect, upscaleToCanonical, blobToBase64, type PosterWordBox } from './posterRenderer';
import { buildHighlightWords, transformBoxes, type SpokenWord } from './wordHighlight';
import { pcm16Base64ToWavBase64, combinePcm16PartsToWavBase64, pcm16Base64DurationSeconds, dataUrlToBlobUrl, blobUrlToBytes, bytesToBase64 } from './wavEncoder';

// The channel's Posts page in YouTube Studio, where posters are posted manually (the YouTube API
// has no endpoint for community posts) - see ai/postCaption.ts.
const YOUTUBE_POSTS_URL = 'https://studio.youtube.com/channel/UC87dYxAo1dkXNw5nftDWNNA/content/posts';

type StepKey = 'verse' | 'claude' | 'background' | 'tamilPoster' | 'teluguPoster';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

type VideoLangKey = 'english' | 'tamil' | 'telugu';
const VIDEO_LANG_LABELS: Record<VideoLangKey, string> = { english: 'English', tamil: 'Tamil', telugu: 'Telugu' };
const VIDEO_LANG_ORDER: VideoLangKey[] = ['english', 'tamil', 'telugu'];
const VIDEO_LANG_CODE: Record<VideoLangKey, 'en' | 'ta' | 'te'> = { english: 'en', tamil: 'ta', telugu: 'te' };

// A short spoken transition inviting the viewer to close their eyes, said once between the
// meditation and the prayer (see runMeditationGeneration below) - fixed and not AI-generated per
// request (same reasoning as ai/youtubeMetadata.ts's SERIES_DISPLAY_NAMES), so it reads the same
// natural way in every video rather than being re-invented, and possibly inconsistent, each time.
// Generated once via Claude for natural per-language phrasing, then hardcoded here.
const PRAYER_INVITATION: Record<'en' | 'ta' | 'te', string> = {
  en: "Now let's close our eyes together and spend a moment with the Lord.",
  ta: 'இப்போ நம் கண்ணை மூடிக்கிட்டு ஒரு நிமிஷம் கர்த்தரோட இருப்போம்.',
  te: 'ఇప్పుడు కళ్ళు మూసుకుని కొద్దిసేపు ప్రభువుతో ఉండటానికి వెళ్దాం.',
};

// Which of the app's two video shapes this is - they are NOT interchangeable on YouTube, and the
// distinction is invisible from the file alone once both are sitting in the same results grid:
//   'short'    - 1080x1920 portrait (generateNarrationVideo's default size), the verse reading only.
//                YouTube auto-classifies any vertical/square video under 3 minutes as a Short, so
//                these are what actually reach the Shorts feed.
//   'longform' - 1920x1080 landscape (MEDITATION_VIDEO_WIDTH/HEIGHT), verse + 90-120s reflection,
//                meant for the channel's regular "Videos" tab.
// Carried on the result so the UI can label each card and so "upload all" actions can target one
// kind without re-deriving it from the filename.
type VideoKind = 'short' | 'longform';

// Why every upload control is disabled when the server has no YouTube OAuth credentials. Shown on
// the controls themselves (and once, in full, next to the Generate options) rather than hiding them:
// with the controls hidden the app simply looked like it could not upload at all, so generated
// videos sat undownloaded and unpublished with nothing on screen explaining what was missing.
const YOUTUBE_SETUP_HINT = 'YouTube upload is not configured on the server. Run scripts/youtube_authorize.ts once, then set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in .env and restart.';

// Per-video YouTube upload state, keyed by VideoResult.filename in DailyVerseGenerator's
// uploadStates. 'done' carries the resulting watch URL so the card can link to it.
interface UploadEntry {
  state: 'idle' | 'uploading' | 'done' | 'error';
  url?: string;
  error?: string;
  warnings?: string[];
  publishAt?: string;
}

// How each video kind is presented in the results grid. Without this the two grids are visually
// identical, which is exactly how an entire kind ends up never being uploaded.
const VIDEO_KIND_META: Record<VideoKind, { badge: string; dimensions: string; aspectClass: string; uploadAllLabel: string }> = {
  short: { badge: 'Short', dimensions: '1080x1920 portrait', aspectClass: 'aspect-[9/16]', uploadAllLabel: 'Upload all Shorts' },
  longform: { badge: 'Video', dimensions: '1920x1080 landscape', aspectClass: 'aspect-video', uploadAllLabel: 'Upload all Videos' },
};

interface VideoResult {
  kind: VideoKind;
  label: string;
  filename: string;
  blobUrl: string;
  // Where this video was saved under output/ - sent with a YouTube upload so the server records the
  // upload against that file (manifest.youtube), which is how the Instagram sync later finds the
  // local file to post once the YouTube video turns public (see server/services/instagramSync.service.ts).
  output: { date: string; reference: string; file: string };
  // YouTube upload packaging (see ai/youtubeMetadata.ts) - optional since it's best-effort: a
  // failure here shouldn't take down the video itself, which is the actual deliverable.
  youtube?: {
    title: string;
    description: string;
    seriesLabel: string;
    thumbnailBlobUrl: string;
    thumbnailFilename: string;
  };
}

// Meditation Video runtime target: the meditation+prayer (reflection) portion alone, spoken after
// the verse reading - not including the verse itself, per the content spec's own breakdown
// (meditation ~60-75s + prayer ~30-45s = 90-120s). A fixed word-count target in the generation
// prompt (see ai/meditation.ts) can't guarantee this on its own - TTS pace varies by language/engine
// - so this is enforced by actually measuring the synthesized audio and, if it misses, asking for a
// rewrite sized from that real measurement (see the adjustment loop in runMeditationGeneration below).
const MEDITATION_TARGET_MIN_SEC = 90;
const MEDITATION_TARGET_MAX_SEC = 120;
const MEDITATION_TARGET_MID_SEC = 105;
const MEDITATION_MAX_ADJUST_ATTEMPTS = 2;
const MEDITATION_SILENCE_SEC = 1.0;

// Landscape 16:9, unlike every other video/poster in this app (all portrait 1080x1920 - see
// posterRenderer.ts's PORTRAIT_W/H). YouTube auto-classifies any vertical/square video under 3
// minutes as a Short regardless of upload metadata, and the Meditation Video's total runtime
// (verse reading + this file's own 90-120s reflection target above) is usually well under that -
// this app's other videos are meant to be Shorts, but the Meditation Video is meant to land in the
// channel's regular "Videos" tab. See its generateNarrationVideo call below for how a still-portrait
// poster gets fit into this wider frame.
const MEDITATION_VIDEO_WIDTH = 1920;
const MEDITATION_VIDEO_HEIGHT = 1080;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// The meditation, then a short spoken invitation to close their eyes, then the prayer - all one
// continuous narration (see PRAYER_INVITATION above for why the invitation itself is fixed text).
// Reading highlighter payload for /api/video/generate: matches the poster's verse words to when they
// are spoken (Edge voices report word timings; for the local voices, fall back to Whisper alignment),
// so each word glows while it is read. Best-effort polish - any failure just means a video without it.
async function buildVideoHighlight(
  boxes: PosterWordBox[], layerBlobs: Blob[],
  audio: { audioBase64: string | null; words?: SpokenWord[] }, verseText: string, lang: 'en' | 'ta' | 'te',
) {
  try {
    let spoken = audio.words;
    if (!spoken?.length && audio.audioBase64) spoken = (await alignCaptions(audio.audioBase64, verseText, lang)).words;
    const words = buildHighlightWords(boxes, spoken || []);
    if (!words) return null;
    const layerImagesBase64 = await Promise.all(layerBlobs.map(blobToBase64));
    return { layerImagesBase64, words };
  } catch (err) {
    console.warn('Reading highlighter skipped:', err);
    return null;
  }
}

function buildReflectionText(lang: 'en' | 'ta' | 'te', explanation: string, prayer: string): string {
  return `${explanation} ${PRAYER_INVITATION[lang]} ${prayer}`;
}

const pendingLangSteps = (): Record<VideoLangKey, StepStatus> => ({ english: 'pending', tamil: 'pending', telugu: 'pending' });

const STEP_LABELS: Record<StepKey, string> = {
  verse: 'Verse found',
  claude: 'Claude analysis',
  background: 'Background generated',
  tamilPoster: 'Tamil + English poster',
  teluguPoster: 'Telugu + English poster',
};

const CORE_STEP_ORDER: StepKey[] = ['verse', 'claude', 'background'];
const POSTER_STEP_ORDER: StepKey[] = ['tamilPoster', 'teluguPoster'];

const initialSteps = (): Record<StepKey, StepStatus> => ({
  verse: 'pending', claude: 'pending', background: 'pending', tamilPoster: 'pending', teluguPoster: 'pending',
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(reference: string): string {
  return reference.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface PosterResult {
  label: string;
  filename: string;
  blobUrl: string;
}

type NarrationContext = { bgImg: HTMLImageElement; logoImg: HTMLImageElement | null; analysis: VerseAnalysis };

const requestMeditationContent = (verse: DailyVerse): Promise<Record<'en' | 'ta' | 'te', MeditationText>> =>
  generateMeditationContent(verse.reference, verse.english!.text, verse.tamil!.text, verse.telugu!.text).then((resp) => resp.meditation);

interface MeditationGenerationResult {
  error: string | null;
  results: Partial<Record<VideoLangKey, VideoResult>>;
  meditationTexts: Record<'en' | 'ta' | 'te', MeditationText> | null;
}

// Everything one verse's Generate run can produce, captured independently of this component's
// single-verse display state (posters/videos/meditations/etc.) - those are single shared slots that
// only ever hold the most recently written verse's data, which bulk mode's parallel handleGenerate
// calls would otherwise stomp on each other. Bulk mode stores one of these per verse (see
// bulkResults below) so each gets its own working "Download" button regardless of what any other
// concurrently-running verse has since overwritten in the shared state.
interface GenerateOutcome {
  ok: boolean;
  error?: string;
  verse?: DailyVerse;
  posters?: { tamil: PosterResult; telugu: PosterResult } | null;
  videos?: Partial<Record<VideoLangKey, VideoResult>> | null;
  meditations?: Partial<Record<VideoLangKey, VideoResult>> | null;
  meditationTexts?: Record<'en' | 'ta' | 'te', MeditationText> | null;
}

// One row in bulk mode's progress list - status/error for display, plus (once settled) that verse's
// own captured artifacts (same shape as GenerateOutcome, minus `ok` - `status` already covers that)
// so its "Download" button can bundle exactly what THIS verse produced, independent of whatever any
// other concurrently-generating verse has since written into the shared single-verse state.
// posterStatus/videoStatus/meditationStatus track each content type's own progress within this
// verse's run (undefined when that type wasn't selected for the batch) so the progress list below
// can show Poster/Video/Meditation as separate line items per verse, rather than the one combined
// icon `status` gives for the whole row.
interface BulkResultEntry {
  reference: string;
  status: StepStatus;
  error?: string;
  posterStatus?: StepStatus;
  videoStatus?: StepStatus;
  meditationStatus?: StepStatus;
  verse?: DailyVerse;
  posters?: { tamil: PosterResult; telugu: PosterResult } | null;
  videos?: Partial<Record<VideoLangKey, VideoResult>> | null;
  meditations?: Partial<Record<VideoLangKey, VideoResult>> | null;
  meditationTexts?: Record<'en' | 'ta' | 'te', MeditationText> | null;
}

const DailyVerseGenerator: React.FC = () => {
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('Psalm 23:1');
  const [imageServiceStatus, setImageServiceStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  // Whether the server has YouTube OAuth credentials configured (see scripts/youtube_authorize.ts) -
  // gates whether the "Upload to YouTube" action even appears, rather than letting every click fail.
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);

  const [includePoster, setIncludePoster] = useState(true);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [includeMeditation, setIncludeMeditation] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>(initialSteps());
  const [error, setError] = useState<string | null>(null);
  // Set when /verse/analyze had to fall back to an unrelated stock photo (image service down) -
  // posters still render, but the background has nothing to do with the verse.
  const [stockImageNotice, setStockImageNotice] = useState(false);
  const [verses, setVerses] = useState<DailyVerse | null>(null);
  const [posters, setPosters] = useState<{ tamil: PosterResult; telugu: PosterResult } | null>(null);
  // The loaded background/logo images plus the resolved analysis (font/accent), kept in a ref
  // (not state - these are read-only inputs to a canvas render, not something a re-render needs to
  // react to) so video/meditation generation can render a fresh single-language poster per
  // narration without re-fetching anything already on screen.
  const narrationContextRef = useRef<NarrationContext | null>(null);
  // Whether a narration context is available, mirrored into state purely so sections gated on it
  // can react (a ref alone wouldn't trigger a re-render).
  const [hasNarrationContext, setHasNarrationContext] = useState(false);

  const [videoSteps, setVideoSteps] = useState<Record<VideoLangKey, StepStatus>>(pendingLangSteps());
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Partial<Record<VideoLangKey, VideoResult>> | null>(null);

  const [meditationSteps, setMeditationSteps] = useState<Record<VideoLangKey, StepStatus>>(pendingLangSteps());
  const [meditationError, setMeditationError] = useState<string | null>(null);
  const [meditations, setMeditations] = useState<Partial<Record<VideoLangKey, VideoResult>> | null>(null);
  const [meditationTexts, setMeditationTexts] = useState<Record<'en' | 'ta' | 'te', MeditationText> | null>(null);

  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  // YouTube upload state, keyed by VideoResult.filename (unique per verse+language+kind). Held here
  // rather than inside each YouTubePackagePreview because three things now drive the same upload:
  // the per-card button, the per-kind "Upload all" actions, and the auto-upload pass below - all of
  // which have to read and write one shared view of what has already gone up, so a video can't be
  // uploaded twice by two different routes.
  const [uploadStates, setUploadStates] = useState<Record<string, UploadEntry>>({});
  // Auto-upload every generated video to YouTube (PRIVATE - see uploadVideoResult) as soon as its
  // batch finishes, instead of waiting for a per-card click. On by request: the Shorts this app
  // generates were reliably being left un-uploaded when each one needed its own click, which is the
  // whole reason the channel's Shorts feed sat empty while the landscape meditations went up.
  const [autoUploadYouTube, setAutoUploadYouTube] = useState(true);

  // "Regenerate image" (single-verse mode only): re-fetches just the background - same cached
  // Claude analysis/theme/concept for this verse, but a brand new Pollinations photo (see
  // services/verseApi.ts's forceRegenerate) - and re-renders the two posters from it, without
  // re-running verse lookup or Claude. Needs the last resolved versePortion (see
  // ai/versePortionSelector.ts) since that isn't otherwise kept in state - handleGenerate sets it
  // below once a verse lookup succeeds.
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [lastVersePortion, setLastVersePortion] = useState<VersePortion | null>(null);

  // Claude-designed poster variants for the current background (see ai/posterDesign.ts), the one
  // currently applied (-1 = the renderer's automatic layout), and Tamil-poster previews of every
  // option for the picker. Previews/picking are single-verse mode only; bulk mode just applies the
  // first design.
  const [posterDesigns, setPosterDesigns] = useState<PosterDesign[]>([]);
  // Ready-to-paste captions for posting each poster on the channel's YouTube Posts tab (see
  // ai/postCaption.ts) - the YouTube API can't create community posts, so the user posts manually
  // from YouTube Studio with the caption copied from here. copiedCaption flashes "Copied".
  const [postCaptions, setPostCaptions] = useState<{ tamil: string; telugu: string } | null>(null);
  const [copiedCaption, setCopiedCaption] = useState<'tamil' | 'telugu' | null>(null);
  const [selectedDesignIdx, setSelectedDesignIdx] = useState(-1);
  const [designPreviews, setDesignPreviews] = useState<Record<number, string>>({});
  const [isApplyingDesign, setIsApplyingDesign] = useState(false);
  const posterContextRef = useRef<{
    verse: DailyVerse; portion: VersePortion; bgImg: HTMLImageElement; logoImg: HTMLImageElement | null;
    analysis: VerseAnalysis; imageSource: 'pollinations' | 'stock';
  } | null>(null);

  // Bulk mode: same date + Poster/Video/Meditation checkboxes as single-verse mode, but a
  // newline-separated list of references instead of one - each is run through the exact same
  // handleGenerate(...) pipeline as a single-verse "Generate" click, one at a time (never
  // concurrently: TTS synthesis, especially Tamil's local model, has already shown real reliability
  // problems under concurrent load on this kind of machine - see ai/meditation.ts's Indic-Parler
  // notes). bulkResults is a lightweight running log (reference + status) shown alongside the
  // existing single-verse result panels below, which still show whichever verse most recently
  // finished (handleGenerate's own state) - not a separate per-verse preview, to avoid the UI
  // trying to hold N verses' full poster/video previews in memory/DOM at once.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResultEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getImageServiceStatus()
      .then((status) => { if (!cancelled) setImageServiceStatus(status.available ? 'connected' : 'offline'); })
      .catch(() => { if (!cancelled) setImageServiceStatus('offline'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getYoutubeUploadStatus()
      .then((status) => { if (!cancelled) setYoutubeConfigured(status.configured); })
      .catch(() => { if (!cancelled) setYoutubeConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  const setStep = (key: StepKey, status: StepStatus) => setSteps((prev) => ({ ...prev, [key]: status }));
  const setVideoStep = (key: VideoLangKey, status: StepStatus) => setVideoSteps((prev) => ({ ...prev, [key]: status }));
  const setMeditationStep = (key: VideoLangKey, status: StepStatus) => setMeditationSteps((prev) => ({ ...prev, [key]: status }));

  // Plain verse-reading narration (no explanation/prayer) - one poster + one audio clip per
  // language. Reuses the exact background/analysis already on screen (never re-requests or
  // regenerates those), but renders a fresh single-language poster per video rather than reusing
  // the bilingual download posters, so each narration's visual carries only the language actually
  // being read aloud.

  // Renders both bilingual posters from the SAME shared vertical background/analysis Video and
  // Meditation also use (ctx.bgImg/ctx.analysis - see NarrationContext), persisting them (+ the
  // background) to output/YYYY/MM/DD/<verse>/. Previously fetched its own separately-composed 4:5
  // background (a real Claude+Pollinations call of its own, in one of three compositions - subject
  // confined to a right column / corner / center column); now reuses whatever background this
  // verse's generation already produced for Video/Meditation.
  //
  // Always renders via renderCornerPoster now, not a per-theme editorial/corner/centered pick
  // (ai/themeMapper.ts's pickPosterLayoutForTheme is now dormant - nothing calls it - and
  // renderEditorialPoster/renderCenteredPoster in components/posterRenderer.ts are unused; left in
  // place rather than deleted in case per-theme variety is worth reviving later). The vertical
  // background's ONLY composition guarantee is a full-width clear
  // TOP zone (subject confined to the bottom 25%-45%, but free to span the FULL WIDTH there) -
  // renderCornerPoster's full-width top-band search matches that guarantee exactly, the same way
  // renderVersePoster's own search already relies on it for Video/Meditation. renderEditorialPoster
  // (clear LEFT column only) and renderCenteredPoster (clear left AND right columns) both assume a
  // narrower, side-avoiding subject the vertical background never promised - confirmed directly: a
  // real John 3:16 (LOVE theme -> 'centered') render with two full-width figures put text straight
  // over their arms/robes, because nothing in the shared background ever confined them off either
  // side. Dropped to the one layout whose assumptions the shared background actually satisfies.
  const renderAndSavePosters = async (
    verse: DailyVerse,
    versePortion: VersePortion,
    bgImg: HTMLImageElement,
    logoImg: HTMLImageElement | null,
    analysis: VerseAnalysis,
    imageSource: 'pollinations' | 'stock' = 'pollinations',
    design?: PosterDesign
  ): Promise<{ tamil: PosterResult; telugu: PosterResult }> => {
    const renderPoster = renderCornerPoster;

    // primaryText/englishText come from versePortion (see ai/versePortionSelector.ts) - the full
    // verse, or a shorter thought that's complete and grammatically whole in English, Tamil, AND
    // Telugu at once. Both posters share the same decision, so their English block always matches.
    const tamilBlob = await renderPoster(bgImg, logoImg, {
      primaryText: versePortion.tamil, primaryRef: verse.tamil!.reference, primaryLang: 'ta',
      englishText: versePortion.english, englishRef: verse.english!.reference,
      fontStyle: analysis.fontStyle, accentColor: analysis.accentColor, design,
    });
    const teluguBlob = await renderPoster(bgImg, logoImg, {
      primaryText: versePortion.telugu, primaryRef: verse.telugu!.reference, primaryLang: 'te',
      englishText: versePortion.english, englishRef: verse.english!.reference,
      fontStyle: analysis.fontStyle, accentColor: analysis.accentColor, design,
    });

    const slug = slugify(verse.reference);
    const posters = {
      tamil: { label: 'Tamil + English', filename: `${slug}-tamil-english.png`, blobUrl: URL.createObjectURL(tamilBlob) },
      telugu: { label: 'Telugu + English', filename: `${slug}-telugu-english.png`, blobUrl: URL.createObjectURL(teluguBlob) },
    };

    // Persist to output/YYYY/MM/DD/reference/ - the background is generated smaller for speed (see
    // verse.routes.ts) and upscaled here purely for the saved background.png artifact - the posters
    // above already handle the smaller source directly via cover-fit scaling. upscaleToCanonical
    // (not upscaleToEditorialCanonical) since the shared background is the vertical 9:16 one now,
    // same artifact Video/Meditation would also save for this verse.
    try {
      const [tamilB64, teluguB64, canonicalBgBlob] = await Promise.all([
        blobToBase64(tamilBlob),
        blobToBase64(teluguBlob),
        upscaleToCanonical(bgImg),
      ]);
      const canonicalBgB64 = await blobToBase64(canonicalBgBlob);
      await saveGeneration({
        date,
        reference: verse.reference,
        verses: { english: verse.english!.text, tamil: verse.tamil!.text, telugu: verse.telugu!.text },
        analysis,
        backgroundImageBase64: canonicalBgB64,
        imageProvider: imageSource,
        tamilEnglishPosterBase64: tamilB64,
        teluguEnglishPosterBase64: teluguB64,
      });
    } catch (saveErr) {
      console.warn('Failed to save generation to disk:', saveErr);
    }

    return posters;
  };

  // Claude's layout/typography variants for this exact background (see ai/posterDesign.ts). Never
  // throws - an empty list just means the automatic layout is the only option.
  const loadPosterDesigns = async (verse: DailyVerse, backgroundImageBase64: string, analysis: VerseAnalysis): Promise<PosterDesign[]> => {
    try {
      const { designs } = await fetchPosterDesigns({
        backgroundImageBase64,
        reference: verse.reference,
        english: verse.english!.text,
        tamil: verse.tamil!.text,
        telugu: verse.telugu!.text,
        theme: analysis.theme,
        emotion: analysis.emotion,
        accentColor: analysis.accentColor,
      });
      return designs;
    } catch (err) {
      console.warn('[poster-design] design request failed, using automatic layout:', err);
      return [];
    }
  };

  // Tamil-poster previews for the picker: index -1 is the automatic layout, 0..n-1 Claude's designs.
  // Rendered in the background after the posters are already on screen, so they never delay them.
  const buildDesignPreviews = async (designs: PosterDesign[]) => {
    const pc = posterContextRef.current;
    if (!pc) return;
    const previews: Record<number, string> = {};
    for (let idx = -1; idx < designs.length; idx++) {
      try {
        const blob = await renderCornerPoster(pc.bgImg, pc.logoImg, {
          primaryText: pc.portion.tamil, primaryRef: pc.verse.tamil!.reference, primaryLang: 'ta',
          englishText: pc.portion.english, englishRef: pc.verse.english!.reference,
          fontStyle: pc.analysis.fontStyle, accentColor: pc.analysis.accentColor,
          design: idx >= 0 ? designs[idx] : undefined,
        });
        previews[idx] = URL.createObjectURL(blob);
      } catch (err) {
        console.warn('[poster-design] preview render failed:', err);
      }
    }
    if (posterContextRef.current === pc) setDesignPreviews(previews);
  };

  // Picker click: re-renders both posters with the chosen variant and saves them over the previous
  // ones (same output folder/filenames - one current poster pair per verse).
  const handleSelectDesign = async (idx: number) => {
    const pc = posterContextRef.current;
    if (!pc || isApplyingDesign || idx === selectedDesignIdx) return;
    setIsApplyingDesign(true);
    try {
      const newPosters = await renderAndSavePosters(
        pc.verse, pc.portion, pc.bgImg, pc.logoImg, pc.analysis, pc.imageSource,
        idx >= 0 ? posterDesigns[idx] : undefined
      );
      setPosters(newPosters);
      setSelectedDesignIdx(idx);
    } catch (err: any) {
      setError('Failed to apply poster design: ' + (err.message || err));
    } finally {
      setIsApplyingDesign(false);
    }
  };

  // Captions for the YouTube Posts tab - fetched in the background once the posters are on screen.
  // The full verse is used even when the poster shows a shorter portion of it.
  const loadPostCaptions = async (verse: DailyVerse, analysis: VerseAnalysis) => {
    setPostCaptions(null);
    try {
      const { captions } = await fetchPostCaptions({
        reference: verse.reference,
        english: verse.english!.text,
        tamil: verse.tamil!.text,
        telugu: verse.telugu!.text,
        tamilReference: verse.tamil!.reference,
        teluguReference: verse.telugu!.reference,
        viewerSituation: analysis.viewerSituation,
        emotionalHook: analysis.emotionalHook,
      });
      setPostCaptions(captions);
    } catch (err) {
      console.warn('[post-caption] caption request failed:', err);
    }
  };

  const handleCopyCaption = async (key: 'tamil' | 'telugu') => {
    if (!postCaptions) return;
    try {
      await navigator.clipboard.writeText(postCaptions[key]);
      setCopiedCaption(key);
      setTimeout(() => setCopiedCaption((current) => (current === key ? null : current)), 2000);
    } catch (err) {
      setError('Could not copy the caption: ' + ((err as Error).message || err));
    }
  };

  // YouTube upload packaging (title/description/series + a 16:9 thumbnail) for one language's
  // video - shared between runVideoGeneration and runMeditationGeneration below. Best-effort: any
  // failure here returns undefined rather than throwing, since the video itself (already generated
  // by the time this runs) is the actual deliverable and shouldn't be lost over upload metadata.
  // Filenames currently uploading or already uploaded, as a ref rather than reading uploadStates -
  // the per-kind "upload all" loop and the auto-upload pass both fire in quick succession and would
  // otherwise each see the same stale uploadStates snapshot and start a second upload of the same
  // video. The ref is written synchronously before any await, so it is the real guard; uploadStates
  // is only what the UI renders from.
  const uploadClaimedRef = useRef<Set<string>>(new Set());

  // Uploads one generated video with the exact metadata already shown on its card. PRIVATE on
  // purpose, unchanged from the original per-card behaviour: this publishes to a real live channel
  // with server-side credentials, so every upload - including the automatic ones - still lands as a
  // private video to be reviewed and made public in YouTube Studio. Never throws: a failed upload is
  // recorded against that one video and the caller (which may be mid-loop over three languages)
  // carries on.
  const uploadVideoResult = async (result: VideoResult): Promise<void> => {
    if (!result.youtube) return;
    if (uploadClaimedRef.current.has(result.filename)) return;
    uploadClaimedRef.current.add(result.filename);

    setUploadStates((prev) => ({ ...prev, [result.filename]: { state: 'uploading' } }));
    try {
      const [videoBytes, thumbnailBytes] = await Promise.all([
        blobUrlToBytes(result.blobUrl),
        blobUrlToBytes(result.youtube.thumbnailBlobUrl),
      ]);
      const uploaded = await uploadToYoutube({
        videoBase64: bytesToBase64(videoBytes),
        title: result.youtube.title,
        description: result.youtube.description,
        privacyStatus: 'private',
        thumbnailBase64: bytesToBase64(thumbnailBytes),
        playlistTitle: result.youtube.seriesLabel,
        output: result.output,
      });
      setUploadStates((prev) => ({ ...prev, [result.filename]: { state: 'done', url: uploaded.videoUrl, warnings: uploaded.warnings, publishAt: uploaded.publishAt } }));
    } catch (err: any) {
      // Released from the claim set so a failed upload can be retried from its card.
      uploadClaimedRef.current.delete(result.filename);
      setUploadStates((prev) => ({ ...prev, [result.filename]: { state: 'error', error: err?.message || 'Upload failed.' } }));
    }
  };

  // Uploads a whole batch one at a time rather than in parallel - these are multi-megabyte resumable
  // uploads against a per-channel quota, and three concurrent ones are far more likely to fail
  // partway than three sequential ones. Batches are chained through uploadQueueRef too, since the
  // Narration and Meditation videos now generate side by side and can each finish (and start their
  // auto-upload) while the other's batch is still uploading.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const uploadAllVideoResults = (results: Partial<Record<VideoLangKey, VideoResult>>): Promise<void> => {
    const run = uploadQueueRef.current.then(async () => {
      for (const key of VIDEO_LANG_ORDER) {
        const result = results[key];
        if (result?.youtube) await uploadVideoResult(result);
      }
    });
    uploadQueueRef.current = run.catch(() => {});
    return run;
  };

  const buildYouTubePackage = async (
    ctx: NarrationContext,
    lang: { primaryLang: 'en' | 'ta' | 'te'; text: string; reference: string },
    filenamePrefix: string,
    canonicalReference: string
  ): Promise<VideoResult['youtube']> => {
    if (!ctx.analysis.viewerSituation || !ctx.analysis.emotionalHook) return undefined;
    try {
      const { metadata, seriesLabel } = await generateYouTubeMetadata(
        lang.reference, lang.text, lang.primaryLang, ctx.analysis.viewerSituation, ctx.analysis.emotionalHook, canonicalReference
      );
      const thumbBlob = await renderThumbnail(ctx.bgImg, ctx.logoImg, {
        thumbnailText: metadata.thumbnailText, fontStyle: ctx.analysis.fontStyle, accentColor: ctx.analysis.accentColor,
      });
      return {
        title: metadata.title,
        description: metadata.description,
        seriesLabel,
        thumbnailBlobUrl: URL.createObjectURL(thumbBlob),
        thumbnailFilename: `${filenamePrefix}-thumbnail.jpg`,
      };
    } catch (err: any) {
      console.warn('YouTube packaging skipped:', err?.message || err);
      return undefined;
    }
  };

  // Persists generated Narration/Meditation videos to output/YYYY/MM/DD/<verse>/, merging into
  // whatever manifest.json already exists there (see server/services/manifest.service.ts's
  // saveGeneration - a poster save and this can happen independently, in either order, without one
  // overwriting what the other recorded). Non-fatal if it fails: the videos are already generated
  // and downloadable client-side regardless.
  const persistVideoResults = async (
    verse: DailyVerse,
    analysis: VerseAnalysis,
    results: Partial<Record<VideoLangKey, VideoResult>>,
    kind: 'videos' | 'meditations',
    errorsByLang: Partial<Record<VideoLangKey, string>> = {}
  ) => {
    const entries = await Promise.all(
      (Object.entries(results) as [VideoLangKey, VideoResult][]).map(async ([key, result]) => {
        const bytes = await blobUrlToBytes(result.blobUrl);
        return [VIDEO_LANG_CODE[key], bytesToBase64(bytes)] as const;
      })
    );
    // Previously bailed out here whenever nothing succeeded, which meant a total failure (e.g.
    // every language's Indic-Parler call timing out) left no trace anywhere - not even the error.
    // Now still persists as long as there's an error worth recording.
    const errorEntries = Object.entries(errorsByLang).filter(([, message]) => message) as [VideoLangKey, string][];
    if (entries.length === 0 && errorEntries.length === 0) return;
    const errorsKey = kind === 'videos' ? 'videoErrors' : 'meditationErrors';
    try {
      await saveGeneration({
        date,
        reference: verse.reference,
        verses: { english: verse.english!.text, tamil: verse.tamil!.text, telugu: verse.telugu!.text },
        analysis,
        [kind]: Object.fromEntries(entries),
        [errorsKey]: Object.fromEntries(errorEntries.map(([key, message]) => [VIDEO_LANG_CODE[key], message])),
      });
    } catch (err) {
      console.warn(`Failed to save ${kind} to disk:`, err);
    }
  };

  // Returns a joined error summary (or null if every language succeeded) plus the actual results
  // map - not used by this component's own single-verse UI (which reads the live videoError/videos
  // state instead), only by bulk mode below, which has no state slot of its own to read and (being
  // parallel) can't rely on the shared `videos` state either, since a concurrent verse can overwrite
  // it before this one's caller gets a chance to read it back out.
  const runVideoGeneration = async (
    verse: DailyVerse,
    ctx: NarrationContext,
    versePortion: VersePortion,
  ): Promise<{ error: string | null; results: Partial<Record<VideoLangKey, VideoResult>> }> => {
    setVideoError(null);
    setVideos(null);
    setVideoSteps(pendingLangSteps());

    const slug = slugify(verse.reference);
    // text (narrated aloud) is always the full verse; posterText (shown on screen) is whatever
    // ai/versePortionSelector.ts decided - the full verse, or a shorter complete/synchronized
    // thought. The two are allowed to differ: reading the full verse aloud while the poster shows
    // its shortened thought is the intended behavior, not a bug.
    const langs: { key: VideoLangKey; primaryLang: 'en' | 'ta' | 'te'; text: string; reference: string; posterText: string }[] = [
      { key: 'english', primaryLang: 'en', text: verse.english!.text, reference: verse.english!.reference, posterText: versePortion.english },
      { key: 'tamil', primaryLang: 'ta', text: verse.tamil!.text, reference: verse.tamil!.reference, posterText: versePortion.tamil },
      { key: 'telugu', primaryLang: 'te', text: verse.telugu!.text, reference: verse.telugu!.reference, posterText: versePortion.telugu },
    ];

    // Sequential, not parallel - each language spins up its own local TTS process (PyTorch for
    // Tamil), and running all three at once risks the same kind of memory pressure that made local
    // image generation unusable on this machine earlier.
    const results: Partial<Record<VideoLangKey, VideoResult>> = {};
    const errors: string[] = [];
    const errorsByLang: Partial<Record<VideoLangKey, string>> = {};
    for (const lang of langs) {
      setVideoStep(lang.key, 'active');
      try {
        const posterSet = await renderVersePosterHighlightSet(ctx.bgImg, ctx.logoImg, {
          primaryText: lang.posterText, primaryRef: lang.reference, primaryLang: lang.primaryLang,
          fontStyle: ctx.analysis.fontStyle, accentColor: ctx.analysis.accentColor,
        });
        const posterBase64 = await blobToBase64(posterSet.poster);

        // No hook card / pre-verse narration here (removed per explicit feedback - this Narration
        // Video should just read the verse itself, nothing spoken or shown before it). The verse
        // reading + its spoken reference (reference comes after the verse text, never before) is
        // the entire narration. The hook-card intro (renderHookCard/introImageBase64) still exists
        // for other flows that want it - this one simply doesn't call it.
        const audioResp = await synthesizeVerseAudio(lang.text, lang.reference);
        if (!audioResp.audioBase64) throw new Error(audioResp.error || 'Narration unavailable.');
        const wavBase64 = pcm16Base64ToWavBase64(audioResp.audioBase64);

        // Reading highlighter: a band behind each verse word on the poster while it is spoken.
        const highlight = await buildVideoHighlight(posterSet.words, posterSet.layers, audioResp, lang.text, lang.primaryLang);
        const videoResp = await generateNarrationVideo(posterBase64, wavBase64, highlight ? { highlight } : undefined);
        const filenamePrefix = `${slug}-${lang.key}-narration`;
        results[lang.key] = {
          kind: 'short',
          label: VIDEO_LANG_LABELS[lang.key],
          filename: `${filenamePrefix}.mp4`,
          blobUrl: dataUrlToBlobUrl(videoResp.videoBase64),
          output: { date, reference: verse.reference, file: `${VIDEO_LANG_CODE[lang.key]}-narration.mp4` },
          youtube: await buildYouTubePackage(ctx, lang, filenamePrefix, verse.reference),
        };
        setVideoStep(lang.key, 'done');
      } catch (err: any) {
        setVideoStep(lang.key, 'error');
        const message = err.message || 'failed';
        errorsByLang[lang.key] = message;
        errors.push(`${VIDEO_LANG_LABELS[lang.key]}: ${message}`);
      }
    }

    setVideos(results);
    if (errors.length) setVideoError(errors.join(' — '));
    await persistVideoResults(verse, ctx.analysis, results, 'videos', errorsByLang);
    return { error: errors.length ? errors.join(' — ') : null, results };
  };

  // Verse + a warm, non-preachy explanation + an invitational closing prayer, narrated as one
  // continuous track per language (verse and its citation, a pause, then the reflection) over the
  // same single-language poster used for the plain narration video.
  // Returns a joined error summary (or null if every language succeeded) plus the actual results
  // map and meditation texts - see runVideoGeneration's return above for why (bulk mode, which has
  // no state slot of its own to read and can't rely on the shared state either under parallel
  // execution).
  const runMeditationGeneration = async (
    verse: DailyVerse,
    ctx: NarrationContext,
    versePortion: VersePortion,
    // Already-started meditation text request (see handleGenerate, which kicks it off right after
    // verse lookup so its Claude calls overlap background/poster work instead of waiting for them).
    meditationContent?: Promise<Record<'en' | 'ta' | 'te', MeditationText>>,
  ): Promise<MeditationGenerationResult> => {
    setMeditationError(null);
    setMeditations(null);
    setMeditationTexts(null);
    setMeditationSteps(pendingLangSteps());

    let meditationByLang: Record<'en' | 'ta' | 'te', MeditationText>;
    try {
      meditationByLang = await (meditationContent ?? requestMeditationContent(verse));
      setMeditationTexts(meditationByLang);
    } catch (err: any) {
      const message = err.message || 'Meditation content generation failed.';
      setMeditationError(message);
      setMeditationSteps({ english: 'error', tamil: 'error', telugu: 'error' });
      return { error: message, results: {}, meditationTexts: null };
    }

    const slug = slugify(verse.reference);
    // See runVideoGeneration above: text (narrated) is always the full verse, posterText (shown
    // on screen) is whatever ai/versePortionSelector.ts decided.
    const langs: { key: VideoLangKey; primaryLang: 'en' | 'ta' | 'te'; text: string; reference: string; posterText: string }[] = [
      { key: 'english', primaryLang: 'en', text: verse.english!.text, reference: verse.english!.reference, posterText: versePortion.english },
      { key: 'tamil', primaryLang: 'ta', text: verse.tamil!.text, reference: verse.tamil!.reference, posterText: versePortion.tamil },
      { key: 'telugu', primaryLang: 'te', text: verse.telugu!.text, reference: verse.telugu!.reference, posterText: versePortion.telugu },
    ];

    const results: Partial<Record<VideoLangKey, VideoResult>> = {};
    const errors: string[] = [];
    const errorsByLang: Partial<Record<VideoLangKey, string>> = {};
    // All three languages concurrently, not one-at-a-time - unlike runVideoGeneration (which stays
    // sequential because past local *image* generation attempts overloaded this machine's memory
    // with several heavy models loaded at once), the only heavy step here is Tamil's local synthesis
    // (Indic-Parler/MMS-TTS, a transient Python subprocess); English/Telugu use the lightweight Piper
    // binary. Overlapping the three doesn't reproduce that memory pressure, and each language's own
    // pipeline (content-length adjustment loop, TTS, ffmpeg encode) - not a shared resource - is what
    // was making the total wait so long. allSettled (not all) so one language's failure doesn't drop
    // the other two's results.
    await Promise.allSettled(langs.map(async (lang) => {
      setMeditationStep(lang.key, 'active');
      try {
        const filenamePrefix = `${slug}-${lang.key}-meditation`;
        // None of these depend on each other, so they all start at once rather than one after
        // another. The reflection is requested before the verse on purpose: for Tamil both go
        // through the server's one-at-a-time Indic-Parler queue, and the reflection is what the
        // length-adjustment loop below is waiting on. The verse reading is usually already cached
        // server-side from the Narration Video (see synthesizeNarrationCached in server.ts).
        // The YouTube package (a Claude call + thumbnail render) only needs the verse and analysis,
        // so it overlaps the whole TTS/encode chain instead of running after it.
        let med = meditationByLang[VIDEO_LANG_CODE[lang.key]];
        const reflectionAudioPromise = synthesizeVerseAudio(buildReflectionText(lang.primaryLang, med.explanation, med.prayer));
        const verseAudioPromise = synthesizeVerseAudio(lang.text, lang.reference);
        // A composed landscape frame (blurred clean background + title block + the verse poster as a
        // framed card - see posterRenderer.ts's renderMeditationFrame) rather than the portrait
        // poster letterboxed into the wide video frame.
        // Rendered once plain and once per reading-highlighter layer (copies with some verse words
        // glowing), with the poster's word boxes mapped onto the frame's poster card.
        const meditationFramesPromise = (async () => {
          const set = await renderVersePosterHighlightSet(ctx.bgImg, ctx.logoImg, {
            primaryText: lang.posterText, primaryRef: lang.reference, primaryLang: lang.primaryLang,
            fontStyle: ctx.analysis.fontStyle, accentColor: ctx.analysis.accentColor,
          });
          const urls = [set.poster, ...set.layers].map((b) => URL.createObjectURL(b));
          try {
            const imgs = await Promise.all(urls.map(loadImage));
            const frameOpts = { lang: lang.primaryLang, reference: lang.reference, fontStyle: ctx.analysis.fontStyle, accentColor: ctx.analysis.accentColor };
            const [frame, ...layerFrames] = await Promise.all(imgs.map((img) => renderMeditationFrame(ctx.bgImg, ctx.logoImg, img, frameOpts)));
            const rect = meditationCardRect(imgs[0].width, imgs[0].height);
            return { frameBase64: await blobToBase64(frame), layerFrames, boxes: transformBoxes(set.words, imgs[0].width, rect) };
          } finally {
            urls.forEach((u) => URL.revokeObjectURL(u));
          }
        })();
        const posterBase64Promise = meditationFramesPromise.then((f) => f.frameBase64);
        const youtubePromise = buildYouTubePackage(ctx, lang, filenamePrefix, verse.reference);
        // Settled on its own so an early throw below (e.g. reflection audio failing) never leaves
        // these as unhandled rejections.
        [verseAudioPromise, posterBase64Promise].forEach((p) => p.catch(() => {}));

        let reflectionAudioResp = await reflectionAudioPromise;
        if (!reflectionAudioResp.audioBase64) throw new Error(reflectionAudioResp.error || 'Reflection narration unavailable.');

        // Runtime enforcement: the meditation+prayer (reflection) portion alone must total 90-120s
        // (see MEDITATION_TARGET_MIN_SEC etc above) - the verse reading before it is separate and
        // not counted against this target, per the content spec's own breakdown. A fixed word-count
        // target in the generation prompt can't guarantee this by itself - TTS pace varies by
        // language/engine - so this measures the actual synthesized audio and, if it misses, derives
        // a target word count from THIS language's own real words-per-second rate and asks for a
        // rewrite sized to it. Bounded attempts, same philosophy as this app's other quality gates
        // (Indic-Parler's completeness check, background composition review): accept the closest
        // result rather than blocking generation if it still doesn't land exactly in range.
        for (let attempt = 0; attempt < MEDITATION_MAX_ADJUST_ATTEMPTS; attempt++) {
          const reflectionDurationSec = pcm16Base64DurationSeconds(reflectionAudioResp.audioBase64!);
          if (reflectionDurationSec >= MEDITATION_TARGET_MIN_SEC && reflectionDurationSec <= MEDITATION_TARGET_MAX_SEC) break;

          // invitationWords accounts for the fixed PRAYER_INVITATION line mixed into what was
          // actually synthesized (buildReflectionText): included in currentWords so wordsPerSecond
          // reflects real synthesized content, then subtracted back out of targetTotalWords since
          // that figure is handed to adjustMeditationLength, which only rewrites explanation+prayer
          // - the invitation line itself is fixed and never resized.
          const invitationWords = wordCount(PRAYER_INVITATION[lang.primaryLang]);
          const currentWords = wordCount(med.explanation) + invitationWords + wordCount(med.prayer);
          const wordsPerSecond = currentWords / reflectionDurationSec;
          const targetTotalWords = Math.max(60, Math.round(MEDITATION_TARGET_MID_SEC * wordsPerSecond) - invitationWords);

          try {
            const adjusted = await adjustMeditationLength(verse.reference, lang.text, lang.primaryLang, med.explanation, med.prayer, targetTotalWords);
            const resynth = await synthesizeVerseAudio(buildReflectionText(lang.primaryLang, adjusted.meditation.explanation, adjusted.meditation.prayer));
            // Only commit the rewrite once its own audio is confirmed synthesizable - otherwise
            // keep the last known-good med/reflectionAudioResp rather than replacing it with a
            // revision that has no usable audio.
            if (!resynth.audioBase64) break;
            med = adjusted.meditation;
            reflectionAudioResp = resynth;
          } catch {
            break; // keep the closest attempt so far rather than failing the whole video over a missed runtime target
          }
        }

        // The adjustment loop above only ever commits reflectionAudioResp once its audioBase64 is
        // confirmed non-null (see the resynth check), so this can't actually be null - the check
        // just gives TypeScript's control-flow analysis (which can't see across the loop's
        // reassignment) what it needs, and fails loudly instead of silently if that ever changes.
        if (!reflectionAudioResp.audioBase64) throw new Error('Reflection narration unavailable.');

        const [verseAudioResp, posterBase64] = await Promise.all([verseAudioPromise, posterBase64Promise]);
        if (!verseAudioResp.audioBase64) throw new Error(verseAudioResp.error || 'Verse narration unavailable.');

        const wavBase64 = combinePcm16PartsToWavBase64([verseAudioResp.audioBase64, reflectionAudioResp.audioBase64], MEDITATION_SILENCE_SEC);
        // Landscape 16:9, not the app's usual 9:16 portrait (see MEDITATION_VIDEO_WIDTH/HEIGHT
        // above) - YouTube auto-classifies any vertical/square video under 3 minutes as a Short
        // regardless of upload metadata, and the Meditation Video (verse + reflection) is usually
        // well under that even at its 90-120s reflection target. 'contain-blur' fits the poster
        // (still rendered at posterRenderer.ts's standard 1080x1920 - not rewritten for landscape)
        // inside the wider frame with a blurred pillarbox rather than cropping it, which a plain
        // 'cover' fit would do almost entirely to a portrait source in a landscape target.
        // The narration opens with the verse reading, so its word timings apply as-is.
        const frames = await meditationFramesPromise;
        const highlight = await buildVideoHighlight(frames.boxes, frames.layerFrames, verseAudioResp, lang.text, lang.primaryLang);
        const videoResp = await generateNarrationVideo(posterBase64, wavBase64, {
          ...(highlight ? { highlight } : {}),
          width: MEDITATION_VIDEO_WIDTH, height: MEDITATION_VIDEO_HEIGHT, fitMode: 'cover', // frame is already 1920x1080
        });
        results[lang.key] = {
          kind: 'longform',
          label: VIDEO_LANG_LABELS[lang.key],
          filename: `${filenamePrefix}.mp4`,
          blobUrl: dataUrlToBlobUrl(videoResp.videoBase64),
          output: { date, reference: verse.reference, file: `${VIDEO_LANG_CODE[lang.key]}-meditation.mp4` },
          youtube: await youtubePromise,
        };
        setMeditationStep(lang.key, 'done');
      } catch (err: any) {
        setMeditationStep(lang.key, 'error');
        const message = err.message || 'failed';
        errorsByLang[lang.key] = message;
        errors.push(`${VIDEO_LANG_LABELS[lang.key]}: ${message}`);
      }
    }));

    setMeditations(results);
    if (errors.length) setMeditationError(errors.join(' — '));
    await persistVideoResults(verse, ctx.analysis, results, 'meditations', errorsByLang);
    return { error: errors.length ? errors.join(' — ') : null, results, meditationTexts: meditationByLang };
  };

  // refOverride: used by bulk mode's queue below to generate for a reference other than the
  // `reference` field's current value, without relying on a setReference(...) state update landing
  // before this function's closure reads it (React state updates aren't synchronous). The
  // single-verse "Generate" button's own onClick calls this with no argument, so it's unaffected -
  // ref still comes from the `reference` field exactly as before.
  const handleGenerate = async (
    refOverride?: string,
    // Bulk mode's per-item progress hook (see BulkResultEntry) - undefined for the single-verse
    // "Generate" button, which has no need for it since it already shows live progress via the
    // shared steps/videoSteps/meditationSteps state directly.
    onItemStatus?: (kind: 'poster' | 'video' | 'meditation', status: StepStatus) => void
  ): Promise<GenerateOutcome> => {
    const ref = (refOverride ?? reference).trim();
    if (!ref || (!includePoster && !includeVideo && !includeMeditation)) {
      return { ok: false, error: 'Nothing to generate.' };
    }

    setIsGenerating(true);
    setError(null);
    setVerses(null);
    setPosters(null);
    setSteps(initialSteps());
    narrationContextRef.current = null;
    setHasNarrationContext(false);
    setVideos(null);
    setVideoError(null);
    setVideoSteps(pendingLangSteps());
    setMeditations(null);
    setMeditationError(null);
    setMeditationTexts(null);
    setMeditationSteps(pendingLangSteps());

    setStep('verse', 'active');
    let verse: DailyVerse;
    try {
      verse = await lookupVerse(ref);
    } catch (err: any) {
      setStep('verse', 'error');
      const message = err.message || 'Verse lookup failed.';
      setError(message);
      setIsGenerating(false);
      return { ok: false, error: message };
    }
    if (!verse.english || !verse.tamil || !verse.telugu) {
      setStep('verse', 'error');
      const missing = [!verse.english && 'English', !verse.tamil && 'Tamil', !verse.telugu && 'Telugu'].filter(Boolean).join(', ');
      const message = `Translation unavailable for this reference (missing: ${missing}).`;
      setError(message);
      setIsGenerating(false);
      return { ok: false, error: message };
    }
    setStep('verse', 'done');
    setVerses(verse);

    // Meditation text only needs the verse itself, so its Claude calls start now and overlap the
    // background/poster/video work below; runMeditationGeneration awaits it (and reports any failure).
    const meditationContent = includeMeditation ? requestMeditationContent(verse) : undefined;
    meditationContent?.catch(() => {}); // handled in runMeditationGeneration; avoids an unhandled rejection if we bail out early

    setStep('claude', 'active');
    setStep('background', 'active');
    // ONE shared vertical background/analysis for Poster, Video, AND Meditation alike - previously
    // Poster fetched its own separate editorial-style background inside renderAndSavePosters,
    // costing a second Claude+Pollinations call whenever combined with Video/Meditation. Now always
    // fetched exactly once per verse regardless of which of the three are checked (per explicit
    // request to use the same image across all three outputs).
    let backgroundImageBase64: string | null = null;
    let imageSource: 'pollinations' | 'stock' = 'pollinations';
    let analysis: VerseAnalysis | null = null;
    let versePortion: VersePortion;
    try {
      // Run alongside the background/analysis call, not after it - both only need the verse text
      // just looked up, so there's no reason to pay for this call's latency separately.
      // selectVersePortion() never rejects on a well-formed request (the server always resolves
      // to the full verse on any internal failure), but the fetch itself still can - if it does,
      // fall back to the full verse locally rather than failing poster generation over it.
      const [result, portionResult] = await Promise.all([
        analyzeAndGenerateBackground(verse.reference, verse.english.text, verse.tamil.text, verse.telugu.text),
        selectVersePortion(verse.reference, verse.english.text, verse.tamil.text, verse.telugu.text).catch((err) => {
          console.warn('[portion] selection request failed, using full verse:', err);
          return {
            portion: {
              decision: 'full' as const,
              english: verse.english!.text, tamil: verse.tamil!.text, telugu: verse.telugu!.text,
              reason: 'client-side request failure',
            },
          };
        }),
      ]);
      setStep('claude', 'done');
      setStep('background', 'done');
      backgroundImageBase64 = result.backgroundImageBase64;
      imageSource = result.imageSource ?? 'pollinations';
      setStockImageNotice(imageSource === 'stock');
      analysis = result.analysis;
      versePortion = portionResult.portion;
      setLastVersePortion(versePortion);
      if (process.env.NODE_ENV !== 'production') {
        console.info('[portion] verse portion decision', versePortion.decision, '| reason:', versePortion.reason);
      }
    } catch (err: any) {
      const apiErr = err instanceof ApiError ? err : null;
      setStep('claude', apiErr?.data?.analysis ? 'done' : 'error');
      setStep('background', 'error');
      const message = err.message || 'Background image generation failed.';
      setError(message);
      setIsGenerating(false);
      return { ok: false, error: message };
    }

    // Local (non-React-state) bookkeeping purely for this function's own return value below - the
    // per-phase setError/setVideoError/setMeditationError/setPosters/setVideos/setMeditations calls
    // below remain the actual source of truth for the single-verse UI, unaffected by this. Bulk
    // mode's per-verse download button (see GenerateOutcome) is what actually needs these, since it
    // can't rely on the shared state under parallel execution.
    let posterError: string | null = null;
    let postersResult: { tamil: PosterResult; telugu: PosterResult } | null = null;
    let videoErrorResult: string | null = null;
    let videosResult: Partial<Record<VideoLangKey, VideoResult>> | null = null;
    let meditationErrorResult: string | null = null;
    let meditationsResult: Partial<Record<VideoLangKey, VideoResult>> | null = null;
    let meditationTextsResult: Record<'en' | 'ta' | 'te', MeditationText> | null = null;

    try {
      const [bgImg, logoImg] = await Promise.all([
        loadImage(base64ToImageDataUrl(backgroundImageBase64!)),
        loadImage(ministryLogoUrl).catch(() => null),
      ]);
      const ctx: NarrationContext = { bgImg, logoImg, analysis: analysis! };
      narrationContextRef.current = ctx;
      setHasNarrationContext(true);

      // Posters run alongside the two video pipelines below - they share only the already-loaded
      // background/analysis, so there is no reason for the videos to wait on poster design + render.
      const posterTask = includePoster ? (async () => {
        onItemStatus?.('poster', 'active');
        setStep('tamilPoster', 'active');
        setStep('teluguPoster', 'active');
        try {
          // Claude's designs for this background first; the poster pair is rendered with its first
          // design (Claude's top pick), or the automatic layout when none came back.
          const designs = await loadPosterDesigns(verse, backgroundImageBase64!, analysis!);
          postersResult = await renderAndSavePosters(verse, versePortion, bgImg, logoImg, analysis!, imageSource, designs[0]);
          setStep('tamilPoster', 'done');
          setStep('teluguPoster', 'done');
          setPosters(postersResult);
          posterContextRef.current = { verse, portion: versePortion, bgImg, logoImg, analysis: analysis!, imageSource };
          setPosterDesigns(designs);
          setSelectedDesignIdx(designs.length ? 0 : -1);
          setDesignPreviews({});
          if (!bulkMode) {
            void buildDesignPreviews(designs);
            void loadPostCaptions(verse, analysis!);
          }
          onItemStatus?.('poster', 'done');
        } catch (err: any) {
          setStep('tamilPoster', 'error');
          setStep('teluguPoster', 'error');
          posterError = 'Failed to render posters: ' + (err.message || err);
          setError(posterError);
          onItemStatus?.('poster', 'error');
        }
      })() : null;

      // Video and Meditation run side by side rather than Meditation waiting for every Narration
      // Video (and its uploads) to finish first. Safe on this machine's memory: the one heavy
      // engine, Tamil's Indic-Parler, is already limited to one run at a time server-wide
      // (runIndicParlerSerialized in server.ts), and the verse reading both share is synthesized
      // once (synthesizeNarrationCached). Auto-upload runs per batch, as soon as that batch's videos
      // exist, rather than once at the end - in bulk mode the shared results state is overwritten by
      // the next verse, so waiting would mean uploading only whichever verse happened to finish last.
      // uploadAllVideoResults queues the two batches so they still upload one at a time.
      const videoTask = includeVideo ? (async () => {
        onItemStatus?.('video', 'active');
        const videoOutcome = await runVideoGeneration(verse, ctx, versePortion);
        videoErrorResult = videoOutcome.error;
        videosResult = videoOutcome.results;
        onItemStatus?.('video', videoOutcome.error ? 'error' : 'done');
        if (autoUploadYouTube && youtubeConfigured) await uploadAllVideoResults(videoOutcome.results);
      })() : null;

      const meditationTask = includeMeditation ? (async () => {
        onItemStatus?.('meditation', 'active');
        const meditationOutcome = await runMeditationGeneration(verse, ctx, versePortion, meditationContent);
        meditationErrorResult = meditationOutcome.error;
        meditationsResult = meditationOutcome.results;
        meditationTextsResult = meditationOutcome.meditationTexts;
        onItemStatus?.('meditation', meditationOutcome.error ? 'error' : 'done');
        if (autoUploadYouTube && youtubeConfigured) await uploadAllVideoResults(meditationOutcome.results);
      })() : null;

      await Promise.all([posterTask, videoTask, meditationTask]);
    } catch (err: any) {
      const message = 'Failed to load background image: ' + (err.message || err);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setIsGenerating(false);
    }

    const combinedError = [posterError, videoErrorResult, meditationErrorResult].filter(Boolean).join(' — ');
    return {
      ok: !combinedError,
      error: combinedError || undefined,
      verse,
      posters: postersResult,
      videos: videosResult,
      meditations: meditationsResult,
      meditationTexts: meditationTextsResult,
    };
  };

  // "Regenerate image" (single-verse mode only, next to the poster preview below): forces a brand
  // new Pollinations background for the verse currently on screen - same theme/concept/color-grade
  // assignment (Claude analysis stays cached, see services/verseApi.ts's forceRegenerate), just a
  // different actual photo - then re-renders both posters from it. Skips verse lookup entirely, and
  // reuses lastVersePortion (set by handleGenerate above) rather than re-calling selectVersePortion.
  // Since Poster/Video/Meditation now all share the ONE background, this also refreshes
  // narrationContextRef (when it exists) so a Video/Meditation generated afterward uses the same
  // fresh photo instead of the stale one from the original handleGenerate call.
  const handleRegenerateImage = async () => {
    if (!verses || !lastVersePortion || isRegeneratingImage) return;
    setIsRegeneratingImage(true);
    setError(null);
    try {
      const result = await analyzeAndGenerateBackground(
        verses.reference, verses.english!.text, verses.tamil!.text, verses.telugu!.text, true
      );
      const [bgImg, logoImg] = await Promise.all([
        loadImage(base64ToImageDataUrl(result.backgroundImageBase64)),
        loadImage(ministryLogoUrl).catch(() => null),
      ]);
      if (narrationContextRef.current) {
        narrationContextRef.current = { bgImg, logoImg, analysis: result.analysis };
      }
      const newImageSource = result.imageSource ?? 'pollinations';
      setStockImageNotice(newImageSource === 'stock');
      // New photo = new empty space, so the previous designs no longer apply - ask again.
      const designs = await loadPosterDesigns(verses, result.backgroundImageBase64, result.analysis);
      const newPosters = await renderAndSavePosters(verses, lastVersePortion, bgImg, logoImg, result.analysis, newImageSource, designs[0]);
      setPosters(newPosters);
      posterContextRef.current = { verse: verses, portion: lastVersePortion, bgImg, logoImg, analysis: result.analysis, imageSource: newImageSource };
      setPosterDesigns(designs);
      setSelectedDesignIdx(designs.length ? 0 : -1);
      setDesignPreviews({});
      void buildDesignPreviews(designs);
    } catch (err: any) {
      setError('Failed to regenerate image: ' + (err.message || err));
    } finally {
      setIsRegeneratingImage(false);
    }
  };

  const parseBulkReferences = (text: string): string[] => {
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const line of text.split('\n')) {
      const ref = line.trim();
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
    return refs;
  };

  // Parallel per explicit request - every verse gets the exact same handleGenerate(...) pipeline a
  // single "Generate" click runs, all fired at once instead of queued one after another. One
  // verse's failure (a bad reference, a transient API error) doesn't stop the others - each is
  // caught and logged into its own bulkResults row independently.
  //
  // What actually runs concurrently vs. what still queues up: Claude analysis, Pollinations.ai
  // background images, and Piper TTS (English/Telugu) have no cross-request contention and genuinely
  // run in parallel. Tamil narration/meditation audio (Indic-Parler) is a different story - it's a
  // multi-GB local model, and server.ts already serializes every Indic-Parler subprocess call
  // process-wide (runIndicParlerSerialized/indicParlerQueue) regardless of how many verses this fires
  // at once, specifically because running more than one at a time was verified directly (this
  // session) to push free memory critically low and cause degenerate/garbled output. So firing a
  // large batch with Meditation checked still means those Tamil calls queue up behind each other
  // one at a time under the hood - parallelizing here doesn't remove that wait, it just means every
  // verse's non-Tamil work (and Piper/analysis/images) no longer waits on it needlessly too.
  //
  // narrationContextRef is written by each concurrent handleGenerate call - see
  // persistVideoResults' analysis parameter above for why that's safe now (each save uses its own
  // call's local ctx.analysis, not that ref) rather than a correctness hazard.
  // A per-kind status left 'pending' once the whole verse settles means that kind never got to run
  // (e.g. verse lookup or background generation failed before reaching it) - surface that as
  // 'error' rather than leaving its icon spinning/pending forever. Anything already 'done' or
  // 'error' (set live via onItemStatus as that kind actually ran) is left untouched.
  const finalizeItemStatus = (current: StepStatus | undefined, ok: boolean): StepStatus | undefined => {
    if (current === undefined || current === 'done' || current === 'error') return current;
    return ok ? 'done' : 'error';
  };

  const runBulkGenerate = async () => {
    const refs = parseBulkReferences(bulkText);
    if (!refs.length || isBulkGenerating) return;

    // Snapshot which kinds are selected once, at kickoff - the checkboxes stay interactive during
    // the run, but every queued verse should generate (and report progress for) the same set of
    // kinds it was queued with, not whatever the checkboxes happen to say by the time it finishes.
    const kinds = { poster: includePoster, video: includeVideo, meditation: includeMeditation };

    setIsBulkGenerating(true);
    setBulkResults(refs.map((reference) => ({
      reference,
      status: 'active' as StepStatus,
      posterStatus: kinds.poster ? 'pending' : undefined,
      videoStatus: kinds.video ? 'pending' : undefined,
      meditationStatus: kinds.meditation ? 'pending' : undefined,
    })));

    await Promise.all(refs.map(async (ref, i) => {
      const onItemStatus = (kind: 'poster' | 'video' | 'meditation', status: StepStatus) => {
        setBulkResults((prev) => prev.map((r, idx) => (
          idx === i
            ? { ...r, [`${kind}Status`]: status }
            : r
        )));
      };
      const result = await handleGenerate(ref, onItemStatus);
      setBulkResults((prev) => prev.map((r, idx) => (
        idx === i ? {
          ...r,
          status: result.ok ? 'done' : 'error',
          error: result.ok ? undefined : result.error,
          posterStatus: finalizeItemStatus(r.posterStatus, result.ok),
          videoStatus: finalizeItemStatus(r.videoStatus, result.ok),
          meditationStatus: finalizeItemStatus(r.meditationStatus, result.ok),
          verse: result.verse,
          posters: result.posters,
          videos: result.videos,
          meditations: result.meditations,
          meditationTexts: result.meditationTexts,
        } : r
      )));
    }));

    setIsBulkGenerating(false);
  };

  const hasDownloadableContent = Boolean(posters || videos || meditations);

  // Bundles everything actually generated this run into one zip - posters/, videos/, meditation/ -
  // rather than firing several simultaneous <a download> clicks, which browsers routinely block or
  // prompt for past the first one or two.
  // Adds one video's .mp4 plus its YouTube upload package (thumbnail + a title/description .txt
  // ready to paste into YouTube's upload form) into `folder`, alongside the video - best-effort,
  // since `youtube` is itself best-effort (see VideoResult) and may be absent.
  const addVideoResultToZip = async (folder: JSZip, result: VideoResult) => {
    folder.file(result.filename, await blobUrlToBytes(result.blobUrl));
    if (!result.youtube) return;
    const { title, description, seriesLabel, thumbnailBlobUrl, thumbnailFilename } = result.youtube;
    folder.file(thumbnailFilename, await blobUrlToBytes(thumbnailBlobUrl));
    const metadataFilename = result.filename.replace(/\.mp4$/, '-metadata.txt');
    folder.file(metadataFilename, `Title: ${title}\n\nDescription:\n${description}\n\nSeries: ${seriesLabel}\n`);
  };

  // Folder names match YouTube's own upload categories, not this app's internal feature names -
  // the plain Narration Video is short-form (a Short), the Meditation Video is long-form (a regular
  // Video) - so each folder's contents are exactly what's needed to upload directly to that section.
  // Shared by the single-verse "Download All" button and each bulk-mode row's own "Download" button
  // below - takes its data as plain arguments rather than reading component state, since bulk mode's
  // per-verse artifacts (see GenerateOutcome) live outside that state entirely.
  const buildBundleZipBlob = async (
    posters: { tamil: PosterResult; telugu: PosterResult } | null,
    videos: Partial<Record<VideoLangKey, VideoResult>> | null,
    meditations: Partial<Record<VideoLangKey, VideoResult>> | null,
    meditationTexts: Record<'en' | 'ta' | 'te', MeditationText> | null
  ): Promise<Blob> => {
    const zip = new JSZip();

    if (posters) {
      const folder = zip.folder('posters')!;
      for (const p of [posters.tamil, posters.telugu]) {
        folder.file(p.filename, await blobUrlToBytes(p.blobUrl));
      }
    }
    if (videos) {
      const folder = zip.folder('shorts')!;
      for (const key of VIDEO_LANG_ORDER) {
        const v = videos[key];
        if (v) await addVideoResultToZip(folder, v);
      }
    }
    if (meditations) {
      const folder = zip.folder('videos')!;
      for (const key of VIDEO_LANG_ORDER) {
        const m = meditations[key];
        if (m) await addVideoResultToZip(folder, m);
      }
      if (meditationTexts) {
        folder.file('meditation.json', JSON.stringify(meditationTexts, null, 2));
      }
    }

    return zip.generateAsync({ type: 'blob' });
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadAll = async () => {
    if (!verses) return;
    setIsDownloadingAll(true);
    try {
      const slug = slugify(verses.reference);
      const zipBlob = await buildBundleZipBlob(posters, videos, meditations, meditationTexts);
      triggerBlobDownload(zipBlob, `${slug}-bundle.zip`);
    } catch (err: any) {
      setError('Failed to bundle downloads: ' + (err.message || err));
    } finally {
      setIsDownloadingAll(false);
    }
  };

  // Per-verse download for one bulk-mode row (see bulkResults below) - each entry already carries
  // its own captured posters/videos/meditations from when that verse's handleGenerate resolved, so
  // this never touches the shared single-verse state (which bulk mode's parallel verses are
  // constantly overwriting).
  const [downloadingBulkRef, setDownloadingBulkRef] = useState<string | null>(null);
  const [uploadingBulkRef, setUploadingBulkRef] = useState<string | null>(null);

  // Uploads one bulk-mode verse's Shorts and Videos in one go. Bulk rows previously had a Download
  // button and nothing else, so a batch run with auto-upload switched off left every video stranded
  // with no way to publish it short of re-running the verse on its own.
  const handleUploadBulkEntry = async (entry: BulkResultEntry) => {
    setUploadingBulkRef(entry.reference);
    try {
      if (entry.videos) await uploadAllVideoResults(entry.videos);
      if (entry.meditations) await uploadAllVideoResults(entry.meditations);
    } finally {
      setUploadingBulkRef(null);
    }
  };

  // How many of this row's generated videos still have somewhere to go - drives both the button's
  // count and whether it is worth showing at all.
  const bulkEntryPendingUploads = (entry: BulkResultEntry): number =>
    [entry.videos, entry.meditations].reduce((total, group) => {
      if (!group) return total;
      return total + VIDEO_LANG_ORDER.filter((key) => {
        const result = group[key];
        if (!result?.youtube) return false;
        const state = uploadStates[result.filename]?.state;
        return state !== 'done' && state !== 'uploading';
      }).length;
    }, 0);
  const handleDownloadBulkEntry = async (entry: BulkResultEntry) => {
    setDownloadingBulkRef(entry.reference);
    try {
      const slug = slugify(entry.verse?.reference || entry.reference);
      const zipBlob = await buildBundleZipBlob(
        entry.posters ?? null, entry.videos ?? null, entry.meditations ?? null, entry.meditationTexts ?? null
      );
      triggerBlobDownload(zipBlob, `${slug}-bundle.zip`);
    } catch (err: any) {
      setError('Failed to bundle downloads: ' + (err.message || err));
    } finally {
      setDownloadingBulkRef(null);
    }
  };

  const StepIcon = ({ status, size = 'w-5 h-5' }: { status: StepStatus; size?: string }) => {
    if (status === 'done') return <CheckCircle2 className={`${size} text-green-500`} />;
    if (status === 'active') return <Loader2 className={`${size} text-amber-500 animate-spin`} />;
    if (status === 'error') return <XCircle className={`${size} text-red-500`} />;
    return <Circle className={`${size} text-stone-600`} />;
  };

  // Verse plan (data/verse-plan-2026-oct-dec.json): picking a day fills both the date and the reference.
  const plannedForDate = getPlanEntry(date);
  const handlePickPlanEntry = (entry: VersePlanEntry) => {
    setDate(entry.date);
    setReference(entry.reference);
    setBulkMode(false);
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-stone-900/40 rounded-3xl border border-stone-800/50 backdrop-blur-xl shadow-2xl">
      <h2 className="text-2xl font-display font-bold text-amber-500 text-center mb-6">Daily Bible Verse</h2>

      <div className="flex gap-2 mb-4">
        {([
          { key: false, label: 'Single' },
          { key: true, label: 'Bulk' },
        ] as const).map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            onClick={() => setBulkMode(opt.key)}
            disabled={isGenerating || isBulkGenerating}
            className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              bulkMode === opt.key ? 'bg-amber-600/20 border-amber-600 text-amber-400' : 'bg-stone-900 border-stone-700 text-stone-400'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <VersePlanPicker
            label="Date"
            selectedDate={date}
            today={todayIso()}
            disabled={isGenerating || isBulkGenerating}
            onPick={handlePickPlanEntry}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-200 focus:outline-none focus:border-amber-500 transition-colors"
          />
          {plannedForDate && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-amber-700/40 bg-amber-900/10 px-3 py-2">
              <div className="min-w-0 text-xs">
                <div className="text-stone-400">
                  Planned for {plannedForDate.day} · <span className="text-stone-300">{plannedForDate.theme}</span>
                  {plannedForDate.occasion && <span className="text-fuchsia-300"> · {plannedForDate.occasion}</span>}
                </div>
                <div className="text-amber-300 font-medium truncate">
                  {plannedForDate.reference} <span className="text-stone-500 font-normal">— {plannedForDate.hook}</span>
                </div>
              </div>
              {(bulkMode || reference.trim() !== plannedForDate.reference) && (
                <button
                  type="button"
                  onClick={() => handlePickPlanEntry(plannedForDate)}
                  disabled={isGenerating || isBulkGenerating}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-stone-950 hover:bg-amber-500 disabled:opacity-50"
                >
                  Use
                </button>
              )}
            </div>
          )}
        </div>

        {bulkMode ? (
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">
              Bible References (one per line)
            </label>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Psalm 23:1\nJohn 3:16\nRomans 8:28'}
              rows={6}
              className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-200 focus:outline-none focus:border-amber-500 transition-colors font-mono text-sm resize-y"
            />
            <p className="mt-2 text-xs flex items-center justify-between gap-2">
              <span className="text-stone-500">{parseBulkReferences(bulkText).length} verse(s) queued</span>
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${imageServiceStatus === 'connected' ? 'bg-green-500' : imageServiceStatus === 'offline' ? 'bg-red-500' : 'bg-stone-500 animate-pulse'}`} />
                <span className="text-stone-500">
                  {imageServiceStatus === 'checking' ? 'Checking image service...' : imageServiceStatus === 'connected' ? 'Image service connected' : 'Image service unreachable'}
                </span>
              </span>
            </p>
            <p className="mt-2 text-xs text-stone-600">
              All verses generate in parallel. Tamil narration/meditation audio still processes one at a time behind the scenes regardless (a local-model limit), so a large batch with Meditation checked will still take a while even though everything else runs at once.
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Bible Reference</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Psalm 23:1"
              className="w-full bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-stone-200 focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="mt-2 text-xs flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${imageServiceStatus === 'connected' ? 'bg-green-500' : imageServiceStatus === 'offline' ? 'bg-red-500' : 'bg-stone-500 animate-pulse'}`} />
              <span className="text-stone-500">
                {imageServiceStatus === 'checking' ? 'Checking image service...' : imageServiceStatus === 'connected' ? 'Image service connected (Pollinations.ai)' : 'Image service unreachable'}
              </span>
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Generate</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'poster', label: 'Poster', checked: includePoster, set: setIncludePoster },
              { key: 'video', label: 'Video', checked: includeVideo, set: setIncludeVideo },
              { key: 'meditation', label: 'Meditation', checked: includeMeditation, set: setIncludeMeditation },
            ] as const).map((opt) => (
              <label
                key={opt.key}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm cursor-pointer transition-colors ${
                  opt.checked ? 'bg-amber-600/20 border-amber-600 text-amber-400' : 'bg-stone-900 border-stone-700 text-stone-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={opt.checked}
                  onChange={(e) => opt.set(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {(includeVideo || includeMeditation) && (
            youtubeConfigured ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-stone-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUploadYouTube}
                  onChange={(e) => setAutoUploadYouTube(e.target.checked)}
                  className="w-3.5 h-3.5 accent-red-600"
                />
                Auto-upload Shorts and Videos to YouTube as private
              </label>
            ) : (
              <p className="mt-2 text-xs text-stone-500 leading-relaxed">
                <span className="text-stone-400">YouTube upload is off.</span>{' '}
                Run <code className="text-amber-500/90">scripts/youtube_authorize.ts</code> once, then set{' '}
                <code className="text-amber-500/90">YOUTUBE_CLIENT_ID</code>,{' '}
                <code className="text-amber-500/90">YOUTUBE_CLIENT_SECRET</code> and{' '}
                <code className="text-amber-500/90">YOUTUBE_REFRESH_TOKEN</code> in{' '}
                <code className="text-amber-500/90">.env</code> and restart. Videos still generate and download normally.
              </p>
            )
          )}
        </div>

        {bulkMode ? (
          <Button
            onClick={runBulkGenerate}
            isLoading={isBulkGenerating}
            disabled={!parseBulkReferences(bulkText).length || (!includePoster && !includeVideo && !includeMeditation)}
            className="w-full py-3"
          >
            {`Generate All (${parseBulkReferences(bulkText).length})`}
          </Button>
        ) : (
          <Button
            onClick={() => handleGenerate()}
            isLoading={isGenerating}
            disabled={!reference.trim() || (!includePoster && !includeVideo && !includeMeditation)}
            className="w-full py-3"
          >
            Generate
          </Button>
        )}
      </div>

      {bulkResults.length > 0 && (
        <div className="mt-6 p-4 bg-stone-950/50 rounded-2xl border border-stone-800 space-y-2">
          <div className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-1">
            Batch progress ({bulkResults.filter((r) => r.status === 'done').length}/{bulkResults.length} done
            {bulkResults.some((r) => r.status === 'error') ? `, ${bulkResults.filter((r) => r.status === 'error').length} failed` : ''})
          </div>
          {bulkResults.map((r) => {
            const hasContent = Boolean(r.posters || r.videos || r.meditations);
            // Posters alone can't be uploaded, so the upload button only appears once a row has
            // actually produced at least one video with YouTube metadata attached.
            const hasUploadableVideos = [r.videos, r.meditations].some((group) =>
              group ? VIDEO_LANG_ORDER.some((key) => group[key]?.youtube) : false);
            const pendingUploads = bulkEntryPendingUploads(r);
            const items: { key: 'poster' | 'video' | 'meditation'; label: string; status: StepStatus }[] = [
              ...(r.posterStatus ? [{ key: 'poster' as const, label: 'Poster', status: r.posterStatus }] : []),
              ...(r.videoStatus ? [{ key: 'video' as const, label: 'Video', status: r.videoStatus }] : []),
              ...(r.meditationStatus ? [{ key: 'meditation' as const, label: 'Meditation', status: r.meditationStatus }] : []),
            ];
            return (
              <div key={r.reference} className="space-y-1.5">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5"><StepIcon status={r.status} /></div>
                  <div className="min-w-0 flex-1">
                    <span className={`text-sm ${r.status === 'done' ? 'text-stone-300' : r.status === 'error' ? 'text-red-400' : 'text-stone-500'}`}>
                      {r.reference}
                    </span>
                    {r.error && <p className="text-xs text-red-400/80 mt-0.5">{r.error}</p>}
                  </div>
                  {r.status === 'done' && hasContent && (
                    <div className="flex-shrink-0 flex items-center gap-1.5">
                      {hasUploadableVideos && (
                        <button
                          type="button"
                          onClick={() => handleUploadBulkEntry(r)}
                          disabled={!youtubeConfigured || uploadingBulkRef === r.reference || pendingUploads === 0}
                          title={youtubeConfigured ? undefined : YOUTUBE_SETUP_HINT}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-700 hover:bg-red-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          {uploadingBulkRef === r.reference
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <UploadCloud className="w-3.5 h-3.5" />}
                          {pendingUploads === 0 && youtubeConfigured ? 'Uploaded' : `Upload (${pendingUploads})`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownloadBulkEntry(r)}
                        disabled={downloadingBulkRef === r.reference}
                        className="flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        {downloadingBulkRef === r.reference
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Download className="w-3.5 h-3.5" />}
                        Download
                      </button>
                    </div>
                  )}
                </div>
                {items.length > 0 && (
                  <div className="ml-8 flex flex-wrap gap-x-4 gap-y-1">
                    {items.map((item) => (
                      <div key={item.key} className="flex items-center gap-1.5">
                        <StepIcon status={item.status} size="w-3.5 h-3.5" />
                        <span className={`text-xs ${item.status === 'done' ? 'text-stone-400' : item.status === 'error' ? 'text-red-400' : 'text-stone-600'}`}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(isGenerating || Object.values(steps).some((s) => s !== 'pending')) && (
        <div className="mt-6 p-4 bg-stone-950/50 rounded-2xl border border-stone-800 space-y-2">
          {[...CORE_STEP_ORDER, ...(includePoster ? POSTER_STEP_ORDER : [])].map((key) => (
            <div key={key} className="flex items-center gap-3">
              <StepIcon status={steps[key]} />
              <span className={`text-sm ${steps[key] === 'done' ? 'text-stone-300' : steps[key] === 'error' ? 'text-red-400' : 'text-stone-500'}`}>
                {STEP_LABELS[key]}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm text-red-400">
          {error}
        </div>
      )}

      {stockImageNotice && (
        <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-sm text-amber-300">
          The image service was unavailable, so this poster uses an unrelated stock photo instead of an image made for this verse. Use “Regenerate image” to try again.
        </div>
      )}

      {verses && (
        <div className="mt-6 grid grid-cols-1 gap-3 text-sm">
          <div className="p-3 bg-stone-950/40 rounded-xl border border-stone-800">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">English &mdash; {verses.english!.reference}</div>
            <div className="text-stone-300 font-serif italic">{verses.english!.text}</div>
          </div>
          <div className="p-3 bg-stone-950/40 rounded-xl border border-stone-800">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Tamil &mdash; {verses.tamil!.reference}</div>
            <div className="text-stone-300">{verses.tamil!.text}</div>
          </div>
          <div className="p-3 bg-stone-950/40 rounded-xl border border-stone-800">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Telugu &mdash; {verses.telugu!.reference}</div>
            <div className="text-stone-300">{verses.telugu!.text}</div>
          </div>
        </div>
      )}

      {includePoster && posters && (
        <div className="mt-6">
          {!bulkMode && (
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={handleRegenerateImage}
                disabled={isRegeneratingImage || isGenerating || !lastVersePortion}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed text-stone-300 text-xs font-medium rounded-lg border border-stone-700 transition-colors"
              >
                {isRegeneratingImage
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
                {isRegeneratingImage ? 'Regenerating…' : 'Regenerate image'}
              </button>
              <a
                href={YOUTUBE_POSTS_URL}
                target="_blank"
                rel="noreferrer"
                title="Create a post in YouTube Studio: paste the copied caption and attach the downloaded poster"
                className="ml-2 flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <UploadCloud className="w-3.5 h-3.5" /> Open YouTube Posts
              </a>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {([['tamil', posters.tamil], ['telugu', posters.telugu]] as const).map(([key, poster]) => (
              <div key={poster.filename} className="bg-stone-950/60 rounded-2xl p-3 border border-stone-800">
                <div className="aspect-[4/5] rounded-xl overflow-hidden bg-stone-900">
                  <img src={poster.blobUrl} alt={poster.label} className="w-full h-full object-cover" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-stone-400">{poster.label}</span>
                  <div className="flex items-center gap-2">
                    {!bulkMode && (
                      <button
                        type="button"
                        onClick={() => handleCopyCaption(key)}
                        disabled={!postCaptions}
                        title={postCaptions ? 'Copy the YouTube post caption for this poster' : 'Writing caption…'}
                        className="flex items-center gap-1 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:cursor-wait text-stone-300 text-xs font-medium rounded-lg border border-stone-700 transition-colors"
                      >
                        {!postCaptions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {copiedCaption === key ? 'Copied' : 'Copy caption'}
                      </button>
                    )}
                    <a
                      href={poster.blobUrl}
                      download={poster.filename}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                  </div>
                </div>
                {!bulkMode && postCaptions && (
                  <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-stone-400 bg-stone-900/60 rounded-lg p-2 border border-stone-800 font-sans">
                    {postCaptions[key]}
                  </pre>
                )}
              </div>
            ))}
          </div>

          {!bulkMode && (posterDesigns.length > 0 || Object.keys(designPreviews).length > 0) && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-widest text-stone-500">Poster design</h3>
                {isApplyingDesign && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[-1, ...posterDesigns.map((_, i) => i)].map((idx) => {
                  const design = idx >= 0 ? posterDesigns[idx] : null;
                  const selected = idx === selectedDesignIdx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectDesign(idx)}
                      disabled={isApplyingDesign}
                      title={design?.rationale || 'Automatic layout chosen from the background'}
                      className={`text-left rounded-xl p-2 border transition-colors disabled:cursor-wait ${selected ? 'border-amber-500 bg-amber-500/10' : 'border-stone-800 bg-stone-950/60 hover:border-stone-600'}`}
                    >
                      <div className="aspect-[4/5] rounded-lg overflow-hidden bg-stone-900 flex items-center justify-center">
                        {designPreviews[idx]
                          ? <img src={designPreviews[idx]} alt={design?.name || 'Auto'} className="w-full h-full object-cover" />
                          : <Loader2 className="w-4 h-4 animate-spin text-stone-600" />}
                      </div>
                      <div className="mt-2 text-xs font-medium text-stone-300 truncate">{design?.name || 'Auto'}</div>
                      <div className="text-[10px] text-stone-500 truncate">
                        {design ? `${design.arrangement} · ${design.englishFont}` : 'automatic'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {includeVideo && hasNarrationContext && (
        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">Narration Videos</h3>

          {Object.values(videoSteps).some((s) => s !== 'pending') && (
            <div className="p-4 bg-stone-950/50 rounded-2xl border border-stone-800 space-y-2 mb-4">
              {VIDEO_LANG_ORDER.map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <StepIcon status={videoSteps[key]} />
                  <span className={`text-sm ${videoSteps[key] === 'done' ? 'text-stone-300' : videoSteps[key] === 'error' ? 'text-red-400' : 'text-stone-500'}`}>
                    {VIDEO_LANG_LABELS[key]} narration
                  </span>
                </div>
              ))}
            </div>
          )}

          {videoError && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm text-red-400">
              {videoError}
            </div>
          )}

          {videos && (
            <VideoResultsGrid
              results={videos}
              kind="short"
              youtubeConfigured={youtubeConfigured}
              uploadStates={uploadStates}
              onUpload={uploadVideoResult}
              onUploadAll={() => uploadAllVideoResults(videos)}
            />
          )}
        </div>
      )}

      {includeMeditation && hasNarrationContext && (
        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">Meditation</h3>

          {Object.values(meditationSteps).some((s) => s !== 'pending') && (
            <div className="p-4 bg-stone-950/50 rounded-2xl border border-stone-800 space-y-2 mb-4">
              {VIDEO_LANG_ORDER.map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <StepIcon status={meditationSteps[key]} />
                  <span className={`text-sm ${meditationSteps[key] === 'done' ? 'text-stone-300' : meditationSteps[key] === 'error' ? 'text-red-400' : 'text-stone-500'}`}>
                    {VIDEO_LANG_LABELS[key]} meditation
                  </span>
                </div>
              ))}
            </div>
          )}

          {meditationError && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-sm text-red-400">
              {meditationError}
            </div>
          )}

          {meditationTexts && (
            <div className="mb-4 p-3 bg-stone-950/40 rounded-xl border border-stone-800 text-sm space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Explanation (English)</div>
                <p className="text-stone-300">{meditationTexts.en.explanation}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1">Prayer (English)</div>
                <p className="text-stone-400 italic">{meditationTexts.en.prayer}</p>
              </div>
            </div>
          )}

          {meditations && (
            <VideoResultsGrid
              results={meditations}
              kind="longform"
              youtubeConfigured={youtubeConfigured}
              uploadStates={uploadStates}
              onUpload={uploadVideoResult}
              onUploadAll={() => uploadAllVideoResults(meditations)}
            />
          )}
        </div>
      )}

      {/* Bulk mode: each row above has its own Download button (posters/videos/meditations are
          captured per-verse there - see BulkResultEntry) since this single shared state only ever
          holds whichever verse most recently finished, not the whole batch. */}
      {!bulkMode && hasDownloadableContent && (
        <Button onClick={handleDownloadAll} isLoading={isDownloadingAll} className="w-full py-3 mt-6">
          <Download className="w-4 h-4" /> Download All (.zip)
        </Button>
      )}
    </div>
  );
};

// One results grid for a single video kind (see VideoKind) - the three per-language cards plus a
// header that names the kind and its real dimensions, and an "upload all" action for the whole
// batch. Both kinds render through this so the Shorts grid and the Meditation grid can never drift
// back into looking identical, which is what made it easy to upload one kind and silently skip the
// other. Each card's player uses the kind's true aspect ratio rather than assuming portrait.
function VideoResultsGrid({
  results, kind, youtubeConfigured, uploadStates, onUpload, onUploadAll,
}: {
  results: Partial<Record<VideoLangKey, VideoResult>>;
  kind: VideoKind;
  youtubeConfigured: boolean;
  uploadStates: Record<string, UploadEntry>;
  onUpload: (result: VideoResult) => void;
  onUploadAll: () => void;
}) {
  const meta = VIDEO_KIND_META[kind];
  const present = VIDEO_LANG_ORDER.filter((key) => results[key]);
  const uploadable = present.filter((key) => results[key]!.youtube);
  const pending = uploadable.filter((key) => {
    const entry = uploadStates[results[key]!.filename];
    return entry?.state !== 'done' && entry?.state !== 'uploading';
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-stone-800 text-stone-300 text-[10px] font-bold uppercase tracking-widest">
            {meta.badge}
          </span>
          <span className="text-[11px] text-stone-500">{meta.dimensions}</span>
        </div>
        {/* Shown even when YouTube isn't configured yet, as a disabled control rather than nothing at
            all - hiding it entirely made the app look like it had no upload feature (see
            YOUTUBE_SETUP_HINT), which is exactly the wrong signal when the videos are generated and
            ready to go. */}
        {uploadable.length > 0 && (
          <button
            onClick={onUploadAll}
            disabled={!youtubeConfigured || pending.length === 0}
            title={youtubeConfigured ? undefined : YOUTUBE_SETUP_HINT}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-[11px] font-medium rounded-lg transition-colors"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            {pending.length === 0 && youtubeConfigured
              ? 'All uploaded'
              : `${meta.uploadAllLabel} (${pending.length})`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {present.map((key) => {
          const result = results[key]!;
          const upload = uploadStates[result.filename] ?? { state: 'idle' as const };
          return (
            <div key={result.filename} className="bg-stone-950/60 rounded-2xl p-3 border border-stone-800">
              <div className={`${meta.aspectClass} rounded-xl overflow-hidden bg-stone-900`}>
                <video src={result.blobUrl} controls className="w-full h-full object-cover" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-stone-400">{result.label}</span>
                <a
                  href={result.blobUrl}
                  download={result.filename}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              </div>
              {result.youtube && (
                <YouTubePackagePreview
                  youtube={result.youtube}
                  youtubeConfigured={youtubeConfigured}
                  upload={upload}
                  onUpload={() => onUpload(result)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact preview of a video's YouTube upload package (see buildYouTubePackage above) - the
// thumbnail, title, series label and description a real upload would use - plus, when the server
// has YouTube OAuth configured (see scripts/youtube_authorize.ts), a one-click "Upload to YouTube"
// action that publishes this exact video/thumbnail/metadata via the Data API (see
// server/services/youtube.service.ts). Uploaded PRIVATE, not public, on purpose - this is a
// server-side-credentialed action publishing to a real live channel, so a private upload lets it be
// reviewed in YouTube Studio before manually making it public, rather than going live unattended.
// That still holds for the automatic uploads: see DailyVerseGenerator's uploadVideoResult, which is
// the single place any upload happens now. Presentational only - the upload state it renders and the
// action it fires both belong to the parent, since the same upload can be started from three places.
function YouTubePackagePreview({
  youtube, youtubeConfigured, upload, onUpload,
}: {
  youtube: NonNullable<VideoResult['youtube']>;
  youtubeConfigured: boolean;
  // Upload state and action both come from DailyVerseGenerator (see its uploadStates /
  // uploadVideoResult) rather than being owned here, so that a video uploaded by the per-kind
  // "Upload all" action or by the auto-upload pass shows as uploaded on its own card too.
  upload: UploadEntry;
  onUpload: () => void;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-stone-800">
      <div className="flex gap-3">
        <img
          src={youtube.thumbnailBlobUrl}
          alt="YouTube thumbnail"
          className="w-24 aspect-video rounded-lg object-cover border border-stone-800 flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-amber-500/80 mb-0.5">{youtube.seriesLabel}</div>
          <div className="text-xs font-medium text-stone-200 line-clamp-2">{youtube.title}</div>
          <a
            href={youtube.thumbnailBlobUrl}
            download={youtube.thumbnailFilename}
            className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-amber-500 hover:text-amber-400"
          >
            <Download className="w-3 h-3" /> Thumbnail
          </a>
        </div>
      </div>

      <div className="mt-2">
        {!youtubeConfigured ? (
          <button
            type="button"
            disabled
            title={YOUTUBE_SETUP_HINT}
            className="flex items-center gap-1 px-3 py-1.5 bg-stone-800 text-stone-500 text-[11px] font-medium rounded-lg cursor-not-allowed"
          >
            <UploadCloud className="w-3.5 h-3.5" /> Upload to YouTube
          </button>
        ) : (
          <>
          {upload.state === 'done' && upload.url ? (
            <a href={upload.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-green-400 hover:text-green-300 underline">
              {upload.publishAt
                ? `Scheduled for ${new Date(upload.publishAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - YouTube, Instagram, Facebook`
                : 'Uploaded (private) - view on YouTube'}
            </a>
          ) : (
            <button
              onClick={onUpload}
              disabled={upload.state === 'uploading'}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white text-[11px] font-medium rounded-lg transition-colors"
            >
              {upload.state === 'uploading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              {upload.state === 'uploading' ? 'Uploading...' : upload.state === 'error' ? 'Retry upload' : 'Upload to YouTube'}
            </button>
          )}
          {upload.state === 'error' && <p className="mt-1 text-[11px] text-red-400">{upload.error}</p>}
          {upload.state === 'done' && upload.warnings?.map((warning) => (
            <p key={warning} className="mt-1 text-[11px] text-amber-400">{warning}</p>
          ))}
          </>
        )}
      </div>
    </div>
  );
}

export default DailyVerseGenerator;
