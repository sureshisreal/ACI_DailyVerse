import fs from 'fs';
import path from 'path';
import { askClaudeForJson } from './claude';
import { sha256 } from '../server/utils/hash';
import { assertNoForeignScript } from '../server/utils/scriptValidation';

// Bump whenever the prompt or validation rules below change materially, so cache keys (which
// include this) invalidate old entries after a code change rather than only after a data change.
// v11: Per-language model split — English uses cheaper Haiku (never leaked foreign script or
// under-delivered length historically), Tamil/Telugu keep Sonnet-5 (proven necessary for
// script-purity + length targets, per the documented failures at v10). Same function shape,
// faster + cheaper.
export const MEDITATION_VERSION = 11;

// Per-language model overrides, mirroring ai/contentPackage.ts's TAMIL_TELUGU_MODEL. Both currently
// resolve to the cheapest model, Claude Haiku 4.5. Known trade-off: Haiku has previously leaked
// foreign-script characters and under-delivered length in Tamil/Telugu - the retry attempts below
// absorb that; pin a stronger model here (e.g. 'claude-sonnet-5-5') if it becomes frequent.
const ENGLISH_MEDITATION_MODEL: string | undefined = undefined; // falls back to the ai/claude.ts default (claude-haiku-4-5)
const TAMIL_TELUGU_MEDITATION_MODEL = 'claude-haiku-4-5';
const ADJUST_ENGLISH_MODEL: string | undefined = undefined;
const ADJUST_TAMIL_TELUGU_MODEL = 'claude-haiku-4-5';
const LANGUAGE_MODEL_FOR: Record<'en' | 'ta' | 'te', string | undefined> = {
  en: ENGLISH_MEDITATION_MODEL,
  ta: TAMIL_TELUGU_MEDITATION_MODEL,
  te: TAMIL_TELUGU_MEDITATION_MODEL,
};
const ADJUST_MODEL_FOR: Record<'en' | 'ta' | 'te', string | undefined> = {
  en: ADJUST_ENGLISH_MODEL,
  ta: ADJUST_TAMIL_TELUGU_MODEL,
  te: ADJUST_TAMIL_TELUGU_MODEL,
};

const LANGUAGE_NAMES: Record<'en' | 'ta' | 'te', string> = { en: 'English', ta: 'Tamil', te: 'Telugu' };

const CACHE_DIR = path.join(process.cwd(), 'cache', 'meditation');

export interface MeditationText {
  explanation: string;
  prayer: string;
}

export interface Meditation {
  en: MeditationText;
  ta: MeditationText;
  te: MeditationText;
}

// Per-language system prompt generator — English first, then Tamil/Telugu each receive the
// already-approved English meditation as a same-meaning anchor (not a translation directive).
// Mirroring ai/contentPackage.ts's per-language architecture instead of the older combined
// 3-language JSON shape, for two independent benefits directly proven in contentPackage testing:
//   1. English can use cheaper/faster Haiku (no foreign-script risk, no length risk) while
//      only Tamil/Telugu pay the Sonnet-5 tax.
//   2. A Tamil-only failure only needs a Tamil-only retry, not discarding already-good EN/TE.
function systemPromptForMeditationLang(lang: 'en' | 'ta' | 'te'): string {
  const languageName = LANGUAGE_NAMES[lang];
  const languageRule = lang === 'en'
    ? 'Write in simple, direct, warm, conversational, Christ-centered English - plain everyday words, short sentences (roughly 8-15 words each), one idea per sentence, no poetic or literary flourishes.'
    : `Compose directly and natively in ${languageName} - think in ${languageName}, don't mentally translate. Short, simple, direct sentences (roughly 8-15 words each), everyday spoken devotional register, not formal/literary/Sanskritized vocabulary - one idea per sentence, no poetic or literary flourishes. Every single word in ${languageName} script only - never let a character from another script slip in, even mid-word.`;

  const sameMeaningAnchor = lang === 'en'
    ? ''
    : `You will also be shown the already-approved English version of the SAME meditation (explanation + prayer) for this same verse. Your ${languageName} output MUST carry the SAME content as that English version: the same specific everyday-life connection/example, the same encouragement, the same closing statement of faith in explanation, the same requests and the same verse connection in prayer. Decide the MEANING once (from the English you are given), then re-express it naturally in ${languageName} - never invent a different scenario, a different application, or a different faith statement just because this is a separate call. At the same time, write in genuinely natural, native ${languageName}, not as a stiff word-for-word translation of English sentences - same meaning, not the same idioms or sentence structure. A fluent native speaker should never suspect the ${languageName} version started life in English.`;

  return `You write one daily Christian devotional meditation (explanation + prayer) for a church's app, in ${languageName}, built around one Bible verse (its reference and exact ${languageName} text, already resolved from a verified translation, for context only - never rewrite, translate, or quote the verse itself differently than given).

Respond with ONLY minified JSON, no prose, no markdown fences, no explanation, in exactly this shape:
{"explanation":"...","prayer":"..."}

LANGUAGE (critical): ${languageRule}
${sameMeaningAnchor}

"explanation" (the meditation body, roughly 60-75 seconds spoken, ~90-115 words): warm, encouraging, easy to understand. Explain the verse's main message, connect it to everyday life, and encourage faith, hope, courage, trust in God, and obedience - directly and confidently, not as a hedged suggestion. Name God/the Lord/Jesus directly and by name throughout wherever the thought calls for it - never substitute a vague stand-in like "something bigger than yourself" or "someone bigger than the moment." Write it as natural, personal language - first-person reflections in the spirit of "Today, God reminds me..." or "I can choose..." are welcome where they genuinely fit (composed as the natural way a speaker of that language would actually say the same thought, never a stiff word-for-word rendering of an English phrase - skip them entirely rather than force one in). End the meditation with one short, memorable statement of faith. Do NOT open with a stock line like "take a moment to pause/slow down and breathe" or "this verse is about..." - that exact template is the single biggest tell of AI-generated devotional content when it repeats across different verses/videos, so every meditation must open differently, grounded directly in this verse's own specific situation.

"prayer" (roughly 30-45 seconds spoken, ~45-70 words): write the prayer itself, in first person, spoken directly to God - not framed as a suggestion or offer ("if it feels right, you might pray..." / "here's one way you could pray this" are both wrong; just pray it). A heartfelt, simple, peaceful prayer suitable for daily morning or evening devotion: thank God for His word, ask for strength and guidance, and connect it directly back to this verse. End with the natural equivalent, in ${languageName}, of "In Jesus' name, Amen" - phrased the way a believer in that language actually prays it, not a literal translation of the English words.

Style: warm, encouraging, peaceful, Biblical and Christ-centered throughout, written with direct confidence for a Christian audience - not hedged for a reader who might not believe. Avoid softening language like "maybe," "perhaps," "you might find," "if it feels right" - say it plainly and directly instead ("God is with you," "trust him," "you don't have to carry this alone"). Speak plainly and directly - simple, natural, conversational language, no unnecessary explanation, and say the plain thing plainly rather than dressing it up. No headers, labels, or bracketed pause markers of any kind in the text itself (this is read aloud verbatim by text-to-speech - anything like "[pause]" or "Prayer:" would be spoken as literal words); let natural sentence and paragraph breaks create room to breathe instead. Never mention this app, "today's verse," image/video generation, or anything about how this content will be displayed - write only the meditation and prayer themselves.`;
}

function cacheKeyFor(reference: string, english: string, tamil: string, telugu: string): string {
  return sha256([reference, english, tamil, telugu, String(MEDITATION_VERSION)].join('|'));
}

function readCache(key: string): Meditation | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, meditation: Meditation): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(meditation, null, 2));
  } catch (err) {
    console.warn('[ai/meditation] Failed to write meditation cache:', err);
  }
}

function isMeditationText(value: any): value is MeditationText {
  return value && typeof value.explanation === 'string' && value.explanation.trim() && typeof value.prayer === 'string' && value.prayer.trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Below the prompt's own ~90-115 word target (see systemPromptForMeditationLang above) - this
// floor exists purely to catch a genuinely broken/truncated response, not to hold every response
// to the target itself. Lowered again alongside the further-shortened target (was 65→90 historically)
// Tamil "explanation" output has consistently clustered lower than English/Telugu across every
// prompt version — a genuine content-density difference verified directly across real attempts.
const MIN_EXPLANATION_WORDS = 55;

function validateMeditationText(parsed: any, lang: 'en' | 'ta' | 'te'): MeditationText {
  if (!isMeditationText(parsed)) {
    throw new Error(`Meditation "${lang}" response missing/invalid explanation+prayer`);
  }
  const words = wordCount(parsed.explanation);
  if (words < MIN_EXPLANATION_WORDS) {
    throw new Error(`Meditation "${lang}.explanation" is too short (${words} words, need at least ${MIN_EXPLANATION_WORDS}) to read as a guided meditation`);
  }
  if (lang === 'ta' || lang === 'te') {
    assertNoForeignScript(parsed.explanation, lang, 'explanation');
    assertNoForeignScript(parsed.prayer, lang, 'prayer');
  }
  return { explanation: parsed.explanation.trim(), prayer: parsed.prayer.trim() };
}

function validateMeditationCombined(parsed: { en?: any; ta?: any; te?: any }): Meditation {
  const en = validateMeditationText(parsed.en, 'en');
  const ta = validateMeditationText(parsed.ta, 'ta');
  const te = validateMeditationText(parsed.te, 'te');
  return { en, ta, te };
}

// One-language generator (the new, split architecture). EN runs first (Haiku), then TA/TE
// each get their own Sonnet call with the EN output anchored as same-meaning reference.
async function generateOneMeditationText(
  lang: 'en' | 'ta' | 'te',
  reference: string,
  verseText: string,
  approvedEn?: MeditationText | null
): Promise<MeditationText> {
  const modelOverride = LANGUAGE_MODEL_FOR[lang];
  const sys = systemPromptForMeditationLang(lang);
  const anchor = approvedEn
    ? `\n\nAlready-approved SAME-MEANING English meditation for this verse (use this as the content anchor for meaning and arc, not wording):\nExplanation: ${approvedEn.explanation}\nPrayer: ${approvedEn.prayer}`
    : '';
  const userPrompt = `Reference: ${reference}\n${LANGUAGE_NAMES[lang]} verse text: ${verseText}${anchor}`;

  // English: Haiku is stable, 2 attempts suffice. TA/TE: Sonnet-5 + 3 attempts matches the
  // original combined-call retry budget.
  const maxAttempts = lang === 'en' ? 2 : 3;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await askClaudeForJson(sys, userPrompt, 1400, modelOverride);
      return validateMeditationText(raw, lang);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// One Claude call per unique verse, cached to disk so a repeat request never calls Claude again.
// Throws on failure (no API key, network error, malformed response) — no static fallback, matching
// the documented philosophy (generic placeholder prose would undercut the feature's purpose).
export async function generateMeditation(
  reference: string,
  english: string,
  tamil: string,
  telugu: string
): Promise<Meditation> {
  const key = cacheKeyFor(reference, english, tamil, telugu);
  const cached = readCache(key);
  if (cached) return cached;

  // EN first: cheaper Haiku, serves as the meaning anchor. Then TA and TE independently parallel
  // against Sonnet-5 with the EN output as same-content anchor.
  const enText = await generateOneMeditationText('en', reference, english, null);
  const [taText, teText] = await Promise.all([
    generateOneMeditationText('ta', reference, tamil, enText),
    generateOneMeditationText('te', reference, telugu, enText),
  ]);

  const meditation = validateMeditationCombined({ en: enText, ta: taText, te: teText });
  writeCache(key, meditation);
  return meditation;
}

// The Meditation Video's reflection portion (this explanation+prayer, separate from the verse
// reading that precedes it - see runMeditationGeneration in DailyVerseGenerator.tsx) has a real
// runtime target, which measures the actual synthesized audio and calls this to rewrite just one
// language's text toward a target word count when it lands outside that target. A fixed word-count
// target in the main prompt above can't guarantee that on its own: TTS pace varies by
// language/engine, so the only way to actually hit a runtime target is to measure the real audio
// and adjust from there - this is that adjustment step. Kept as its own single-language call
// (not folded into generateMeditation) so an adjustment only pays for regenerating the one
// language that actually missed, and stays fast/cheap.
function adjustSystemPromptFor(lang: 'en' | 'ta' | 'te'): string {
  const languageName = LANGUAGE_NAMES[lang];
  const languageRule = lang === 'en'
    ? 'Write in simple, direct, warm, conversational, Christ-centered English - plain everyday words, short sentences, one idea per sentence, no poetic or literary flourishes.'
    : `Compose directly and natively in ${languageName} - think in ${languageName}, don't mentally translate. Short, simple, direct sentences (roughly 8-15 words each), everyday spoken devotional register, not formal/literary/Sanskritized vocabulary - one idea per sentence, no poetic or literary flourishes. Every single word in ${languageName} script only - never let a character from another script slip in, even mid-word.`;

  return `You are revising one existing Christian devotional "explanation" (a meditation) and "prayer" (built around one Bible verse, shown for context only - never rewrite, translate, or quote the verse itself differently than given) to fit closer to a target spoken length. Respond with ONLY minified JSON, no prose, no markdown fences, in exactly this shape:
{"explanation":"...","prayer":"..."}

${languageRule}

Keep the same arc as the original (meditation: open directly inside the verse's specific situation -> explain its main message and connect it to everyday life -> encourage faith, hope, courage, trust in God, and obedience -> end with one short memorable statement of faith; prayer: written as the prayer itself, spoken directly to God in first person, not framed as a suggestion - thank God for His word, ask for strength and guidance, connect it back to the verse, end with the natural equivalent of "In Jesus' name, Amen" in that language), the same warm, encouraging, Biblical, Christ-centered tone, and the same core meaning and theme as the original text - you are adjusting its LENGTH, not writing a different meditation. Name God/the Lord/Jesus directly by name throughout - never a vague stand-in like "something bigger than yourself." Avoid softening language like "maybe," "perhaps," "you might find," "if it feels right" - say it plainly and directly instead, even when lengthening. If the original's opening line is a generic "take a moment to pause/breathe" or "this verse is about..." template, or the prayer is framed as an offer ("you might pray this"), replace it instead of preserving it - neither should appear, lengthening or shortening. Never mention this app, "today's verse," or anything about how this content will be displayed.

If asked to lengthen: add genuine new material within the existing arc (a bit more everyday connection, a fuller encouragement) - never pad with filler, repetition, or restating the same sentence in different words.
If asked to shorten: trim to the essential line of thought in each part of the arc - never just chop the ending off mid-thought.`;
}

// Not cached (unlike generateMeditation) - this is a one-off correction keyed to a specific prior
// attempt's actual measured duration, not a stable, repeatable-per-verse result worth persisting.
export async function adjustMeditationLength(
  reference: string,
  verseText: string,
  lang: 'en' | 'ta' | 'te',
  priorExplanation: string,
  priorPrayer: string,
  targetTotalWords: number
): Promise<MeditationText> {
  const direction = targetTotalWords > wordCount(priorExplanation) + wordCount(priorPrayer) ? 'Lengthen' : 'Shorten';
  // Split reflects the shortened ~110-150 word explanation / ~60-90 word prayer balance above
  // (roughly 130:75, i.e. ~63/37) rather than the old, longer explanation-heavy balance.
  const userPrompt = `Reference: ${reference}\nVerse: ${verseText}\n\nOriginal explanation: ${priorExplanation}\n\nOriginal prayer: ${priorPrayer}\n\n${direction} the combined explanation+prayer to approximately ${targetTotalWords} total words (roughly ${Math.round(targetTotalWords * 0.63)} words for explanation, ${Math.round(targetTotalWords * 0.37)} for prayer).`;

  const modelOverride = ADJUST_MODEL_FOR[lang];
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askClaudeForJson(adjustSystemPromptFor(lang), userPrompt, 2400, modelOverride);
      return validateMeditationText(raw, lang);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
