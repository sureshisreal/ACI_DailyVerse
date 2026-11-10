import fs from 'fs';
import path from 'path';
import { askClaudeForText } from './claude';
import { sha256 } from '../server/utils/hash';
import { getVerseFromDb, type BibleLang } from '../bibleDb';
import { FOREIGN_SCRIPT_RANGES } from '../server/utils/scriptValidation';

// Bump whenever the prompt or validation rules below change materially, so cache keys (which
// include this) invalidate old entries after a code change rather than only after a data change.
export const CONTENT_PACKAGE_VERSION = 2;

const CACHE_DIR = path.join(process.cwd(), 'cache', 'content-package');

export interface VerseContent {
  morningThought: string;
  prayer: string;
  closingBlessing: string;
}

export interface PosterContent {
  title: string;
  morningMessage: string;
  closingLine: string;
  visualConcept: string;
  colorPalette: string;
  typography: string;
  backgroundDescription: string;
}

export interface VideoContent {
  title: string;
  hook: string;
  voiceoverScript: string;
  storyboard: string;
  onScreenText: string;
  voiceDirection: string;
  musicDirection: string;
}

export interface MeditationContent {
  title: string;
  script: string;
  voiceDirection: string;
  backgroundSound: string;
}

export interface LanguagePackage {
  reference: string; // localized reference (e.g. "சங்கீதம் 23:1"), from the local Bible DB
  verse: string; // exact verse text, from the local Bible DB - never Claude
  moment: VerseContent;
  poster: PosterContent;
  video: VideoContent;
  meditation: MeditationContent;
}

export interface ContentPackage {
  reference: string; // canonical English reference, as resolved by the DB
  en: LanguagePackage;
  ta: LanguagePackage;
  te: LanguagePackage;
}

// This is a creative-brief generator, not a media generator: "poster"/"video" fields are written
// direction (title, visual concept, color palette, storyboard, voiceover script...) for a human or
// a separate pipeline to act on - no image or video file is produced from this call. See
// components/posterRenderer.ts / server/services/image-generation.service.ts for the app's actual
// poster/video generation, which is a different, already-built path.
//
// One call per language, not one call covering all three: the combined response (moment + poster
// + video + meditation, each rich enough on its own, times three languages) reliably exceeded a
// single response's output budget and came back as truncated/invalid JSON in testing. Per-language
// calls are also more resilient - a Tamil-only validation failure (e.g. a foreign-script leak) only
// needs a Tamil-only retry, not regenerating already-good English/Telugu content too.
const LANGUAGE_NAMES: Record<'en' | 'ta' | 'te', string> = { en: 'English', ta: 'Tamil', te: 'Telugu' };

// Set to the cheapest model (Claude Haiku 4.5, also the ai/claude.ts default) to save cost. Known
// trade-off: Haiku has leaked stray Devanagari/Kannada/Malayalam characters into Tamil output here
// before - repairForeignScriptViolations and the retry loop below catch that, at the cost of extra
// calls. If it becomes frequent, pin a stronger model here (e.g. 'claude-sonnet-5-5').
const TAMIL_TELUGU_MODEL = 'claude-haiku-4-5';

function systemPromptFor(lang: 'en' | 'ta' | 'te'): string {
  const languageName = LANGUAGE_NAMES[lang];
  const languageRule = lang === 'en'
    ? 'Write in simple, warm, international, conversational English - avoid unnecessary theological terminology.'
    : `Compose directly and natively in ${languageName} - think in ${languageName}, don't mentally translate from an English draft. Same Scripture + same message + same emotion as the English version would carry, expressed in natural local language - never word-for-word translation. Short, simple sentences (roughly 8-15 words each) in everyday spoken devotional register, not formal/literary/Sanskritized vocabulary, not awkward literal English sentence structure carried over. Every single word in ${languageName} script only - never let a character from another script (Devanagari, Bengali, Kannada, Malayalam, etc.) slip in, even mid-word. Before finalizing, re-read every field one more time specifically checking for this - a single stray character from another script anywhere in the response makes the whole response unusable.`;

  return `You are an expert Bible devotional writer, ${languageName} editor, visual-content director, and meditation/audio scriptwriter. Given one Bible verse (its reference and exact text in ${languageName} - already resolved from a verified translation, shown for context only - never rewrite, translate, paraphrase, or quote it back differently than given), write a complete daily content package in ${languageName}: a devotional moment, a poster creative brief, a short-form video creative brief, and a 3-5 minute meditation script.

Respond with ONLY the following tags, in this exact order, and nothing else - no JSON, no markdown fences, no headings, no commentary before/after/between tags:
<MORNING_THOUGHT>...</MORNING_THOUGHT>
<PRAYER>...</PRAYER>
<CLOSING_BLESSING>...</CLOSING_BLESSING>
<POSTER_TITLE>...</POSTER_TITLE>
<POSTER_MESSAGE>...</POSTER_MESSAGE>
<POSTER_CLOSING_LINE>...</POSTER_CLOSING_LINE>
<POSTER_VISUAL_CONCEPT>...</POSTER_VISUAL_CONCEPT>
<POSTER_COLOR_PALETTE>...</POSTER_COLOR_PALETTE>
<POSTER_TYPOGRAPHY>...</POSTER_TYPOGRAPHY>
<POSTER_BACKGROUND>...</POSTER_BACKGROUND>
<VIDEO_TITLE>...</VIDEO_TITLE>
<VIDEO_HOOK>...</VIDEO_HOOK>
<VIDEO_VOICEOVER>...</VIDEO_VOICEOVER>
<VIDEO_STORYBOARD>...</VIDEO_STORYBOARD>
<VIDEO_ON_SCREEN_TEXT>...</VIDEO_ON_SCREEN_TEXT>
<VIDEO_VOICE_DIRECTION>...</VIDEO_VOICE_DIRECTION>
<VIDEO_MUSIC_DIRECTION>...</VIDEO_MUSIC_DIRECTION>
<MEDITATION_TITLE>...</MEDITATION_TITLE>
<MEDITATION_SCRIPT>...</MEDITATION_SCRIPT>
<MEDITATION_VOICE_DIRECTION>...</MEDITATION_VOICE_DIRECTION>
<MEDITATION_BACKGROUND_SOUND>...</MEDITATION_BACKGROUND_SOUND>

Write ordinary plain text inside each tag - normal quotation marks, apostrophes, commas and line breaks are all fine, nothing needs escaping (this is not JSON). Put exactly one field's content between each opening and closing tag; never nest tags or split one field across more than one tag pair.

Every field must be genuinely specific to THIS verse - never generic content that could apply to any reference. The moment, poster, video and meditation are four expressions of the same one central message from this Scripture, not four unrelated pieces.

LANGUAGE (critical): ${languageRule}

TONE (the actual point of this feature): peaceful, comforting, hopeful, God-centered, shareable. Gently invite the reader/listener toward God - never preach, command, condemn, use fear, attack or compare other religions, or pressure conversion. A non-Christian friend should be able to receive and share this comfortably and come away thinking "that was peaceful and encouraging," while a Christian finds it spiritually meaningful. Connect the verse to a real, relatable human situation (anxiety, loneliness, work pressure, waiting, disappointment, gratitude, starting again, etc.) - answer "why does this matter to me this morning?" - without diagnosing the reader's problems for them.

FIELD-SPECIFIC GUIDANCE:

moment (spoken-audio devotional):
- morningThought: 3-5 short sentences connecting the verse to everyday life and a real emotion, opening (not concluding) toward God, ending in hope or encouragement.
- prayer: 3-5 short sentences, spoken directly to God, sincere and conversational, matching the verse/thought, ending with ${languageName}'s own natural word for "Amen".
- closingBlessing: one short warm sentence.

poster (a social-media-ready devotional graphic - WhatsApp status / Instagram / Facebook / mobile wallpaper): peaceful, elegant, modern, premium, minimal - the verse message must be visually dominant, avoid clutter.
- title: short poster headline.
- morningMessage: one sentence.
- closingLine: short.
- visualConcept: choose imagery from the verse's own meaning, not a default (sunrise, mountains, ocean, quiet road, forest, window light, open sky, water, birds - whichever this specific verse actually evokes; do not default to "open Bible" every time).
- colorPalette: named colors/mood, not hex codes.
- typography: style direction (e.g. elegant serif headline, soft modern sans body).
- backgroundDescription: one or two sentences a photographer/illustrator could act on.

video (30-60s short-form: YouTube Shorts / Reels): gentle emotional progression hook -> scripture -> reflection -> hope -> prayer -> blessing. The hook (first 3-5 seconds) should create emotional curiosity, never fear/clickbait - e.g. "Before you begin your day, remember this," "If your heart feels heavy this morning, listen to this."
- title, hook, voiceoverScript (the full 30-60s spoken script, short sentences), storyboard (scene-by-scene visual direction), onScreenText (only the key phrases that would appear on-screen, not the full script), voiceDirection, musicDirection (a subtle style, e.g. soft piano/ambient pads/acoustic guitar - always quieter than narration, avoid dramatic cinematic music unless the verse genuinely calls for it).

meditation (3-5 minute guided piece, calm/safe/reflective, never sermon-like): gentle welcome -> slow introduction -> the verse -> a short pause -> reflection -> guided everyday application -> invitation to surrender worries to God -> short prayer -> peaceful closing. Write the full script with natural pause cues, short sentences, one idea at a time.
- title, script (the complete meditation script), voiceDirection, backgroundSound.

VOICE DIRECTION (for both video and meditation fields): warm, mature, gentle, natural, reassuring, sincere - like a trusted friend speaking quietly in the early morning. Never a preacher shouting, radio announcer, newsreader, commercial, or dramatic movie narrator. Recommend 0.90-0.95x conversational speed with natural pauses after important sentences.`;
}

function cacheKeyFor(reference: string, english: string, tamil: string, telugu: string): string {
  return sha256([reference, english, tamil, telugu, String(CONTENT_PACKAGE_VERSION)].join('|'));
}

function readCache(key: string): ContentPackage | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, pkg: ContentPackage): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(pkg, null, 2));
  } catch (err) {
    console.warn('[ai/contentPackage] Failed to write content-package cache:', err);
  }
}

// Same failure mode, same shared detector as ai/meditation.ts's assertNoForeignScript (see
// server/utils/scriptValidation.ts) - Claude occasionally leaks a stray character or word from a
// different Indic script into otherwise-correct Tamil/Telugu text, invisible to a shape/type
// validator, jarring to an actual reader. Checked across every text field in the language's
// package, not just the devotional moment.
function findForeignScriptViolations(pkg: any, lang: 'ta' | 'te'): Array<{ path: string; char: string }> {
  const regex = FOREIGN_SCRIPT_RANGES[lang];
  const violations: Array<{ path: string; char: string }> = [];
  const walk = (value: any, keyPath: string): void => {
    if (typeof value === 'string') {
      const match = regex.exec(value);
      if (match) violations.push({ path: keyPath, char: match[0] });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  };
  walk(pkg, '');
  return violations;
}

function assertNoForeignScript(pkg: any, lang: 'ta' | 'te'): void {
  const violations = findForeignScriptViolations(pkg, lang);
  if (violations.length > 0) {
    const { path, char } = violations[0];
    throw new Error(`Content package "${lang}.${path}" contains a foreign-script character ("${char}") - not genuine ${lang === 'ta' ? 'Tamil' : 'Telugu'} text`);
  }
}

function getByPath(obj: any, keyPath: string): any {
  return keyPath.split('.').reduce((o, k) => o?.[k], obj);
}

function setByPath(obj: any, keyPath: string, value: any): void {
  const parts = keyPath.split('.');
  const last = parts.pop()!;
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// Cheaper and more reliable than discarding a whole 21-field response over one stray character:
// most foreign-script leaks are a single field with a single bad character in otherwise-correct
// text, so ask for just that field to be rewritten rather than regenerating everything. Falls back
// to the full-package retry in generateLanguagePackage (via the final assertNoForeignScript check)
// if a repair itself doesn't come back clean.
async function repairForeignScriptField(lang: 'ta' | 'te', fieldPath: string, badText: string, reference: string, verseText: string): Promise<string> {
  const languageName = LANGUAGE_NAMES[lang];
  const systemPrompt = `You are a ${languageName} editor. You will be given one short piece of ${languageName} devotional text that accidentally contains at least one character from a different script (e.g. Devanagari, Kannada, or Malayalam mixed into ${languageName}). Rewrite it so every single character is genuine ${languageName} script, fixing the mistake, while keeping the same meaning, tone, and approximately the same length. Respond with ONLY the corrected text - no tags, no quotation marks, no commentary, no markdown.`;
  const userPrompt = `Bible reference: ${reference}\nVerse: ${verseText}\nField: ${fieldPath}\nOriginal text (contains a script error): ${badText}`;
  const text = await askClaudeForText(systemPrompt, userPrompt, 800, TAMIL_TELUGU_MODEL);
  return text.trim();
}

async function repairForeignScriptViolations(raw: any, lang: 'ta' | 'te', reference: string, verseText: string): Promise<void> {
  const violations = findForeignScriptViolations(raw, lang);
  for (const { path } of violations) {
    try {
      const original = getByPath(raw, path);
      const fixed = await repairForeignScriptField(lang, path, original, reference, verseText);
      if (fixed) setByPath(raw, path, fixed);
    } catch {
      // Leave the field as-is - the caller's final assertNoForeignScript check (and, beyond that,
      // the whole-package retry loop) is the safety net if this particular repair didn't help.
    }
  }
}

// Maps each response tag to where it lands in the nested {moment,poster,video,meditation} shape
// the rest of this module (and validateLanguagePackage/assertNoForeignScript) already expects.
const TAG_FIELDS: Array<{ tag: string; section: 'moment' | 'poster' | 'video' | 'meditation'; field: string }> = [
  { tag: 'MORNING_THOUGHT', section: 'moment', field: 'morningThought' },
  { tag: 'PRAYER', section: 'moment', field: 'prayer' },
  { tag: 'CLOSING_BLESSING', section: 'moment', field: 'closingBlessing' },
  { tag: 'POSTER_TITLE', section: 'poster', field: 'title' },
  { tag: 'POSTER_MESSAGE', section: 'poster', field: 'morningMessage' },
  { tag: 'POSTER_CLOSING_LINE', section: 'poster', field: 'closingLine' },
  { tag: 'POSTER_VISUAL_CONCEPT', section: 'poster', field: 'visualConcept' },
  { tag: 'POSTER_COLOR_PALETTE', section: 'poster', field: 'colorPalette' },
  { tag: 'POSTER_TYPOGRAPHY', section: 'poster', field: 'typography' },
  { tag: 'POSTER_BACKGROUND', section: 'poster', field: 'backgroundDescription' },
  { tag: 'VIDEO_TITLE', section: 'video', field: 'title' },
  { tag: 'VIDEO_HOOK', section: 'video', field: 'hook' },
  { tag: 'VIDEO_VOICEOVER', section: 'video', field: 'voiceoverScript' },
  { tag: 'VIDEO_STORYBOARD', section: 'video', field: 'storyboard' },
  { tag: 'VIDEO_ON_SCREEN_TEXT', section: 'video', field: 'onScreenText' },
  { tag: 'VIDEO_VOICE_DIRECTION', section: 'video', field: 'voiceDirection' },
  { tag: 'VIDEO_MUSIC_DIRECTION', section: 'video', field: 'musicDirection' },
  { tag: 'MEDITATION_TITLE', section: 'meditation', field: 'title' },
  { tag: 'MEDITATION_SCRIPT', section: 'meditation', field: 'script' },
  { tag: 'MEDITATION_VOICE_DIRECTION', section: 'meditation', field: 'voiceDirection' },
  { tag: 'MEDITATION_BACKGROUND_SOUND', section: 'meditation', field: 'backgroundSound' },
];

// Regex extraction rather than a real parser: deliberately tolerant of anything Claude puts
// outside the tags (stray commentary, a wrapping code fence) since only what's between a known
// tag pair is ever read. A missing tag simply leaves that field undefined, which requireFields
// below turns into a clear "missing X" error instead of a cryptic parse failure.
function parseTaggedResponse(text: string): any {
  const result: any = { moment: {}, poster: {}, video: {}, meditation: {} };
  for (const { tag, section, field } of TAG_FIELDS) {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(text);
    if (match) result[section][field] = match[1].trim();
  }
  return result;
}

function requireFields(obj: any, fields: string[], label: string): void {
  for (const f of fields) {
    if (typeof obj?.[f] !== 'string' || !obj[f].trim()) {
      throw new Error(`Content package response missing/invalid "${label}.${f}"`);
    }
  }
}

function validateLanguagePackage(raw: any, lang: 'en' | 'ta' | 'te'): { moment: VerseContent; poster: PosterContent; video: VideoContent; meditation: MeditationContent } {
  requireFields(raw?.moment, ['morningThought', 'prayer', 'closingBlessing'], `${lang}.moment`);
  requireFields(raw?.poster, ['title', 'morningMessage', 'closingLine', 'visualConcept', 'colorPalette', 'typography', 'backgroundDescription'], `${lang}.poster`);
  requireFields(raw?.video, ['title', 'hook', 'voiceoverScript', 'storyboard', 'onScreenText', 'voiceDirection', 'musicDirection'], `${lang}.video`);
  requireFields(raw?.meditation, ['title', 'script', 'voiceDirection', 'backgroundSound'], `${lang}.meditation`);
  if (lang !== 'en') assertNoForeignScript(raw, lang);
  return raw;
}

// One Claude call for this single language's creative content (see systemPromptFor - split
// per-language for output-size and resilience reasons). A field-level foreign-script leak is
// repaired in place first (repairForeignScriptViolations); the up-to-5-attempt whole-package retry
// below is the remaining safety net for whatever a targeted repair doesn't fix (or a truncated/
// missing field), not the primary defense - a fresh attempt is a better user experience than
// surfacing an error over one bad field in an otherwise-good response.
async function generateLanguagePackage(lang: 'en' | 'ta' | 'te', reference: string, verseText: string): Promise<{ moment: VerseContent; poster: PosterContent; video: VideoContent; meditation: MeditationContent }> {
  const userPrompt = `Reference: ${reference}\nVerse: ${verseText}`;
  // Tamil/Telugu script tokenizes less efficiently than English, so the same 21-field content
  // package needs a bigger output budget to avoid the final tag(s) getting cut off mid-generation.
  // Extra headroom beyond that on top: TAMIL_TELUGU_MODEL has been observed spending its entire
  // budget on an invisible internal "thinking" block before writing any visible text at all
  // (stop_reason "max_tokens" with zero output) - intermittent, not specific to this prompt.
  const maxTokens = lang === 'en' ? 4000 : 10000;
  const model = lang === 'en' ? undefined : TAMIL_TELUGU_MODEL;
  let lastErr: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const text = await askClaudeForText(systemPromptFor(lang), userPrompt, maxTokens, model);
      const raw = parseTaggedResponse(text);
      if (lang !== 'en') await repairForeignScriptViolations(raw, lang, reference, verseText);
      return validateLanguagePackage(raw, lang);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Bible reference/text resolution is entirely local-DB-backed (see bibleDb.ts) - Claude never
// produces Scripture text, only the surrounding creative content, matching this app's one hard
// rule that Scripture is never LLM-generated. Throws (no static fallback) on failure: generic
// placeholder devotional prose would defeat the point of this feature, and an unresolved reference
// means there's no verified verse to build the package around at all.
export async function generateContentPackage(reference: string): Promise<ContentPackage> {
  const byLang: Record<BibleLang, { text: string; reference: string }> = {} as any;
  for (const lang of ['en', 'ta', 'te'] as BibleLang[]) {
    const result = getVerseFromDb(reference, lang);
    if (!result) throw new Error(`"${reference}" wasn't found in the local Bible database for language "${lang}".`);
    byLang[lang] = result;
  }

  const key = cacheKeyFor(byLang.en.reference, byLang.en.text, byLang.ta.text, byLang.te.text);
  const cached = readCache(key);
  if (cached) return cached;

  // Sequential, not parallel - keeps this consistent with the rest of the app's Claude usage (one
  // call in flight at a time) and makes a failure's origin unambiguous in logs.
  const en = await generateLanguagePackage('en', byLang.en.reference, byLang.en.text);
  const ta = await generateLanguagePackage('ta', byLang.ta.reference, byLang.ta.text);
  const te = await generateLanguagePackage('te', byLang.te.reference, byLang.te.text);

  const pkg: ContentPackage = {
    reference: byLang.en.reference,
    en: { reference: byLang.en.reference, verse: byLang.en.text, ...en },
    ta: { reference: byLang.ta.reference, verse: byLang.ta.text, ...ta },
    te: { reference: byLang.te.reference, verse: byLang.te.text, ...te },
  };
  writeCache(key, pkg);
  return pkg;
}
