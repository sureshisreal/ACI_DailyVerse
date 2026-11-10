import fs from 'fs';
import path from 'path';
import { askClaudeForJson } from './claude';
import { sha256 } from '../server/utils/hash';
import { assertNoForeignScript } from '../server/utils/scriptValidation';
import { sanitizeYoutubeTitle } from '../server/utils/youtubeTitle';

// Bump whenever the prompt or validation rules below change materially, so cache keys (which
// include this) invalidate old entries after a code change rather than only after a data change.
export const YOUTUBE_METADATA_VERSION = 2;

const CACHE_DIR = path.join(process.cwd(), 'cache', 'youtube-metadata');

// A fixed, closed set (like FontStyleKey in types.ts) rather than a freeform AI-written series
// name - keeps a channel's recurring playlists consistent verse-to-verse instead of Claude
// re-inventing wording each time. Claude only picks which key fits; the display name per language
// is a static lookup below, never generated.
export const SERIES_KEYS = ['morning', 'night', 'anxiety', 'strength', 'family', 'general'] as const;
export type SeriesKey = typeof SERIES_KEYS[number];

// Localized display names per series/language - not AI-generated (see SERIES_KEYS above), so a
// channel's playlist titles stay exactly consistent across every video rather than depending on
// Claude to phrase the same series the same way twice.
export const SERIES_DISPLAY_NAMES: Record<SeriesKey, Record<'en' | 'ta' | 'te', string>> = {
  morning: { en: 'Morning Prayer', ta: 'இன்றைய வேதாகம வசனம்', te: 'ఈ రోజు బైబిల్ వాక్యం' },
  night: { en: 'Bible Verse Before Sleep', ta: 'இரவு தூக்கத்திற்கு முன் வேத வசனம்', te: 'నిద్రకు ముందు బైబిల్ వాక్యం' },
  anxiety: { en: 'Bible Verses for Anxiety', ta: 'கவலைக்கான வேத வசனங்கள்', te: 'ఆందోళన కోసం బైబిల్ వాక్యాలు' },
  strength: { en: 'When You Need Strength', ta: 'உனக்கு பெலன் தேவைப்படும்போது', te: 'నీకు బలం అవసరమైనప్పుడు' },
  family: { en: "Today's Prayer for Your Family", ta: 'உங்கள் குடும்பத்திற்கான இன்றைய ஜெபம்', te: 'మీ కుటుంబం కోసం నేటి ప్రార్థన' },
  general: { en: 'Daily Bible Verse', ta: 'தினசரி வேத வசனம்', te: 'రోజువారీ బైబిల్ వాక్యం' },
};

export interface YouTubeMetadata {
  title: string;
  thumbnailText: string;
  description: string;
  seriesKey: SeriesKey;
}

const LANGUAGE_NAMES: Record<'en' | 'ta' | 'te', string> = { en: 'English', ta: 'Tamil', te: 'Telugu' };

// Same as ai/contentPackage.ts's TAMIL_TELUGU_MODEL: Tamil/Telugu pinned explicitly (now Claude Haiku 4.5).
const TAMIL_TELUGU_MODEL = 'claude-haiku-4-5';

function systemPromptFor(lang: 'en' | 'ta' | 'te'): string {
  const languageName = LANGUAGE_NAMES[lang];
  const languageRule = lang === 'en'
    ? 'Write in plain, natural, conversational English.'
    : `Compose directly and natively in ${languageName} - think in ${languageName}, don't mentally translate. Every single word in ${languageName} script only - never let a character from another script slip in, even mid-word.`;

  return `You are a YouTube metadata writer for a Christian devotional channel. Given one Bible verse, the everyday situation it speaks to, and a viewer hook already written for the video's opening, write upload metadata for that video's ${languageName}-language version. Respond with ONLY minified JSON, no prose, no markdown fences, in exactly this shape:
{"title":"...","thumbnailText":"...","description":"...","seriesKey":"one of: morning | night | anxiety | strength | family | general"}

${languageRule}

- "title": puts the human need/situation first, includes the Bible reference naturally, is accurate and emotionally resonant without being misleading. Never generic keyword-stuffing like "Bible Verse [Reference] Daily Devotional Christian" - write it the way a real caring person would title something they wanted a friend to click on. Under ~70 characters where the language allows. No hashtags in the title (they go at the end of the description), no quote marks around it, and write the Bible reference in its normal form with the book name capitalized (e.g. "Isaiah 65:17", never "isaiah-65-17").
- "thumbnailText": 2-5 words, instantly readable on a small mobile thumbnail, capturing the video's emotional core (e.g. "DON'T BE AFRAID", "GOD IS WITH YOU", "WHEN YOU FEEL ALONE") - never the full verse, never more than a short phrase.
- "description": 2-4 sentences: the devotional message in plain words, then the reference, then a warm invitation to keep watching more devotionals from this channel. End with 3-5 relevant hashtags (no more). Never unsupported promises, never keyword-stuffed.
- "seriesKey": whichever ONE of the six fixed options actually fits this verse's situation best - "general" if none of the other five clearly fit better.
- Never invent, rewrite, paraphrase, or quote Scripture differently than given - the verse is for context only.
- Never write anything manipulative or misleading: no "sent this message specifically to you," no fear-based "watch or else," no "you won't believe."`;
}

// Keyed by the verse's canonical (language-independent) reference, not the localized
// per-language reference string (e.g. Tamil/Telugu book names) or verse text - so all three
// languages' metadata for one verse land in the same cache file instead of one file each.
function cacheKeyFor(canonicalReference: string, viewerSituation: string, emotionalHook: string): string {
  return sha256([canonicalReference, viewerSituation, emotionalHook, String(YOUTUBE_METADATA_VERSION)].join('|'));
}

type YouTubeMetadataCacheFile = Partial<Record<'en' | 'ta' | 'te', YouTubeMetadata>>;

function readCache(key: string, lang: 'en' | 'ta' | 'te'): YouTubeMetadata | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    const parsed: YouTubeMetadataCacheFile = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed[lang] ?? null;
  } catch {
    return null;
  }
}

// One file per verse holding all three languages' metadata, not one file per (verse, language) -
// each language's write only ever adds/overwrites its own key, so the three sequential calls for
// one verse (see runVideoGeneration/runMeditationGeneration) merge into the same file rather than
// clobbering each other. Same merge pattern as manifest.service.ts's saveGeneration.
function writeCache(key: string, lang: 'en' | 'ta' | 'te', meta: YouTubeMetadata): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${key}.json`);
    let existing: YouTubeMetadataCacheFile = {};
    if (fs.existsSync(file)) {
      try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { existing = {}; }
    }
    existing[lang] = meta;
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.warn('[ai/youtubeMetadata] Failed to write cache:', err);
  }
}

const BANNED_PATTERNS = [/sent this (message |verse )?specifically to you/i, /god will (punish|curse)/i, /you won'?t believe/i, /watch (this|till the end) or/i];

function validate(raw: any, lang: 'en' | 'ta' | 'te'): YouTubeMetadata {
  const title = typeof raw?.title === 'string' ? sanitizeYoutubeTitle(raw.title) : '';
  const thumbnailText = typeof raw?.thumbnailText === 'string' ? raw.thumbnailText.trim() : '';
  const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
  const seriesKey = SERIES_KEYS.includes(raw?.seriesKey) ? raw.seriesKey : 'general';

  if (!title || !thumbnailText || !description) {
    throw new Error('YouTube metadata response missing title/thumbnailText/description');
  }
  if (BANNED_PATTERNS.some((re) => re.test(title) || re.test(description))) {
    throw new Error('YouTube metadata contained a manipulative/misleading pattern');
  }
  if (lang === 'ta' || lang === 'te') {
    assertNoForeignScript(title, lang, 'title');
    assertNoForeignScript(thumbnailText, lang, 'thumbnailText');
    assertNoForeignScript(description, lang, 'description');
  }
  return { title, thumbnailText, description, seriesKey };
}

// One Claude call per (verse, language). Cached one file per verse (see writeCache above) - only
// meaningful once a video/meditation is actually being generated for that language, since a
// poster-only generation has no video to attach upload metadata to, so callers should skip this
// entirely in that case.
export async function generateYouTubeMetadata(
  reference: string,
  verseText: string,
  lang: 'en' | 'ta' | 'te',
  viewerSituation: string,
  emotionalHook: string,
  canonicalReference: string
): Promise<YouTubeMetadata> {
  const key = cacheKeyFor(canonicalReference, viewerSituation, emotionalHook);
  const cached = readCache(key, lang);
  if (cached) return cached;

  const userPrompt = `Reference: ${reference}\nVerse: ${verseText}\nViewer situation: ${viewerSituation}\nOpening hook already used in the video: ${emotionalHook}`;
  const model = lang === 'en' ? undefined : TAMIL_TELUGU_MODEL;

  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askClaudeForJson(systemPromptFor(lang), userPrompt, 900, model);
      const meta = validate(raw, lang);
      writeCache(key, lang, meta);
      return meta;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
