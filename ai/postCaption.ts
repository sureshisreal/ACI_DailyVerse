// Captions for posting the bilingual posters on the channel's YouTube Posts (community) tab. The
// YouTube Data API has no endpoint for community posts, so the app shows each poster with this
// ready-to-paste caption and a link to YouTube Studio's Posts page - posting itself stays manual.
import fs from 'fs';
import path from 'path';
import { askClaudeForJson } from './claude';
import { sha256 } from '../server/utils/hash';

// Bump whenever the prompt or validation below changes materially.
export const POST_CAPTION_VERSION = 2;

const CACHE_DIR = path.join(process.cwd(), 'cache', 'post-caption');

export interface PostCaptions {
  tamil: string;
  telugu: string;
}

export interface PostCaptionRequest {
  reference: string;
  english: string;
  tamil: string;
  telugu: string;
  tamilReference: string;
  teluguReference: string;
  viewerSituation?: string;
  emotionalHook?: string;
}

// The model writes only the short framing pieces; the caption itself is assembled in code with the
// verse text and references taken straight from the Bible DB (see assembleCaption), so Scripture can
// never be altered whichever model answers. Asking a model to copy the verse inside one long
// free-form caption proved unreliable on the local Ollama fallback (Gemma returned only hashtags).
const SYSTEM_PROMPT = `You write short framing lines for a Christian devotional channel's posts. Each post shows a Bible verse in Tamil+English or Telugu+English; the verse itself is added separately, so do NOT include the verse text. Respond with ONLY minified JSON in exactly this shape:
{"tamilOpening":"...","tamilInvite":"...","tamilHashtags":["#...","#..."],"teluguOpening":"...","teluguInvite":"...","teluguHashtags":["#...","#..."]}

- tamilOpening / teluguOpening: one warm sentence (under 20 words) naming the everyday situation the verse speaks to, written natively in Tamil script / Telugu script respectively.
- tamilInvite / teluguInvite: one short, gentle sentence (under 15 words) inviting people to share it with someone who needs it or to reply "Amen" - never pressure.
- tamilHashtags / teluguHashtags: 3-5 hashtags each, mixing that language and English, no spaces inside a hashtag.
- Never let a character from another Indian script slip into the Tamil or Telugu lines.
- Peaceful, comforting, God-centred tone a non-Christian friend could receive comfortably. Never manipulative or fear-based: no "sent specifically to you", no "share or else", no "you won't believe".`;

const BANNED_PATTERNS = [/sent this (message |verse )?specifically to you/i, /god will (punish|curse)/i, /you won'?t believe/i, /share (this|it) or/i];

// Unicode blocks for the scripts involved - a line for one language must use its own script and no
// other Indic script (the leakage failure mode seen before, e.g. a Devanagari letter in Tamil text).
const SCRIPT_RANGES = { tamil: /[஀-௿]/, telugu: /[ఀ-౿]/ };
const OTHER_INDIC = { tamil: /[ऀ-୿ఀ-෿]/, telugu: /[ऀ-௿ಀ-෿]/ };

function validLine(value: unknown, lang: 'tamil' | 'telugu', maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!line || line.length > maxChars) return null;
  if (!SCRIPT_RANGES[lang].test(line) || OTHER_INDIC[lang].test(line)) return null;
  if (BANNED_PATTERNS.some((p) => p.test(line))) return null;
  return line;
}

function validHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#?/, '#'))
    .filter((t) => /^#[\p{L}\p{M}\p{N}_]{2,40}$/u.test(t))
    .slice(0, 5);
}

const DEFAULT_HASHTAGS = ['#BibleVerse', '#DailyVerse', '#ACI'];

// Opening line, the verse + reference in the Indian language, the English verse + reference, the
// invitation, hashtags - any missing framing piece is simply left out.
function assembleCaption(
  opening: string | null, invite: string | null, hashtags: string[],
  primaryText: string, primaryRef: string, req: PostCaptionRequest
): string {
  return [
    opening,
    `${primaryText}\n- ${primaryRef}`,
    `${req.english}\n- ${req.reference}`,
    invite,
    (hashtags.length ? hashtags : DEFAULT_HASHTAGS).join(' '),
  ].filter(Boolean).join('\n\n');
}

function cacheKeyFor(req: PostCaptionRequest): string {
  return sha256([req.reference, req.english, req.tamil, req.telugu, req.viewerSituation || '', String(POST_CAPTION_VERSION)].join('|'));
}

function readCache(key: string): PostCaptions | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, captions: PostCaptions): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(captions, null, 2));
  } catch (err) {
    console.warn('[post-caption] Failed to write cache:', err);
  }
}

export async function generatePostCaptions(req: PostCaptionRequest): Promise<PostCaptions> {
  const key = cacheKeyFor(req);
  const cached = readCache(key);
  if (cached) return cached;

  const userPrompt = [
    `Reference: ${req.reference}`,
    `English: ${req.english}`,
    `Tamil (${req.tamilReference}): ${req.tamil}`,
    `Telugu (${req.teluguReference}): ${req.telugu}`,
    req.viewerSituation ? `Situation it speaks to: ${req.viewerSituation}` : '',
    req.emotionalHook ? `Hook: ${req.emotionalHook}` : '',
  ].filter(Boolean).join('\n');

  let raw: any = null;
  try {
    raw = await askClaudeForJson(SYSTEM_PROMPT, userPrompt, 800);
  } catch (err) {
    console.warn('[post-caption] Model unavailable, using plain captions:', err instanceof Error ? err.message : err);
  }
  const pieces = {
    tamilOpening: validLine(raw?.tamilOpening, 'tamil', 200),
    tamilInvite: validLine(raw?.tamilInvite, 'tamil', 150),
    teluguOpening: validLine(raw?.teluguOpening, 'telugu', 200),
    teluguInvite: validLine(raw?.teluguInvite, 'telugu', 150),
  };
  const captions: PostCaptions = {
    tamil: assembleCaption(pieces.tamilOpening, pieces.tamilInvite, validHashtags(raw?.tamilHashtags), req.tamil, req.tamilReference, req),
    telugu: assembleCaption(pieces.teluguOpening, pieces.teluguInvite, validHashtags(raw?.teluguHashtags), req.telugu, req.teluguReference, req),
  };
  // Only a fully-framed result is worth caching - a partial one gets another chance next time.
  if (Object.values(pieces).every(Boolean)) writeCache(key, captions);
  return captions;
}
