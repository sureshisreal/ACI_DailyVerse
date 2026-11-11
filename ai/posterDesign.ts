// Claude-designed poster layouts. Claude looks at the actual background (cropped exactly as the
// 4:5 poster shows it) together with the verse and its mood, and proposes several distinct layout +
// typography variants for the user to pick from. The renderer (components/posterRenderer.ts's
// renderCornerPoster) still validates every proposed placement against the real pixels and moves a
// block - or falls back to its own automatic layout - when a proposal would put text on the
// subject, so a bad proposal can't produce an unreadable poster.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { askClaudeVisionForJson } from './claude';
import { sha256 } from '../server/utils/hash';
import type {
  PosterAnchor, PosterBlockDesign, PosterDesign, PosterEnglishFont, PosterTamilFont, PosterTeluguFont
} from '../types';

// Bump whenever the prompt or validation below changes materially.
export const POSTER_DESIGN_VERSION = 4; // 4: Impact style, AI-chosen key words

const VARIANT_COUNT = 3;
const CACHE_DIR = path.join(process.cwd(), 'cache', 'poster-design');

// Must match the poster canvas in components/posterRenderer.ts (EDITORIAL_W x EDITORIAL_H).
const POSTER_ASPECT = 1080 / 1350;

const ANCHORS: PosterAnchor[] = ['top', 'upper', 'middle', 'lower', 'bottom'];

// The two professional type styles a design chooses between. Fonts always come as a set from one
// style - picking faces individually let designs mix (e.g. a calligraphic Tamil serif with a geometric
// English sans), which looked unconsidered.
const TYPE_STYLES = {
  classic: { tamilFont: 'noto-serif-tamil', teluguFont: 'noto-serif-telugu', englishFont: 'playfair' },
  elegant: { tamilFont: 'tiro-tamil', teluguFont: 'tiro-telugu', englishFont: 'eb-garamond' },
  impact: { tamilFont: 'anek-tamil', teluguFont: 'anek-telugu', englishFont: 'oswald' },
} as const satisfies Record<string, { tamilFont: PosterTamilFont; teluguFont: PosterTeluguFont; englishFont: PosterEnglishFont }>;

const SYSTEM_PROMPT = `You are an art director for a Christian devotional channel, designing bilingual Bible-verse posters (4:5, 1080x1350). Each poster shows the verse in an Indian language (Tamil or Telugu - one design is used for both) and in English, over the background photo you are shown, which is already cropped exactly as the poster frame.

Propose ${VARIANT_COUNT} genuinely DIFFERENT designs for this background - different arrangement, placement, alignment or typography, not the same layout with a font swapped. Every design must keep all text on calm, empty areas of the photo (open sky, soft blur, plain wall, still water) and NEVER over the subject - especially never over a face, head or hands. Study where the empty space actually is in this specific image before placing anything.

Layout vocabulary:
- arrangement "stacked": the Indian-language block, a divider, then the English block as one group, placed via "primary" (its "english" anchor/align are ignored). Best when one clear area is tall enough for everything.
- arrangement "split": the two language blocks placed independently in two different clear areas (e.g. Indian language in the sky at the top, English in a calm area lower down; or side by side when the subject is centred low). The Indian-language block must read first: place it above the English block, or on the left when side by side.
- anchor (vertical position of a block): top | upper | middle | lower | bottom.
- align: center | left | right. Use left/right only when that side of the frame is the clear one.
- sizeScale: 0.8 - 1.2 relative to default size. Smaller when space is tight, larger for a short verse with lots of open space.

Typography vocabulary (only these exist):
- typeStyle (the complete font set - pick the ONE that best fits this verse and photo):
  classic - Noto Serif Tamil / Noto Serif Telugu emphasis with clean sans body, Playfair Display for English. Formal, majestic, declarative verses (praise, commands, God's power and promises); strong, structured photos.
  elegant - Tiro Tamil / Tiro Telugu calligraphic serif emphasis with refined sans body, EB Garamond for English. Tender, comforting, intimate verses (love, rest, healing, God's care); soft, gentle photos.
  impact - heavy condensed Anek Tamil / Anek Telugu with Oswald capitals for English, key words set very large in a stacked block. Strong, declarative, faith-building verses (victory, rising again, courage, exaltation, promises of action); bold, dramatic photos.
- primaryWeight: regular | bold.
- heroMode: firstWord (opening word(s) enlarged in the accent colour) | none (uniform, quieter).
- divider: flourish (ornamental) | rule (simple line) | none.
- accentColor: pick from this curated palette (or a very close variant) to harmonise with the photo's own colours and the verse mood - champagne #D9B76A, antique gold #C9A24A, amber #E2A256, copper #C98455, rose gold #D69A86, dusty rose #D4A0A6, lavender #B7A3D3, slate blue #93AECB, teal mist #86B8B3, sage #A8B98E. Text is always warm white on a softly darkened photo; the accent is used only for the emphasised words, references and divider.

Also choose "emphasis": for each language, the 1-4 words that carry the verse's core message (e.g. the promise, the action, the name of God) - copied EXACTLY, character for character, from that language's verse text above, as one continuous phrase. Never the whole verse, never just a filler word. They are set large in the accent colour on their own line, so pick words that read powerfully alone.

Use the same typeStyle in every variant - the best match for this verse and photo - and vary only layout, divider and accent between variants. Keep it reverent and legible - a devotional poster, not a fashion ad.

Reply with JSON only:
{"emphasis":{"ta":"exact Tamil phrase","te":"exact Telugu phrase","en":"exact English phrase"},"designs":[{"name":"2-3 word label","arrangement":"stacked|split","primary":{"anchor":"...","align":"...","sizeScale":1.0},"english":{"anchor":"...","align":"...","sizeScale":1.0},"typeStyle":"classic|elegant|impact","primaryWeight":"bold","heroMode":"firstWord","divider":"flourish","accentColor":"#RRGGBB","rationale":"one sentence: where the clear space is and why this design fits"}]}`;

export interface PosterDesignRequest {
  backgroundImageBase64: string;
  reference: string;
  english: string;
  tamil: string;
  telugu: string;
  theme?: string;
  emotion?: string;
  accentColor?: string;
}

function cacheKeyFor(req: PosterDesignRequest): string {
  return sha256([sha256(req.backgroundImageBase64), req.reference, req.english, req.tamil, req.telugu, req.theme || '', String(POSTER_DESIGN_VERSION)].join('|'));
}

function readCache(key: string): PosterDesign[] | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, designs: PosterDesign[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(designs, null, 2));
  } catch (err) {
    console.warn('[poster-design] Failed to write cache:', err);
  }
}

// Center-crops the background to the poster's 4:5 frame (the renderer cover-fits the same way) so
// Claude judges exactly the area the text will sit on, then shrinks it to keep the request light.
async function posterFrameJpeg(backgroundImageBase64: string): Promise<string> {
  const img = sharp(Buffer.from(backgroundImageBase64, 'base64'));
  const meta = await img.metadata();
  const w = meta.width || 1, h = meta.height || 1;
  let cropW = w, cropH = Math.round(w / POSTER_ASPECT);
  if (cropH > h) { cropH = h; cropW = Math.round(h * POSTER_ASPECT); }
  const buf = await img
    .extract({ left: Math.round((w - cropW) / 2), top: Math.round((h - cropH) / 2), width: cropW, height: cropH })
    .resize({ width: 640 })
    .jpeg({ quality: 85 })
    .toBuffer();
  return buf.toString('base64');
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clampScale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0.8, Math.min(1.2, n)) : 1;
}

function validateBlock(raw: any): PosterBlockDesign {
  return {
    anchor: pick(raw?.anchor, ANCHORS, 'upper'),
    align: pick(raw?.align, ['center', 'left', 'right'] as const, 'center'),
    sizeScale: clampScale(raw?.sizeScale),
  };
}

function validateDesign(raw: any, fallbackAccent: string): PosterDesign {
  const typeStyle = pick(raw?.typeStyle, ['classic', 'elegant', 'impact'] as const, 'classic');
  const fonts = TYPE_STYLES[typeStyle];
  return {
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 32) : 'Design',
    arrangement: pick(raw?.arrangement, ['stacked', 'split'] as const, 'stacked'),
    primary: validateBlock(raw?.primary),
    english: validateBlock(raw?.english),
    typeStyle,
    tamilFont: fonts.tamilFont,
    teluguFont: fonts.teluguFont,
    englishFont: fonts.englishFont,
    englishItalic: false,
    primaryWeight: pick(raw?.primaryWeight, ['regular', 'bold'] as const, 'bold'),
    heroMode: pick(raw?.heroMode, ['firstWord', 'none'] as const, 'firstWord'),
    heroScript: false,
    divider: pick(raw?.divider, ['flourish', 'rule', 'none'] as const, 'flourish'),
    accentColor: typeof raw?.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accentColor) ? raw.accentColor : fallbackAccent,
    rationale: typeof raw?.rationale === 'string' ? raw.rationale.slice(0, 300) : '',
  };
}

// Key phrases are only kept when they really are a short, exact, continuous phrase of that
// language's verse (the model never writes Scripture - it only points at words already there).
function validateEmphasis(raw: any, req: PosterDesignRequest): PosterDesign['emphasis'] | null {
  const norm = (s: string) => s.replace(/[\u201C\u201D\u2018\u2019"]/g, '').replace(/\s+/g, ' ').trim();
  const check = (phrase: unknown, verse: string): string | undefined => {
    if (typeof phrase !== 'string') return undefined;
    const p = norm(phrase).replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
    const words = p.split(' ').filter(Boolean);
    const v = norm(verse);
    if (!p || words.length > 5 || p.length >= v.length * 0.8) return undefined;
    return v.includes(p) ? p : undefined;
  };
  const out = { ta: check(raw?.ta, req.tamil), te: check(raw?.te, req.telugu), en: check(raw?.en, req.english) };
  return out.ta || out.te || out.en ? out : null;
}

// Returns up to VARIANT_COUNT validated designs, or [] when Claude is unavailable - callers then
// just use the renderer's automatic layout.
export async function designPosters(req: PosterDesignRequest): Promise<PosterDesign[]> {
  const key = cacheKeyFor(req);
  const cached = readCache(key);
  if (cached) return cached;

  const userText = [
    `Reference: ${req.reference}`,
    `English: ${req.english}`,
    `Tamil: ${req.tamil}`,
    `Telugu: ${req.telugu}`,
    req.theme ? `Theme: ${req.theme}` : '',
    req.emotion ? `Mood: ${req.emotion}` : '',
    `Design ${VARIANT_COUNT} distinct poster variants for this background.`,
  ].filter(Boolean).join('\n');

  try {
    const frame = await posterFrameJpeg(req.backgroundImageBase64);
    const raw = await askClaudeVisionForJson(SYSTEM_PROMPT, frame, 'image/jpeg', userText, 2500);
    const list: any[] = Array.isArray(raw?.designs) ? raw.designs : [];
    const emphasis = validateEmphasis(raw?.emphasis, req);
    const designs = list.slice(0, VARIANT_COUNT).map((d) => ({ ...validateDesign(d, req.accentColor || '#C9A063'), ...(emphasis ? { emphasis } : {}) }));
    if (designs.length) writeCache(key, designs);
    return designs;
  } catch (err) {
    console.warn('[poster-design] Claude design unavailable, using automatic layout only:', err instanceof Error ? err.message : err);
    return [];
  }
}
