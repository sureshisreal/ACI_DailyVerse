// Bilingual devotional poster renderer: draws ONE generated background image plus the exact
// Bible-DB verse text (target language + English) onto a static 1080x1920 canvas. Adapted from the
// single-language, animation-oriented drawToCanvas() previously in BulkGenerator.tsx - same font
// preload strategy, background contrast treatment, and word-wrap/auto-shrink approach, simplified
// to a static one-shot render for exactly two stacked language blocks (no video/karaoke/particles).
//
// Typographic hierarchy (theme, boxed hero phrase, dual reference citation, minimal footer) is
// modeled on a set of reference devotional posters the project owner shared - not just a single
// uniform text block.

import type { FontStyleKey, PosterDesign, PosterEnglishFont, PosterTamilFont, PosterTeluguFont, PosterAnchor } from '../types';

function stripCurlyQuotes(s: string): string {
  return s.replace(/[“”‘’]/g, '');
}

export const PORTRAIT_W = 1080;
export const PORTRAIT_H = 1920;

// 4:5 - the editorial (left-text/right-subject) poster's own canvas size, deliberately separate
// from PORTRAIT_W/H rather than replacing them: Narration/Meditation Video frames still render at
// PORTRAIT_W/H (9:16, required for YouTube Shorts) via renderVersePoster, unaffected by this.
export const EDITORIAL_W = 1080;
export const EDITORIAL_H = 1350;

const MINISTRY_NAME = 'The Apostolic Church of India';

const PALETTE = {
  WHITE: '#FFFFFF',
  GOLD: '#FFD700',
};

// One entry per FontStyleKey (see types.ts) - the fixed set of typeface pairings Claude picks
// between per-verse (see ai/analyzer.ts). Kept as a closed set, not a freeform font name from the
// model, so every family/weight/style combo here is guaranteed to be an actually-loaded Google Font
// (see index.html) rather than risking a silent system-font fallback.
interface FontStylePreset {
  // The professional pairing used for Tamil/Telugu with this preset (see TAMIL_FACES / TELUGU_FACES).
  tamilFace: PosterTamilFont;
  teluguFace: PosterTeluguFont;
  englishFontFamily: string;
  englishItalic: boolean;
  englishWeight: number;
  primaryFontFamily: { ta: string; te: string };
}

const FONT_STYLE_PRESETS: Record<FontStyleKey, FontStylePreset> = {
  'classic-serif': {
    tamilFace: 'noto-serif-tamil',
    teluguFace: 'noto-serif-telugu',
    englishFontFamily: '"Playfair Display"',
    englishItalic: true,
    englishWeight: 600,
    primaryFontFamily: { ta: '"Noto Serif Tamil", serif', te: '"Noto Serif Telugu", serif' },
  },
  'delicate-serif': {
    tamilFace: 'tiro-tamil',
    teluguFace: 'tiro-telugu',
    englishFontFamily: '"EB Garamond"',
    englishItalic: true,
    englishWeight: 400,
    primaryFontFamily: { ta: '"Noto Serif Tamil", serif', te: '"Noto Serif Telugu", serif' },
  },
  // Only two professional styles are used: Classic (Noto Serif + Playfair) and Elegant (Tiro + EB
  // Garamond). The other two theme keys fold into them - formal themes to Classic, warm ones to Elegant.
  'engraved-display': {
    tamilFace: 'noto-serif-tamil',
    teluguFace: 'noto-serif-telugu',
    englishFontFamily: '"Playfair Display"',
    englishItalic: false,
    englishWeight: 700,
    primaryFontFamily: { ta: '"Noto Serif Tamil", serif', te: '"Noto Serif Telugu", serif' },
  },
  'decorative-warm': {
    tamilFace: 'tiro-tamil',
    teluguFace: 'tiro-telugu',
    englishFontFamily: '"EB Garamond"',
    englishItalic: true,
    englishWeight: 400,
    primaryFontFamily: { ta: '"Arima Madurai", serif', te: '"Noto Serif Telugu", serif' },
  },
};

const DEFAULT_FONT_STYLE: FontStyleKey = 'classic-serif';

// Every exact family/weight/style combination this renderer ever requests via ctx.font, across
// every FONT_STYLE_PRESETS entry above. document.fonts.ready only resolves loads already in flight -
// a family+weight+style pair that has never been rendered anywhere else on the page is never
// queued, so the very first canvas paint would silently fall back to a synthetic/system face
// without this explicit preload.
const FONT_PRELOAD_SPECS = [
  'italic 600 32px "Playfair Display"',
  'italic 400 32px "Cormorant Garamond"',
  'italic 600 32px "Cormorant Garamond"',
  'italic 700 32px "Cormorant Garamond"',
  'italic 700 32px "Playfair Display"',
  '700 32px Cinzel',
  'italic 400 32px Lora',
  'italic 600 32px Lora',
  'italic 700 32px Lora',
  '700 32px Montserrat',
  '900 32px Montserrat',
  '700 32px "Noto Serif Tamil"',
  '900 32px "Noto Serif Tamil"',
  '700 32px "Noto Serif Telugu"',
  '900 32px "Noto Serif Telugu"',
  '700 32px "Arima Madurai"',
  '900 32px "Arima Madurai"',
  '400 32px "Great Vibes"',
  '700 32px "Dancing Script"',
  '400 32px Lato',
  '800 32px Lato',
  // PosterDesign font choices (see DESIGN_*_FONTS).
  '600 32px "Playfair Display"',
  '700 32px "Playfair Display"',
  '700 32px "Cormorant Garamond"',
  '700 32px Lora',
  '700 32px Cinzel',
  '900 32px Cinzel',
  '500 32px Montserrat',
  '800 32px Montserrat',
  '900 32px Lato',
  '400 32px "Noto Serif Tamil"',
  '400 32px "Noto Sans Tamil"',
  '700 32px "Noto Sans Tamil"',
  '900 32px "Noto Sans Tamil"',
  '400 32px "Arima Madurai"',
  '400 32px "Noto Serif Telugu"',
  '400 32px "Noto Sans Telugu"',
  '700 32px "Noto Sans Telugu"',
  '900 32px "Noto Sans Telugu"',
  // Professional pairings (see TAMIL_FACES / TELUGU_FACES / DESIGN_ENGLISH_FONTS).
  '400 32px "Tiro Tamil"',
  '500 32px "Mukta Malar"', '700 32px "Mukta Malar"',
  '500 32px "Hind Madurai"', '700 32px "Hind Madurai"',
  '500 32px Catamaran', '800 32px Catamaran',
  '400 32px "Tiro Telugu"',
  '500 32px "Hind Guntur"', '700 32px "Hind Guntur"',
  '500 32px "Anek Telugu"', '700 32px "Anek Telugu"',
  '400 32px Ramabhadra',
  '500 32px "EB Garamond"', '700 32px "EB Garamond"',
  '400 32px "Libre Baskerville"', '700 32px "Libre Baskerville"',
  '400 32px "DM Serif Display"',
  '500 32px "Crimson Pro"', '700 32px "Crimson Pro"',
  '500 32px "Noto Sans Tamil"', '500 32px "Noto Sans Telugu"', '700 32px Montserrat',
  // Impact style (condensed via the width axis).
  '800 condensed 32px "Anek Tamil"', '500 semi-condensed 32px "Anek Tamil"',
  '800 condensed 32px "Anek Telugu"', '500 semi-condensed 32px "Anek Telugu"',
  '400 32px Oswald', '700 32px Oswald',
];

// --- Professional type system ---
// One disciplined pairing per language, used by the posters, video frames and meditation card:
// emphasis in a refined serif at bold (never black) weight, body in a clean sans for Tamil/Telugu or a
// regular-weight serif for English, references as small tracked capitals - and always warm-white text
// on a graded photo. Script faces and heavy black weights read as amateur, so neither is used.
const PRO_PRIMARY: Record<'ta' | 'te', { hero: string; body: string }> = {
  ta: { hero: '"Noto Serif Tamil", serif', body: '"Noto Sans Tamil", sans-serif' },
  te: { hero: '"Noto Serif Telugu", serif', body: '"Noto Sans Telugu", sans-serif' },
};
const PRO_TEXT = '#FBF7F0';
// Regular-weight serif body / bold emphasis per English family (only weights index.html loads).
function proEnglishWeights(family: string): { body: number; hero: number } {
  if (family.includes('Playfair')) return { body: 500, hero: 700 };
  if (family.includes('EB Garamond')) return { body: 500, hero: 700 };
  if (family.includes('Baskerville')) return { body: 400, hero: 700 };
  if (family.includes('DM Serif')) return { body: 400, hero: 400 }; // single-weight display serif
  if (family.includes('Crimson')) return { body: 500, hero: 700 };
  if (family.includes('Oswald')) return { body: 400, hero: 700 };
  if (family.includes('Cormorant')) return { body: 700, hero: 700 }; // 400 is too thin at poster sizes
  if (family.includes('Cinzel')) return { body: 400, hero: 700 };
  if (family.includes('Montserrat')) return { body: 500, hero: 700 };
  return { body: 400, hero: 700 }; // Lora, Lato
}
// Hero/body families for a poster's primary language: the AI design's face when there is one,
// otherwise the verse theme's pairing (FONT_STYLE_PRESETS). Each face brings its own paired body font.
function proPrimaryFonts(lang: 'ta' | 'te' | 'en', englishFamily: string, design?: PosterDesign | null, fontStyle: FontStyleKey = DEFAULT_FONT_STYLE) {
  if (lang === 'en') {
    const w = proEnglishWeights(englishFamily);
    return { hero: englishFamily, heroWeight: w.hero, body: englishFamily, bodyWeight: w.body };
  }
  const preset = FONT_STYLE_PRESETS[fontStyle] || FONT_STYLE_PRESETS[DEFAULT_FONT_STYLE];
  const face = lang === 'ta' ? TAMIL_FACES[design?.tamilFont ?? preset.tamilFace] : TELUGU_FACES[design?.teluguFont ?? preset.teluguFace];
  // A width keyword rides along with the weight ("800 condensed") - valid in the canvas font shorthand.
  return {
    hero: face.family, heroWeight: `${face.hero}${face.heroStretch ? ` ${face.heroStretch}` : ''}`,
    body: face.body.family, bodyWeight: `${face.body.weight}${face.body.stretch ? ` ${face.body.stretch}` : ''}`,
  };
}
// Reference ("MARK 10:16") font: tracked capitals for English; the clean sans for Tamil/Telugu.
function proReferenceFont(lang: 'ta' | 'te' | 'en', px: number): string {
  return lang === 'en' ? `700 ${px}px Montserrat, "Helvetica Neue", Arial, sans-serif` : `700 ${px * 1.12}px ${PRO_PRIMARY[lang].body}`;
}
const proReferenceText = (lang: 'ta' | 'te' | 'en', ref: string) => (lang === 'en' ? ref.toUpperCase() : ref);
// Draws one reference line. English is letter-spaced (drawn per character - safe for Latin only;
// Tamil/Telugu shaping would break, so those are drawn normally).
function drawReferenceLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, lang: 'ta' | 'te' | 'en') {
  if (lang !== 'en') { ctx.fillText(text, x, y); return; }
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 20);
  const spacing = px * 0.2;
  const chars = Array.from(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = prevAlign;
}

let fontsPreloadedPromise: Promise<void> | null = null;
// Latin, Tamil and Telugu characters - see ensurePosterFontsPreloaded.
const FONT_PRELOAD_SAMPLE = 'Aa1 கர்த்தர் தேவன் దేవుడు ప్రభువు';
export function ensurePosterFontsPreloaded(): Promise<void> {
  if (!fontsPreloadedPromise) {
    // The sample text matters: Google Fonts splits each family into per-script files (unicode-range),
    // and document.fonts.load only fetches the files covering its sample text - Latin by default. Without
    // Tamil/Telugu samples those glyph files only arrived after the first Tamil/Telugu draw, so the
    // first render in a session measured and laid out text with a fallback font (different line
    // breaks and sizes from every later render of the same poster).
    fontsPreloadedPromise = Promise.all(
      FONT_PRELOAD_SPECS.map(spec => document.fonts.load(spec, FONT_PRELOAD_SAMPLE).catch(() => {}))
    ).then(() => undefined);
  }
  return fontsPreloadedPromise;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// Wraps raw base64 image bytes as a data URL, sniffing the actual format from its magic bytes
// rather than assuming PNG - the background image now comes from Pollinations.ai (see
// server/services/image-generation.service.ts), which returns JPEG. A data URL's declared MIME
// type is taken at face value (unlike a real HTTP response, browsers don't sniff the bytes to
// correct it), so a wrong label here would fail to decode instead of just looking odd.
export function base64ToImageDataUrl(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  let mime = 'image/jpeg';
  try {
    const header = atob(base64.slice(0, 16));
    if (header.charCodeAt(0) === 0x89 && header.charCodeAt(1) === 0x50 && header.charCodeAt(2) === 0x4e && header.charCodeAt(3) === 0x47) {
      mime = 'image/png';
    }
  } catch {
    // Malformed base64 - fall through with the JPEG default; loadImage() will surface the failure.
  }
  return `data:${mime};base64,${base64}`;
}

const DETAIL_GRID_COLS = 32;
const DETAIL_GRID_ROWS = 96;

interface DetailGrid {
  cells: Float32Array; // rows x cols, per-cell busyness
  lum: Float32Array; // rows x cols, per-cell raw luminance (0-255)
  rowScores: Float32Array; // per-row sum, for vertical band search
  cols: number;
  rows: number;
}

// Per-cell "busyness" score for the background: how much visual detail/edge content sits in each
// grid cell. Low score = flat, low-contrast (sky, grass, blurred backdrop) = safe for text. High
// score = the subject itself (edges, contrast, texture). This replaces a crude top/bottom
// brightness guess with an actual read of where the generated image is genuinely empty, so text
// placement doesn't just assume the AI honored "composition" - it verifies against the real pixels.
// Raw luminance is kept too, so the caller can pick dark-on-light vs. light-on-dark text once it
// knows which band the text actually landed in, instead of always darkening the photo to white-on-black.
// canvasW/canvasH: the poster canvas the image is cover-fitted onto. Every renderer crops the
// background to fill its canvas, so the grid must measure only that visible crop - measuring the
// whole image (as before) put each grid row at the wrong height whenever the canvas aspect differs
// from the image's. On the 4:5 poster from a 9:16 background, ~285px are cropped off the top and
// bottom, so text placement and per-block legibility checks were reading rows that are offscreen
// or shifted (Lamentations 3:24: the English block landed over the subject's head).
function computeDetailGrid(img: HTMLImageElement, canvasW: number, canvasH: number): DetailGrid {
  const cols = DETAIL_GRID_COLS, rows = DETAIL_GRID_ROWS;
  const cells = new Float32Array(rows * cols);
  const lum = new Float32Array(rows * cols);
  const rowScores = new Float32Array(rows);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { cells, lum, rowScores, cols, rows };
    const ratio = Math.max(canvasW / img.width, canvasH / img.height);
    const srcW = canvasW / ratio, srcH = canvasH / ratio;
    ctx.drawImage(img, (img.width - srcW) / 2, (img.height - srcH) / 2, srcW, srcH, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const lumOf = (idx: number) => 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) lum[y * cols + x] = lumOf((y * cols + x) * 4);
    }

    // Per-cell local contrast: how different each pixel is from its immediate neighbors
    // (horizontal + vertical gradient) - high where an edge/subject boundary passes through.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const here = lum[y * cols + x];
        let grad = 0, n = 0;
        if (x > 0) { grad += Math.abs(here - lum[y * cols + (x - 1)]); n++; }
        if (x < cols - 1) { grad += Math.abs(here - lum[y * cols + (x + 1)]); n++; }
        if (y > 0) { grad += Math.abs(here - lum[(y - 1) * cols + x]); n++; }
        if (y < rows - 1) { grad += Math.abs(here - lum[(y + 1) * cols + x]); n++; }
        cells[y * cols + x] = n > 0 ? grad / n : 0;
      }
    }

    // Per-cell deviation from THIS ROW's own average luminance, added onto the edge-gradient score
    // above. A large flat-colored subject - a backlit silhouette, a dark robe, a solid shadowed
    // shape - has almost no INTERNAL gradient (its neighbors all match itself), so the edge score
    // above only flags its outline, never its interior; a tall silhouette then reads as "mostly
    // empty" over most of its own body and text lands squarely on it. Verified directly against a
    // real generated background (Psalm 30:5: a full-height hooded silhouette against open sky/sea)
    // where the poster's verse text rendered straight across the figure's head and torso. Comparing
    // each cell to its OWN row's mean catches this: a dark figure sitting in a row that's otherwise
    // open sky scores a large deviation here even though its interior gradient is ~0, while a
    // genuinely flat/uniform row (real empty sky) stays near-zero on both signals.
    for (let y = 0; y < rows; y++) {
      let rowSum = 0;
      for (let x = 0; x < cols; x++) rowSum += lum[y * cols + x];
      const rowAvg = rowSum / cols;
      for (let x = 0; x < cols; x++) {
        cells[y * cols + x] += Math.abs(lum[y * cols + x] - rowAvg) * 0.7;
      }
    }

    for (let y = 0; y < rows; y++) {
      let sum = 0;
      for (let x = 0; x < cols; x++) sum += cells[y * cols + x];
      rowScores[y] = sum;
    }
  } catch {
    // leave scores at 0/mid-gray (uniform) - placement falls back to the vertical center of the
    // scan range, and theme picking falls back to the dark (white-text) default.
    lum.fill(90);
  }
  return { cells, lum, rowScores, cols, rows };
}

// Average raw luminance across the rows the text block actually landed in - the signal used to
// decide dark-on-light vs. light-on-dark text for that specific poster, rather than assuming.
function averageLuminanceInBand(grid: DetailGrid, startRow: number, rowCount: number): number {
  const { lum, cols, rows } = grid;
  const endRow = Math.min(rows, startRow + rowCount);
  let sum = 0, n = 0;
  for (let y = startRow; y < endRow; y++) {
    for (let x = 0; x < cols; x++) { sum += lum[y * cols + x]; n++; }
  }
  return n > 0 ? sum / n : 90;
}

// Per-row busyness summed only over the column span text will actually be centered across (roughly
// [CENTER_X - MAX_W/2, CENTER_X + MAX_W/2]), not the full image width. A tall, narrow, centered
// subject - a standing figure, a cross, a lone tree - occupies only a small fraction of a row's
// total width, so a full-width row sum (the old behavior) can read as "empty enough" on average
// while the subject sits squarely in the middle of every row, right where centered text lands. This
// measures exactly the strip that matters instead.
function computeCenterStripRowScores(grid: DetailGrid, colStart: number, colEndExclusive: number): Float32Array {
  const { cells, cols, rows } = grid;
  const scores = new Float32Array(rows);
  const cStart = Math.max(0, Math.min(cols, colStart));
  const cEnd = Math.max(cStart, Math.min(cols, colEndExclusive));
  const halfSpan = Math.max(1e-6, (cEnd - cStart) / 2);
  const mid = (cStart + cEnd) / 2;
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    for (let x = cStart; x < cEnd; x++) {
      // Every render function using this strip draws text CENTER-ALIGNED within it, so every
      // line's glyphs pass close to the strip's horizontal midpoint while only the widest line
      // reaches its outer edges. Weighting all columns equally lets a busy subject sitting near
      // the middle - exactly where it's most likely to collide with the text - get diluted away
      // by calm columns nearer the edges, which is how a subject's head ended up rendering
      // directly behind hero text despite a large real luminance gap (see Psalm 23:1 fix).
      const distFromCenter = Math.min(1, Math.abs((x + 0.5) - mid) / halfSpan);
      const weight = 1.6 - distFromCenter;
      sum += cells[y * cols + x] * weight;
    }
    scores[y] = sum;
  }
  return scores;
}

// Slides a window of `neededRows` rows through [minRow, maxRowExclusive) and returns the start
// row with the lowest total busyness - the flattest contiguous band tall enough for the text block.
// TOP_BIAS_MAX: a purely-minimum-busyness search will happily place text hundreds of pixels
// down the poster if some lower band scores even marginally flatter than the top - which reads as a
// large, unexplained empty gap above the text (reported directly against a real generated poster:
// the top quarter of the frame was a smooth gradient sky, clearly the visually "emptiest" area to a
// human eye, yet the search picked a lower band that scored a hair flatter numerically). This
// multiplicative penalty makes a lower band need to be MEANINGFULLY flatter (not just marginally) to
// win over a higher one - ties (including the common case of two regions both scoring exactly 0,
// e.g. two patches of flat sky) still resolve to the earlier/higher position via the strict `<`
// comparison below, so this only changes outcomes for genuinely close-but-not-equal candidates, not
// perfectly flat ones.
//
// The penalty is normalized by how many candidate start rows actually exist (maxStart - minRow),
// NOT by a flat per-row rate - a flat per-row rate compounds in direct proportion to how many rows a
// candidate sits below minRow, which sounds harmless until `window` (the text block's own height) is
// large relative to the search span: fewer candidate positions exist, so each one-row step away from
// the top is a much bigger fraction of the *usable* search range, yet the flat rate charged the same
// absolute penalty per row regardless. In one confirmed case (a tall two-language block searched
// against a subject's head sitting right at the top of the range) this let a band starting at
// minRow win with a busyness sum 65% higher than a clean band just 19 rows lower, because the flat
// per-row rate had already roughly doubled that lower band's score before the comparison - the text
// rendered directly over the subject's face despite the clean band being clearly, measurably
// available. Normalizing bounds the total penalty to TOP_BIAS_MAX regardless of window height, so it
// can act as a tie-breaker without ever overriding a genuinely large busyness gap.
const TOP_BIAS_MAX = 0.35; // Max penalty (as a fraction of raw score) for the lowest-starting candidate in range

function findEmptiestBand(rowScores: Float32Array, neededRows: number, minRow: number, maxRowExclusive: number): number {
  const span = Math.max(1, maxRowExclusive - minRow);
  const window = Math.min(neededRows, span);
  const maxStart = Math.max(minRow, maxRowExclusive - window);
  const startSpan = Math.max(1, maxStart - minRow);
  let bestStart = minRow;
  let bestScore = Infinity;
  let sum = 0;
  for (let r = minRow; r < minRow + window; r++) sum += rowScores[r] ?? 0;
  bestScore = sum;
  for (let start = minRow + 1; start + window <= maxRowExclusive; start++) {
    sum += (rowScores[start + window - 1] ?? 0) - (rowScores[start - 1] ?? 0);
    const score = sum * (1 + TOP_BIAS_MAX * ((start - minRow) / startSpan));
    if (score < bestScore) { bestScore = score; bestStart = start; }
  }
  return bestStart;
}

// Within the chosen vertical band, compares average busyness of the left third vs. right third
// of the frame. Returns a horizontal shift fraction in [-0.16, 0.16] of the safe half-width -
// negative shifts the text block left (right side is busier), positive shifts it right (left side
// is busier). Near zero when the band is roughly balanced left-to-right, which is the common case
// for the top/bottom compositions this app mostly generates.
function horizontalBiasWithinBand(grid: DetailGrid, startRow: number, rowCount: number): number {
  const { cells, cols, rows } = grid;
  const endRow = Math.min(rows, startRow + rowCount);
  const third = Math.max(1, Math.floor(cols / 3));
  let leftSum = 0, rightSum = 0;
  for (let y = startRow; y < endRow; y++) {
    for (let x = 0; x < third; x++) leftSum += cells[y * cols + x];
    for (let x = cols - third; x < cols; x++) rightSum += cells[y * cols + x];
  }
  const total = leftSum + rightSum;
  if (total < 1e-6) return 0;
  // Positive shift = move text right, which is only safe when the LEFT side is the busy one.
  const skew = (leftSum - rightSum) / total;
  return Math.max(-0.16, Math.min(0.16, skew * 0.16));
}

// Average luminance and busyness of the background directly behind one text block (canvas-pixel
// rect, mapped onto the detail grid the same way the band search does). The poster theme is picked
// once from the whole text band's average, so on a tall two-language block the top half can sit on
// open sky while the bottom half lands on the subject - confirmed on Lamentations 3:24, where the
// Tamil block sat on flat sky (lum 207, busyness 1.2) and the English block directly below it on a
// busy hay baler (lum 153, busyness 31): the band average still read "light", so the English was
// painted dark-on-busy and became unreadable.
// peakBusy: the busiest single row's average across the rect. The plain mean dilutes a few busy
// rows into many calm ones, but one busy row is enough to make the line of text on it unreadable -
// so placement decisions use the peak, while the haze check (blockNeedsPlate) uses the mean.
function regionStats(grid: DetailGrid, canvasW: number, canvasH: number, x0: number, y0: number, x1: number, y1: number): { lum: number; busy: number; peakBusy: number } {
  const { cells, lum, cols, rows } = grid;
  const c0 = Math.max(0, Math.floor((x0 / canvasW) * cols));
  const c1 = Math.min(cols, Math.ceil((x1 / canvasW) * cols));
  const r0 = Math.max(0, Math.floor((y0 / canvasH) * rows));
  const r1 = Math.min(rows, Math.ceil((y1 / canvasH) * rows));
  let lumSum = 0, busySum = 0, n = 0, peakBusy = 0;
  for (let y = r0; y < r1; y++) {
    let rowBusy = 0;
    for (let x = c0; x < c1; x++) { lumSum += lum[y * cols + x]; busySum += cells[y * cols + x]; rowBusy += cells[y * cols + x]; n++; }
    if (c1 > c0) peakBusy = Math.max(peakBusy, rowBusy / (c1 - c0));
  }
  return n > 0 ? { lum: lumSum / n, busy: busySum / n, peakBusy } : { lum: 90, busy: 0, peakBusy: 0 };
}

// Flat sky measures ~1-5 busyness; a subject passing behind the text measures 20+.
const PLATE_BUSY_THRESHOLD = 10;
// Same scale, applied to a block's busiest row (regionStats.peakBusy) when choosing where blocks go.
const PEAK_BUSY_THRESHOLD = 12;

// Whether a block needs a backdrop to stay legible in the given theme: dark text needs a bright,
// calm patch behind it; light text needs a patch that isn't bright (busy-but-dark is already
// handled by the light-on-dark scrim).
function blockNeedsPlate(theme: PosterTheme, stats: { lum: number; busy: number }): boolean {
  return theme.isLight ? (stats.lum < 170 || stats.busy > PLATE_BUSY_THRESHOLD) : stats.lum > 150;
}

// Soft backdrop behind one text block, in the theme's own direction (cream haze behind dark text,
// dark haze behind light text). An elliptical radial gradient that fades fully to transparent, so it
// reads as a haze with no edges - the earlier blurred rounded rectangle still showed as a visible
// cream box with a hard top edge and whitewashed the subject behind it.
function paintLegibilityPlate(ctx: CanvasRenderingContext2D, theme: PosterTheme, x0: number, y0: number, x1: number, y1: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 110, ry = (y1 - y0) / 2 + 70;
  const rgb = theme.isLight ? '250,246,238' : '0,0,0';
  const peak = theme.isLight ? 0.62 : 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx / ry, 1);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  grad.addColorStop(0, `rgba(${rgb},${peak})`);
  grad.addColorStop(0.55, `rgba(${rgb},${peak * 0.8})`);
  grad.addColorStop(0.8, `rgba(${rgb},${peak * 0.35})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
  ctx.restore();
}

function maxLineWidth(ctx: CanvasRenderingContext2D, layout: ClauseBlockLayout): number {
  let w = 0;
  ctx.save();
  for (const line of layout.lines) {
    ctx.font = line.font;
    w = Math.max(w, ctx.measureText(line.text).width);
  }
  ctx.restore();
  return w;
}

// Word wrap that never splits a single word across lines (matters for Tamil/Telugu
// consonant+vowel-sign clusters). Returns wrapped lines for the given font/max width.
function wrapText(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number): string[] {
  ctx.font = font;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const wordWidth = ctx.measureText(word).width;
    if (wordWidth >= maxWidth) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(word);
      continue;
    }
    const testLine = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(testLine).width < maxWidth) {
      cur = testLine;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function primaryFontFamilyFor(lang: 'ta' | 'te' | 'en', style: FontStyleKey): string {
  const preset = FONT_STYLE_PRESETS[style] || FONT_STYLE_PRESETS[DEFAULT_FONT_STYLE];
  return lang === 'en' ? preset.englishFontFamily : preset.primaryFontFamily[lang];
}

// The single most emphatic clause gets pulled out in a distinct color/weight (never a box - see
// paintClauseBlock), echoing how the reference posters render one short phrase in a contrasting
// gold italic against otherwise-uniform body text. Chosen deterministically from the verse's own
// punctuation - never from Claude, which never touches Scripture text - so it's the same every
// time for a given verse.
//
// Word-count fallback below exists because this app's own Telugu Bible DB frequently has no
// internal punctuation at all where the English/Tamil text has a clear comma/semicolon break -
// verified directly against the DB: 57% of a 2000-verse sample had zero comma/semicolon/colon
// anywhere in the text (e.g. Psalm 46:10's Telugu text has none, vs. English's "Be still, and know
// that I am God: I will be exalted..."). Since there's genuinely nothing to split on, every verse in
// that shape would otherwise never get a hero clause at all - not a rendering bug, a real gap in the
// source text this app can't alter (Scripture text is never rewritten, see the caller in
// buildClauseBlock). Devotional verses very commonly put their emphasis in the closing phrase (see
// this file's other hero clauses, which are almost always the verse's last comma-delimited part) -
// splitting off the last ~third of the words approximates the same effect when there's no
// punctuation to find it by.
function splitIntoClauses(text: string): string[] {
  const punctuationSplit = text.split(/[,;:।]+/).map(s => s.trim()).filter(Boolean);
  if (punctuationSplit.length >= 2) return punctuationSplit;

  const words = text.trim().split(/\s+/).filter(Boolean);
  // Below this, splitting off even 2 words leaves too little on the other side to read as a real
  // "body" clause - a short verse/phrase this size should just stay one uniform block.
  const MIN_WORDS_TO_SPLIT = 6;
  if (words.length < MIN_WORDS_TO_SPLIT) return punctuationSplit;

  const heroWordCount = Math.max(2, Math.min(6, Math.round(words.length * 0.32)));
  const splitAt = words.length - heroWordCount;
  return [words.slice(0, splitAt).join(' '), words.slice(splitAt).join(' ')];
}

function pickHeroIndex(clauses: string[]): number {
  if (clauses.length < 2) return -1;
  let bestIdx = 0, bestCount = Infinity;
  clauses.forEach((c, i) => {
    const wc = c.split(/\s+/).filter(Boolean).length;
    if (wc > 0 && wc < bestCount) { bestCount = wc; bestIdx = i; }
  });
  return bestIdx;
}

// Editorial layout's hero rule (see renderEditorialPoster): the verse's OPENING WORD is the hero,
// not its shortest punctuation-delimited clause - matches the reference sample, where only "Peace"/
// "சமாதானத்தை" is enlarged and the rest of the sentence (including the remainder of that same
// clause) stays at body size. Splits off just the first word; everything from word 2 onward,
// original punctuation intact, becomes the single "body" clause.
// A leading English function word ("The", "For", "And") is never the hero on its own - enlarging
// just "The" and dropping "LORD is my portion..." to body size (Lamentations 3:24) reads as a broken
// split. Such words are carried into the hero along with the next word ("The LORD"), up to 3 words.
// Latin-only, so Tamil/Telugu openings are unaffected.
const HERO_LEADING_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'for', 'or', 'so', 'now', 'then', 'i', 'o', 'oh', 'ye', 'thou',
  'he', 'she', 'it', 'we', 'they', 'my', 'thy', 'his', 'her', 'our', 'your', 'their', 'in', 'of',
  'to', 'unto', 'with', 'by', 'as', 'at', 'if', 'when', 'let', 'is', 'be',
]);

// Letters in a word, ignoring punctuation (Tamil/Telugu vowel signs count - they roughly track syllables).
const heroLetters = (w: string) => Array.from(w.replace(/[\p{P}\p{S}]/gu, '')).length;
// An emphasised opening shorter than this looks like a stray glyph rather than a phrase (Mark 10:16 in
// Telugu enlarged just "ఆ" - "the"), so the next word is pulled in until it reaches this.
const HERO_MIN_LETTERS = 5;

function splitFirstWordHero(text: string): string[] {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return [trimmed];
  let heroCount = 1;
  const heroLen = () => words.slice(0, heroCount).reduce((n, w) => n + heroLetters(w), 0);
  while (
    heroCount < 3 && heroCount < words.length - 1 && (
      HERO_LEADING_FUNCTION_WORDS.has(words[heroCount - 1].toLowerCase().replace(/[^a-z]/g, ''))
      || heroLen() < HERO_MIN_LETTERS
    )
  ) heroCount++;
  // English: if even the extended opening carries no substantial word ("And he took"), emphasising it
  // looks accidental - set the verse as one uniform block instead.
  const isLatin = /^[\x00-\x7F\u2018-\u201D]*$/.test(trimmed);
  if (isLatin) {
    const content = words.slice(0, heroCount).filter((w) => !HERO_LEADING_FUNCTION_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
    if (!content.some((w) => heroLetters(w) >= HERO_MIN_LETTERS)) return [trimmed];
  }
  return [words.slice(0, heroCount).join(' '), words.slice(heroCount).join(' ')];
}

interface PaintLine {
  text: string;
  font: string;
  isHero: boolean;
  lineHeight: number;
  offset: number; // absolute top-of-line offset from block start, in px
}

interface ClauseBlockStyle {
  baseFont: string;
  heroFont: string;
  baseLH: number;
  heroLH: number;
  clauseGap: number;
  maxWidth: number;
  quoted: boolean;
  enableHero: boolean;
  // 'shortest' (default when unset): today's behavior, hero = the shortest punctuation-delimited
  // clause (see pickHeroIndex). 'firstWord': the editorial layout's rule, hero = just the verse's
  // opening word (see splitFirstWordHero).
  heroMode?: 'shortest' | 'firstWord';
  // The AI-chosen words that carry the verse's message (design.emphasis). When found in the text they
  // become the hero on their own line, wherever they sit in the verse; heroMode is the fallback.
  keyPhrase?: string;
  // Impact style: the key phrase is enlarged until it fills the line width (up to fillMax x the hero
  // size), for a stacked typographic block.
  fillKey?: boolean;
  fillMax?: number;
  // Set the whole block in capitals (condensed English display face).
  uppercase?: boolean;
}

interface ClauseBlockLayout {
  lines: PaintLine[];
  totalHeight: number;
  overflowsWidth: boolean;
}

// Lays out one verse's text as a sequence of clauses, each independently word-wrapped, with the
// single hero clause (see pickHeroIndex) rendered larger. Color is deliberately NOT decided here -
// it depends on the theme (light/dark background) picked only after placement is known - so this
// just marks each line `isHero` and the painter resolves color from that at draw time.
// Splits text around its key phrase: [before?, key, after?] with the key's index, or null when the
// phrase isn't in this text (e.g. the poster shows a shortened portion without it).
function splitAroundKeyPhrase(text: string, phrase: string | undefined): { clauses: string[]; heroIdx: number } | null {
  if (!phrase) return null;
  const norm = (s: string) => s.replace(/\s+/g, ' ');
  const t = norm(text), p = norm(phrase).trim();
  let i = t.indexOf(p);
  if (i < 0) i = t.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0 || !p) return null;
  let end = i + p.length;
  while (end < t.length && /[\p{P}]/u.test(t[end])) end++; // keep trailing punctuation with the key
  const before = t.slice(0, i).trim(), key = t.slice(i, end).trim(), after = t.slice(end).trim();
  if (!before && !after) return null; // the whole text - nothing to contrast with
  const clauses = [before, key, after].filter(Boolean);
  return { clauses, heroIdx: clauses.indexOf(key) };
}

const withFontSize = (font: string, px: number) => font.replace(/(\d+(?:\.\d+)?)px/, `${px}px`);

function buildClauseBlock(ctx: CanvasRenderingContext2D, text: string, style: ClauseBlockStyle): ClauseBlockLayout {
  const cased = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  const cleanedText = cased(stripCurlyQuotes(text || ''));
  const useFirstWordHero = style.heroMode === 'firstWord';
  const keyed = style.enableHero ? splitAroundKeyPhrase(cleanedText, style.keyPhrase ? cased(style.keyPhrase) : undefined) : null;
  const clauses = keyed ? keyed.clauses : useFirstWordHero ? splitFirstWordHero(cleanedText) : splitIntoClauses(cleanedText);
  const heroIdx = keyed ? keyed.heroIdx : !style.enableHero ? -1 : useFirstWordHero ? (clauses.length >= 2 ? 0 : -1) : pickHeroIndex(clauses);
  const lines: PaintLine[] = [];
  let offset = 0;
  let overflowsWidth = false;

  clauses.forEach((clauseRaw, idx) => {
    const isHero = idx === heroIdx;
    let clause = clauseRaw;
    if (style.quoted) {
      if (idx === 0) clause = `“${clause}`;
      if (idx === clauses.length - 1) clause = `${clause}”`;
    }
    let font = isHero ? style.heroFont : style.baseFont;
    let lh = isHero ? style.heroLH : style.baseLH;
    if (isHero && keyed && style.fillKey) {
      // Impact: grow the key phrase until it fills the width (it stays on one line), capped.
      const basePx = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 60);
      ctx.font = font;
      const w = ctx.measureText(clause).width;
      if (w > 0 && w < style.maxWidth) {
        const px = Math.min(basePx * (style.fillMax ?? 1.6), basePx * ((style.maxWidth * 0.98) / w));
        lh *= px / basePx;
        font = withFontSize(font, px);
      }
    }
    let wrapped = wrapText(ctx, clause, font, style.maxWidth);
    // No lone word on a clause's last line ("them," by itself): re-wrap narrower until the last line
    // has company, keeping the same number of lines.
    for (let narrow = 0.92; narrow >= 0.7 && wrapped.length >= 2 && !/\s/.test(wrapped[wrapped.length - 1].trim()); narrow -= 0.06) {
      const retry = wrapText(ctx, clause, font, style.maxWidth * narrow);
      if (retry.length === wrapped.length) { wrapped = retry; break; }
    }

    ctx.font = font;
    wrapped.forEach((l) => {
      const w = ctx.measureText(l).width;
      if (w > style.maxWidth) overflowsWidth = true;
    });

    wrapped.forEach((l) => {
      lines.push({ text: l, font, isHero, lineHeight: lh, offset });
      offset += lh;
    });
    if (idx < clauses.length - 1) offset += style.clauseGap;
  });

  return { lines, totalHeight: offset, overflowsWidth };
}

// Parses a "#rrggbb" hex color into HSL. Falls back to gold's hue/saturation for anything
// malformed - accentColor is already hex-validated server-side (see ai/schema.ts) before it ever
// reaches here, so this is just defense against a missing/stale value.
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  const clean = match ? match[1] : 'FFD700';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}


// --- Accent colour matched to the photo ---
// Brand-safe accents a verse's colour is matched to - warm metallics first (the ministry's gold look),
// then soft naturals - so the accent always belongs to the image without ever going garish.
// --- Designer-picked colour pairs ---
// Every poster's colour comes from one of these five two-tone pairs - never from computed hue shifts,
// which produced off combinations (pinkish coral on skin tones, muddy lavender). Each pair has a
// version for dark (light text) and light (dark text) backgrounds, plus an outline colour.
interface Duotone { name: string; base: string; dark: [string, string]; light: [string, string]; stroke: string }
const DUOTONES: Duotone[] = [
  { name: 'gold', base: '#D4A845', dark: ['#FFE6A3', '#E2A23B'], light: ['#9A6A12', '#6E4808'], stroke: '#2A1A06' },
  { name: 'amber', base: '#E39A3B', dark: ['#FFD9A0', '#F0862F'], light: ['#B5560F', '#7C3606'], stroke: '#2B1405' },
  { name: 'champagne', base: '#D9C08A', dark: ['#FFF4D8', '#D8B56C'], light: ['#8C6A2C', '#5E4519'], stroke: '#2A1E0C' },
  { name: 'sky', base: '#7FB2E5', dark: ['#E3F1FF', '#7DB4EC'], light: ['#2C6AA6', '#1B4775'], stroke: '#0B1A2B' },
  { name: 'teal', base: '#5FB3A8', dark: ['#D8F6F0', '#5DBAAD'], light: ['#1E7A6E', '#13554C'], stroke: '#08211D' },
];
// Nearest pair by hue; a low-saturation colour (white/grey/beige) maps to champagne.
function duotoneFor(hex: string): Duotone {
  const { h, s } = hexToHsl(hex);
  if (s < 0.25) return DUOTONES.find((d) => d.name === 'champagne')!;
  const dist = (a: number, b: number) => { const x = Math.abs(a - b); return Math.min(x, 1 - x); };
  return DUOTONES.filter((d) => d.name !== 'champagne')
    .reduce((best, d) => (dist(hexToHsl(d.base).h, h) < dist(hexToHsl(best.base).h, h) ? d : best));
}
// Photo matching picks among the pair bases.
const BRAND_ACCENTS = DUOTONES.map((d) => d.base);

// Picks the accent from the background's own palette: the strongest colour in the photo (by area,
// saturation and mid-tone brightness, with warm light weighted up so a golden glow beats a big blue
// sky), snapped to the nearest brand-safe accent. A mostly white/grey/black photo has no real colour
// to match, so the verse's theme accent (fallbackHex) is kept. Lightness is tuned later per text
// band by its colour pair (duotoneFor / pickTheme).
export function accentFromImage(img: HTMLImageElement | null, fallbackHex: string): string {
  if (!img) return fallbackHex;
  try {
    const N = 48;
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(img, 0, 0, N, N);
    const data = c.getImageData(0, 0, N, N).data;
    const BINS = 36;
    const hist = new Array<number>(BINS).fill(0);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2, d = max - min;
      if (d < 0.04) continue;
      const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (sat < 0.22 || l < 0.12 || l > 0.92) continue;
      let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
      const warm = h < 0.17 || h > 0.95 ? 1.35 : 1; // reds, oranges, golds
      const weight = sat * (1 - Math.abs(l - 0.5) * 1.2) * warm;
      hist[Math.floor(h * BINS) % BINS] += weight;
      total += weight;
    }
    // Too little real colour in the photo (pale, grey, monochrome) - keep the theme's accent.
    if (total < N * N * 0.05) return fallbackHex;
    let peak = 0, peakVal = -1;
    for (let k = 0; k < BINS; k++) {
      const v = hist[(k + BINS - 1) % BINS] + hist[k] * 2 + hist[(k + 1) % BINS];
      if (v > peakVal) { peakVal = v; peak = k; }
    }
    const peakHue = (peak + 0.5) / BINS;
    const hueDist = (a: number, b: number) => { const x = Math.abs(a - b); return Math.min(x, 1 - x); };
    return BRAND_ACCENTS.reduce((best, hex) => (hueDist(hexToHsl(hex).h, peakHue) < hueDist(hexToHsl(best).h, peakHue) ? hex : best));
  } catch {
    return fallbackHex;
  }
}

// Resolved once per poster from the actual brightness of the band the text landed in (dark-on-light
// for a bright background, light-on-dark for a dark one) and from the verse's Claude-chosen accent
// hue. The hero clause always renders in the accent color; body text switches with the theme.
interface PosterTheme {
  isLight: boolean;
  baseColor: string;
  heroColor: string;
  shadowColor: string;
  shadowBlur: number;
  accentColor: string; // for the reference lines, divider and footer
  // Key words: a two-colour gradient (left -> right across the line) in harmonised shades of the
  // accent, with a thin outline in a deep shade of it for definition.
  heroGradient: [string, string];
  heroStroke?: string;
  // Thin dark outline on body text - only behind a busy part of the photo, where it separates the
  // letters from the texture; calm areas stay clean.
  bodyStroke?: string;
}

// busy: the text band's busyness (regionStats). Light text on a darkened photo by default; dark text
// only on a clean, bright background - a plain sky, parchment, mist - where it reads crisply with no
// darkening (as in professional devotional posters). Busy bright areas (fabric, foliage) keep light
// text with a stronger scrim: dark text on busy brightness read as a draft.
const CLEAN_LIGHT_MIN_LUM = 172;
const CLEAN_LIGHT_MAX_BUSY = 6;
// Busyness above which white body text gets a thin dark outline (same scale as regionStats).
const BODY_OUTLINE_MIN_BUSY = 10;
function pickTheme(bandLuminance: number, accentHex: string, busy?: number): PosterTheme {
  const isLight = busy !== undefined && bandLuminance >= CLEAN_LIGHT_MIN_LUM && busy <= CLEAN_LIGHT_MAX_BUSY;
  const pair = duotoneFor(accentHex);
  if (isLight) {
    return {
      isLight: true, baseColor: '#1f1b17', heroColor: pair.light[1], shadowColor: 'rgba(255,250,240,0.6)', shadowBlur: 10,
      accentColor: pair.light[0], heroGradient: pair.light,
    };
  }
  return {
    isLight: false, baseColor: PRO_TEXT, heroColor: pair.dark[1], shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 18,
    accentColor: pair.dark[1], heroGradient: pair.dark,
    heroStroke: pair.stroke,
    bodyStroke: busy !== undefined && busy > BODY_OUTLINE_MIN_BUSY ? 'rgba(18,12,8,0.75)' : undefined,
  };
}

// Draws a clause block's text lines - the hero clause in the theme's accent color and italic
// weight, the rest in the theme's base color - starting at `startY` and centered at `alignX`.
// Returns the Y position immediately after the block.
// --- Reading highlighter support (see renderVersePosterHighlightSet) ---
// One entry per verse word, in reading order: the word's glow-padded box in canvas pixels, the
// word's own position (for redrawing it glowing), and its layer - which highlighted copy of the
// poster its cut-out comes from (assigned so no two words in a layer have overlapping boxes).
export interface PosterWordBox {
  text: string; x: number; y: number; w: number; h: number; layer: number;
  textX: number; textY: number; font: string; glow: number;
}
interface WordHighlightPass {
  boxes: PosterWordBox[];     // filled in reading order as lines are painted
  glowWords?: Set<number>;    // word indexes to draw glowing in this pass
  glowColor: string;
  textColor: string;
}

// Measures each space-separated word of a line. The box includes room for the glow to fade out
// fully, so the video's cut-out of a glowing word has no visible edge.
function measureLineWords(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, hl: WordHighlightPass) {
  const lineW = ctx.measureText(text).width;
  const startX = align === 'center' ? x - lineW / 2 : align === 'right' || align === 'end' ? x - lineW : x;
  const m = ctx.measureText(text);
  const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 40);
  const ascent = m.actualBoundingBoxAscent || fontPx * 0.62;
  const descent = m.actualBoundingBoxDescent || fontPx * 0.32;
  const glow = Math.max(10, fontPx * 0.32);
  const pad = glow * 1.6;
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const wx = startX + ctx.measureText(text.slice(0, match.index)).width;
    const ww = ctx.measureText(match[0]).width;
    hl.boxes.push({
      text: match[0], layer: 0, textX: wx, textY: y, font: ctx.font, glow,
      x: wx - pad, y: y - ascent - pad, w: ww + pad * 2, h: ascent + descent + pad * 2,
    });
  }
}

// Redraws the selected words glowing: bright text with a soft halo in the accent colour, layered
// twice so the halo is visible on a busy photo.
function paintGlowingWords(ctx: CanvasRenderingContext2D, hl: WordHighlightPass, fromIndex: number) {
  if (!hl.glowWords) return;
  for (let i = fromIndex; i < hl.boxes.length; i++) {
    if (!hl.glowWords.has(i)) continue;
    const b = hl.boxes[i];
    ctx.save();
    ctx.font = b.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hl.textColor;
    ctx.shadowColor = hl.glowColor;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = b.glow;
    ctx.fillText(b.text, b.textX, b.textY);
    ctx.shadowBlur = b.glow * 0.45;
    ctx.fillText(b.text, b.textX, b.textY);
    ctx.restore();
  }
}

function paintClauseBlock(ctx: CanvasRenderingContext2D, layout: ClauseBlockLayout, startY: number, alignX: number, theme: PosterTheme, align: CanvasTextAlign = 'center', hl?: WordHighlightPass): number {
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  for (const line of layout.lines) {
    const y = startY + line.offset + line.lineHeight / 2;
    const firstWord = hl ? hl.boxes.length : 0;
    if (hl) {
      ctx.save();
      ctx.font = line.font;
      measureLineWords(ctx, line.text, alignX, y, align, hl);
      ctx.restore();
    }
    ctx.save();
    ctx.font = line.font;
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(line.font)?.[1] || 40);
    let fill: string | CanvasGradient = line.isHero ? theme.heroColor : theme.baseColor;
    if (line.isHero) {
      // Two-colour gradient across the key line's own width (see PosterTheme.heroGradient).
      const w = ctx.measureText(line.text).width;
      const x0 = align === 'center' ? alignX - w / 2 : align === 'right' || align === 'end' ? alignX - w : alignX;
      const grad = ctx.createLinearGradient(x0, y - px * 0.3, x0 + w, y + px * 0.3);
      grad.addColorStop(0, theme.heroGradient[0]);
      grad.addColorStop(1, theme.heroGradient[1]);
      fill = grad;
    }
    const stroke = line.isHero ? theme.heroStroke : theme.bodyStroke;
    ctx.shadowColor = theme.shadowColor;
    // The hero ("keyword") clause gets a noticeably heavier glow on top of its larger size/weight/
    // accent colour. Not a background box/highlight behind the text - that was deliberately ruled out
    // (see splitIntoClauses above) in favour of glow-only emphasis.
    ctx.shadowBlur = line.isHero ? theme.shadowBlur * 2.2 : theme.shadowBlur;
    ctx.shadowOffsetY = line.isHero ? (theme.isLight ? 1 : 5) : (theme.isLight ? 0 : 3);
    if (stroke) {
      // Outline first (carrying the shadow), then the fill on top without a second shadow.
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(1.5, px * (line.isHero ? 0.075 : 0.06));
      ctx.strokeStyle = stroke;
      ctx.strokeText(line.text, alignX, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = fill;
    ctx.fillText(line.text, alignX, y);
    ctx.restore();
    if (hl) paintGlowingWords(ctx, hl, firstWord);
  }
  return startY + layout.totalHeight;
}

// Draws text with manual per-glyph letter-spacing, centered at (centerX, y), and returns the
// rendered width. Native `ctx.letterSpacing` combined with an active shadow (as the footer below
// uses) triggers a Chromium canvas bug where the shadow renders as one solid rectangle behind the
// whole string instead of per-glyph, instead of the soft per-character glow every other shadowed
// fillText call in this file gets. Drawing character-by-character (with letterSpacing left at its
// default) sidesteps that codepath entirely.
function fillTextLetterSpaced(ctx: CanvasRenderingContext2D, text: string, centerX: number, y: number, spacing: number): number {
  const chars = Array.from(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = centerX - totalWidth / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prevAlign;
  return totalWidth;
}

// Small geometric flourish (thin lines flanking a diamond) used as the divider between the
// primary-language and English blocks. Drawn as paths rather than a Unicode ornament glyph,
// since glyph support for characters like "❧" varies across fonts.
function drawFlourish(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, halfWidth: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, halfWidth * 0.02);
  ctx.globalAlpha = 0.85;
  const gap = halfWidth * 0.22;
  ctx.beginPath();
  ctx.moveTo(centerX - halfWidth, centerY);
  ctx.lineTo(centerX - gap, centerY);
  ctx.moveTo(centerX + gap, centerY);
  ctx.lineTo(centerX + halfWidth, centerY);
  ctx.stroke();
  const d = gap * 0.55;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - d);
  ctx.lineTo(centerX + d, centerY);
  ctx.lineTo(centerX, centerY + d);
  ctx.lineTo(centerX - d, centerY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Instagram-brand gradient camera-round-square icon for the footer. Drawn procedurally (no image
// asset required, always matches the canvas pixel density). Matches the reference images'
// Instagram glyph in the footer bar to the left of "THE APOSTOLIC CHURCH OF INDIA".
function drawInstagramIcon(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, size: number) {
  ctx.save();
  void (size * 0.23);
  const gradient = ctx.createLinearGradient(centerX - size / 2, centerY - size / 2, centerX + size / 2, centerY + size / 2);
  gradient.addColorStop(0.0, '#F58529');
  gradient.addColorStop(0.25, '#FEDA77');
  gradient.addColorStop(0.5, '#DD2A7B');
  gradient.addColorStop(0.75, '#8134AF');
  gradient.addColorStop(1.0, '#515BD4');

  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;

  const left = centerX - size / 2;
  const top = centerY - size / 2;
  ctx.beginPath();
  const inset = size * 0.10;
  const x = left + inset;
  const y = top + inset;
  const w = size - inset * 2;
  const h = size - inset * 2;
  const innerR = Math.min(w, h) * 0.26;
  ctx.moveTo(x + innerR, y);
  ctx.lineTo(x + w - innerR, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + innerR);
  ctx.lineTo(x + w, y + h - innerR);
  ctx.quadraticCurveTo(x + w, y + h, x + w - innerR, y + h);
  ctx.lineTo(x + innerR, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - innerR);
  ctx.lineTo(x, y + innerR);
  ctx.quadraticCurveTo(x, y, x + innerR, y);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(255,255,255,0.98)';
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.beginPath();
  ctx.arc(centerX, centerY, size * 0.20, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, size * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.fill();

  const dotR = Math.max(2, size * 0.06);
  ctx.beginPath();
  ctx.arc(centerX + size * 0.22, centerY - size * 0.22, dotR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.fill();

  ctx.restore();
}

export interface PosterVerseInput {
  primaryText: string;
  primaryRef: string;
  // 'en' renders English itself as the sole/primary block (see englishText below) - used for a
  // single-language narration-video poster rather than the usual bilingual pairing.
  primaryLang: 'ta' | 'te' | 'en';
  // Omit both to render primaryText/primaryRef alone with no secondary language block, divider, or
  // second reference caption - e.g. for narration videos, which each carry only one language.
  englishText?: string;
  englishRef?: string;
  // Claude's per-verse typeface pairing and accent hue (see types.ts's VerseAnalysis) - both
  // optional so a caller without an analysis (or an older cached one) still renders using the
  // original classic-serif/gold look rather than failing.
  fontStyle?: FontStyleKey;
  accentColor?: string;
  // Claude-designed layout/typography (see ai/posterDesign.ts) - currently honoured by
  // renderCornerPoster only. Omitted = the renderer's automatic layout.
  design?: PosterDesign;
}

// Draws the background (cover-fit, contrast/saturation filter, vignette + bottom gradient for
// legibility), then a mixed-hierarchy text block for each language - most of the verse in a
// steady weight, the single shortest clause pulled out large and boxed - each followed by its own
// reference citation, auto-shrinking until everything fits within safe margins. Ends with a
// minimal (no solid bar) footer. Returns a PNG blob ready for preview/download.
export async function renderVersePoster(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput
): Promise<Blob> {
  return (await renderVersePosterInternal(bgImg, logoImg, verse)).blob;
}

// The plain poster, plus a few copies with some verse words drawn glowing, plus every verse word's
// box. The video cuts each word's box out of the copy where it glows and shows it while that word is
// spoken. Words are spread over layers (copies) so that no two words in one copy have overlapping
// boxes - otherwise a cut-out would carry part of a neighbour's glow. Usually 2-3 layers.
export async function renderVersePosterHighlightSet(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput
): Promise<{ poster: Blob; layers: Blob[]; words: PosterWordBox[] }> {
  const overlaps = (p: PosterWordBox, q: PosterWordBox) =>
    p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  const sameLayout = (a: PosterWordBox[], b: PosterWordBox[]) =>
    a.length === b.length && a.every((w, i) => Math.abs(w.x - b[i].x) < 0.5 && Math.abs(w.y - b[i].y) < 0.5 && Math.abs(w.w - b[i].w) < 0.5);
  // All renders must share one layout, or the cut-outs land on the wrong words. Every pass reports
  // its word boxes, so check they agree and render again if not (e.g. a font finished loading).
  let result: { poster: Blob; layers: Blob[]; words: PosterWordBox[] } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const plain = await renderVersePosterInternal(bgImg, logoImg, verse, 'collect');
    const words = plain.words;
    const layerMembers: number[][] = [];
    words.forEach((w, i) => {
      let layer = layerMembers.findIndex((members) => members.every((j) => !overlaps(w, words[j])));
      if (layer < 0) { layer = layerMembers.length; layerMembers.push([]); }
      layerMembers[layer].push(i);
      w.layer = layer;
    });
    const layers: Blob[] = [];
    let consistent = true;
    for (const members of layerMembers) {
      const pass = await renderVersePosterInternal(bgImg, logoImg, verse, new Set(members));
      consistent = consistent && sameLayout(words, pass.words);
      layers.push(pass.blob);
    }
    result = { poster: plain.blob, layers, words };
    if (consistent) break;
  }
  return result!;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return `rgba(255,215,0,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

async function renderVersePosterInternal(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput,
  // undefined: plain poster, no measuring. 'collect': plain poster + word boxes. A set: those words glowing.
  highlight?: 'collect' | Set<number>
): Promise<{ blob: Blob; words: PosterWordBox[] }> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT_W;
  canvas.height = PORTRAIT_H;
  const ctx = canvas.getContext('2d')!;
  const width = PORTRAIT_W, height = PORTRAIT_H;

  // Background
  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.16) saturate(1.3) brightness(0.9)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  // Logo badge, top-left
  if (logoImg) {
    ctx.save();
    const logoSize = 100, margin = 60;
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  // Safe text-content area. TOP_MARGIN clears the logo badge (bottom edge at margin+logoSize=160px)
  // with a modest gap, not the much larger empty band above the text block that 0.145 left; the
  // findEmptiestBand search below still keeps text off a busy subject regardless of how tall this
  // scan range is, so shrinking it just removes dead space, not the collision-avoidance itself.
  // BOTTOM_MARGIN clears the minimal footer.
  const SIDE_MARGIN = width * 0.11;
  const MAX_W = width - SIDE_MARGIN * 2;
  const FOOTER_H = 116;
  const TOP_MARGIN = height * 0.10;
  const BOTTOM_MARGIN = FOOTER_H + 40;
  const MAX_CONTENT_H = height - TOP_MARGIN - BOTTOM_MARGIN;
  const CENTER_X = width / 2;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = verse.fontStyle && FONT_STYLE_PRESETS[verse.fontStyle] ? verse.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  // The verse's poster design (verse.design - the AI's typography/colour for this background, also
  // used by the bilingual posters) wins over the theme preset, so a verse's posters, videos and
  // meditation card all share one look.
  const design = verse.design;
  const designEnglish = design ? DESIGN_ENGLISH_FONTS[design.englishFont] : null;
  const accentColorHex = design?.accentColor || verse.accentColor || PALETTE.GOLD;
  const englishFontFamily = designEnglish ? designEnglish.family : preset.englishFontFamily;
  const hasSecondaryEnglish = typeof verse.englishText === 'string' && typeof verse.englishRef === 'string';
  // Fonts and weights for the verse text come from the professional type system (proPrimaryFonts).

  let scale = 1.0;
  const MIN_TEXT_SCALE = 0.6;
  let primaryRefLines: string[] = [];
  let primaryRefFont = '', primaryRefLH = 0;
  let primaryLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let englishRefLines: string[] = [];
  let englishRefFont = '', englishRefLH = 0;
  let englishLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let gap = 0;
  let dividerGap = 0;
  let totalH = 0;

  for (let attempt = 0; attempt < 40; attempt++) {
    const primaryBaseSize = 42 * scale;
    const heroScale = 1.85;
    const primaryRefSize = 36 * scale;
    const englishBaseSize = 40 * scale;
    const englishHeroScale = 1.55;
    const englishRefSize = 30 * scale;
    gap = 32 * scale;
    dividerGap = 56 * scale;

    const pro = proPrimaryFonts(verse.primaryLang, englishFontFamily, design, fontStyle);
    const impact = design?.typeStyle === 'impact';
    const capsEnglish = englishFontFamily.includes('Oswald');
    primaryLayout = buildClauseBlock(ctx, verse.primaryText, {
      keyPhrase: design?.emphasis?.[verse.primaryLang],
      fillKey: impact,
      fillMax: 1.6,
      uppercase: verse.primaryLang === 'en' && capsEnglish,
      baseFont: `${pro.bodyWeight} ${primaryBaseSize}px ${pro.body}`,
      heroFont: `${pro.heroWeight} ${primaryBaseSize * heroScale}px ${pro.hero}`,
      baseLH: primaryBaseSize * 1.42,
      heroLH: primaryBaseSize * heroScale * 1.48,
      clauseGap: 12 * scale,
      maxWidth: MAX_W - 40,
      quoted: false,
      enableHero: design ? design.heroMode !== 'none' : true,
    });

    // The citation in the verse's own typeface and script, accent-coloured - not "Great Vibes", which
    // has no Tamil/Telugu glyphs (the book name fell back to another font beside ornate Latin digits).
    primaryRefFont = proReferenceFont(verse.primaryLang, primaryRefSize * 0.6);
    primaryRefLH = primaryRefSize * 1.4;
    primaryRefLines = wrapText(ctx, proReferenceText(verse.primaryLang, verse.primaryRef), primaryRefFont, MAX_W - 60);

    let overflowsWidth = primaryLayout.overflowsWidth;

    if (hasSecondaryEnglish) {
      const enW = proEnglishWeights(englishFontFamily);
      englishLayout = buildClauseBlock(ctx, verse.englishText!, {
        keyPhrase: design?.emphasis?.en,
        fillKey: impact,
        fillMax: 1.5,
        uppercase: capsEnglish,
        baseFont: `${enW.body} ${englishBaseSize}px ${englishFontFamily}`,
        heroFont: `${enW.hero} ${englishBaseSize * englishHeroScale}px ${englishFontFamily}`,
        baseLH: englishBaseSize * 1.45,
        heroLH: englishBaseSize * englishHeroScale * 1.45,
        clauseGap: 10 * scale,
        maxWidth: MAX_W - 40,
        quoted: false,
        enableHero: design ? design.heroMode !== 'none' : true,
      });

      englishRefFont = proReferenceFont('en', englishRefSize * 0.6);
      englishRefLH = englishRefSize * 1.5;
      englishRefLines = wrapText(ctx, proReferenceText('en', verse.englishRef!), englishRefFont, MAX_W - 60);

      overflowsWidth = overflowsWidth || englishLayout.overflowsWidth;
    }

    totalH = primaryLayout.totalHeight + gap + primaryRefLines.length * primaryRefLH;
    if (hasSecondaryEnglish) {
      totalH += dividerGap + englishLayout.totalHeight + gap * 0.6 + englishRefLines.length * englishRefLH;
    }

    if (totalH <= MAX_CONTENT_H && !overflowsWidth) break;
    if (scale <= MIN_TEXT_SCALE) break;
    scale = Math.max(MIN_TEXT_SCALE, scale * 0.9);
  }

  // Find the flattest contiguous vertical band (tall enough for the text block) within the scan
  // range, and center the text block inside it - rather than a fixed position that may land on
  // top of the generated subject regardless of where it actually ended up in the image. Then, in
  // case the subject sits to one side within that band (not just above/below it), nudge the text
  // horizontally toward whichever side is actually emptier.
  let curY: number;
  let alignX = CENTER_X;
  let bestStartRow = 0, bandRows = DETAIL_GRID_ROWS;
  if (detailGrid) {
    const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
    const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
    // Search for a band ~18% taller than the text actually needs, not an exact fit - centering the
    // text within the extra rows (see curY below) leaves a breathing-room margin above and below
    // it, so the block doesn't land flush against the subject's edge just because that's where the
    // low-detail region happened to end.
    const neededRows = Math.ceil((totalH / height) * DETAIL_GRID_ROWS * 1.18);
    const stripColStart = Math.floor(((CENTER_X - MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const stripColEnd = Math.ceil(((CENTER_X + MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const centerStripRowScores = computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd);
    bestStartRow = findEmptiestBand(centerStripRowScores, neededRows, minRow, maxRowExclusive);
    bandRows = Math.min(neededRows, maxRowExclusive - minRow);
    const rowPx = height / DETAIL_GRID_ROWS;
    const bandTopY = bestStartRow * rowPx;
    const bandHeightPx = bandRows * rowPx;
    curY = bandTopY + Math.max(0, (bandHeightPx - totalH) / 2);
    const bias = horizontalBiasWithinBand(detailGrid, bestStartRow, bandRows);
    alignX = CENTER_X + bias * (SIDE_MARGIN + MAX_W / 2);
  } else {
    curY = TOP_MARGIN + (MAX_CONTENT_H - totalH) / 2;
  }
  curY = Math.max(TOP_MARGIN, Math.min(curY, height - BOTTOM_MARGIN - totalH));

  // Theme (dark-on-light vs. light-on-dark) is picked from the actual brightness of the band the
  // text landed in - not assumed - so a genuinely bright sky gets crisp dark text without the
  // photo being darkened to force white text to work, matching the reference posters' bright,
  // minimally-obscured backgrounds; a dark/busy band still gets the safer white-on-black treatment.
  const bandLuminance = detailGrid ? averageLuminanceInBand(detailGrid, bestStartRow, bandRows) : 90;
  // Busyness of the actual text area - a clean, bright area gets dark text (see pickTheme).
  const bandBusy = detailGrid ? regionStats(detailGrid, width, height, alignX - MAX_W / 2, curY, alignX + MAX_W / 2, curY + totalH).peakBusy : undefined;
  const theme = pickTheme(bandLuminance, accentColorHex, bandBusy);
  const isLight = theme.isLight;

  // Vignette for edge polish - lighter touch on a light theme so the bright background stays visible.
  const vign = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.85);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(0.55, isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.14)');
  vign.addColorStop(1, isLight ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, width, height);

  // Bottom-weighted gradient so the footer stays legible without a solid bar - kept regardless of
  // theme since the footer always needs some darkening, but much lighter through the main content
  // area when the text itself is already dark-on-light.
  const legibilityGrad = ctx.createLinearGradient(0, 0, 0, height);
  legibilityGrad.addColorStop(0, isLight ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.08)');
  legibilityGrad.addColorStop(0.35, isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.2)');
  legibilityGrad.addColorStop(0.75, isLight ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.42)');
  legibilityGrad.addColorStop(1, isLight ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.72)');
  ctx.fillStyle = legibilityGrad;
  ctx.fillRect(0, 0, width, height);

  // Soft, feathered scrim directly behind wherever the text actually landed - drawn for both
  // themes: strong alpha on dark bands (insurance against non-uniform backgrounds) and a very
  // subtle alpha on light themes (gentle contrast polish without obscuring the bright sky).
  {
    const scrimTop = curY - 50;
    const scrimBottom = curY + totalH + 50;
    const feather = 90;
    // Light theme: a soft cream haze behind the dark text (as on the bilingual posters) - the old 8%
    // black barely registered, leaving dark text straight on bright, busy texture.
    const peak = isLight ? 0.44 : Math.min(0.66, Math.max(0.4, 0.4 + ((bandLuminance - 110) / 145) * 0.26));
    // Warm near-black rather than pure black: darkens without turning a warm photo grey.
    const rgb = isLight ? '252,249,243' : '18,12,8';
    const midFeather = peak * 0.83;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, `rgba(${rgb},0)`);
    scrimGrad.addColorStop(0.18, `rgba(${rgb},${midFeather})`);
    scrimGrad.addColorStop(0.5, `rgba(${rgb},${peak})`);
    scrimGrad.addColorStop(0.82, `rgba(${rgb},${midFeather})`);
    scrimGrad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Primary language verse first (matches reference images: Tamil verse is the visual anchor at
  // the top of the Scripture block) - steady body weight with one larger accent-colored hero clause
  // Reading highlighter: the word being read glows in the accent colour (on a light theme the text
  // stays dark so it remains readable, with the glow around it).
  const hlPass: WordHighlightPass | undefined = highlight === undefined ? undefined : {
    boxes: [], glowWords: highlight === 'collect' ? undefined : highlight,
    glowColor: hexToRgba(accentColorHex, 0.95),
    textColor: isLight ? theme.baseColor : '#FFFFFF',
  };
  curY = paintClauseBlock(ctx, primaryLayout, curY, alignX, theme, 'center', hlPass);
  curY += gap;

  // Primary-language reference (Tamil / Telugu / English-as-primary) BELOW its verse, in a
  // flowing script style, matches the reference images' "சங்கீதம் 41:1" placement
  ctx.save();
  ctx.font = primaryRefFont;
  ctx.fillStyle = theme.accentColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur + 6;
  ctx.shadowOffsetY = isLight ? 0 : 3;
  primaryRefLines.forEach((line) => {
    curY += primaryRefLH / 2;
    drawReferenceLine(ctx, line, alignX, curY, 'center', verse.primaryLang);
    curY += primaryRefLH / 2;
  });
  ctx.restore();

  // Secondary (English) block - entirely skipped for a single-language poster (e.g. a narration
  // video, which carries only one language - see hasSecondaryEnglish above).
  if (hasSecondaryEnglish) {
    curY += dividerGap / 2;
    drawFlourish(ctx, alignX, curY, Math.min(MAX_W * 0.22, 160 * scale), theme.accentColor);
    curY += dividerGap / 2;

    curY = paintClauseBlock(ctx, englishLayout, curY, alignX, theme);
    curY += gap * 0.6;

    ctx.save();
    ctx.font = englishRefFont;
    ctx.fillStyle = isLight ? 'rgba(36,26,16,0.75)' : 'rgba(255,255,255,0.8)';
    ctx.shadowColor = theme.shadowColor;
    ctx.shadowBlur = theme.shadowBlur;
    ctx.shadowOffsetY = isLight ? 0 : 2;
    englishRefLines.forEach((line) => {
      curY += englishRefLH / 2;
      drawReferenceLine(ctx, line, alignX, curY, 'center', 'en');
      curY += englishRefLH / 2;
    });
    ctx.restore();
  }

  // Branded footer bar: The Apostolic Church of India standard branding with Instagram gradient
  // camera icon to the left of the ministry name, matching the reference images exactly.
  const footerBarGrad = ctx.createLinearGradient(0, height - FOOTER_H, 0, height);
  footerBarGrad.addColorStop(0, 'rgba(8,7,6,0)');
  footerBarGrad.addColorStop(0.4, 'rgba(8,7,6,0.78)');
  footerBarGrad.addColorStop(1, 'rgba(8,7,6,0.96)');
  ctx.fillStyle = footerBarGrad;
  ctx.fillRect(0, height - FOOTER_H, width, FOOTER_H);

  const footerY = height - FOOTER_H + 58;
  const igSize = 40;
  const igGap = 16;
  const ministryText = MINISTRY_NAME;
  ctx.save();
  ctx.font = '700 22px Lato, Montserrat';
  const ministryTextWidth = ctx.measureText(ministryText).width;
  const totalGroupW = igSize + igGap + ministryTextWidth;
  const groupLeft = (width - totalGroupW) / 2;

  drawInstagramIcon(ctx, groupLeft + igSize / 2, footerY, igSize);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 1;
  fillTextLetterSpaced(ctx, ministryText, groupLeft + igSize + igGap + ministryTextWidth / 2, footerY, 4);
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
  return { blob, words: hlPass?.boxes ?? [] };
}

// The editorial poster style (left-text column / right-side subject, ~4:5) - a sibling to
// renderVersePoster above rather than a branch inside it, matching this file's existing convention
// of each render function owning its own background/placement/theme scaffolding (renderVersePoster/
// renderHookCard/renderThumbnail already each duplicate this rather than sharing it). Reuses the
// same placement-search machinery (computeDetailGrid/findEmptiestBand/computeCenterStripRowScores)
// as renderVersePoster, just scoped to a LEFT-anchored column strip instead of a canvas-centered
// one - the background is composed (see ai/analyzer.ts's editorial composition rule) with the
// subject confined to the right side specifically so this works, the same "prompt asks for a
// specific composition, renderer verifies/fine-tunes against the real pixels" pattern already
// proven for the vertical layout, just rotated 90°.
export async function renderEditorialPoster(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = EDITORIAL_W;
  canvas.height = EDITORIAL_H;
  const ctx = canvas.getContext('2d')!;
  const width = EDITORIAL_W, height = EDITORIAL_H;

  // Background - lighter treatment than renderVersePoster's: no brightness reduction, since this
  // style deliberately keeps the sky/backdrop bright and untouched rather than darkening it to
  // force light text to work (see pickTheme below, which still derives dark-vs-light text from the
  // actual pixels rather than assuming bright).
  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.08) saturate(1.15)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  // Logo badge, top-left - identical treatment to renderVersePoster's.
  if (logoImg) {
    ctx.save();
    const logoSize = 100, margin = 60;
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  // Text column geometry: LEFT ~8% margin, column ~56% of width - leaves the right ~36% clear for
  // the subject (matching the ~35-45% subject zone the background was composed for, plus a little
  // breathing room at the boundary). FOOTER_H is small - this style has no dark bar, just a quiet
  // branding line (see bottom of this function).
  const LEFT_MARGIN = width * 0.08;
  const COLUMN_W = width * 0.56;
  const MAX_W = COLUMN_W - 24;
  const COLUMN_CENTER_X = LEFT_MARGIN + COLUMN_W / 2;
  const FOOTER_H = 70;
  const TOP_MARGIN = height * 0.12;
  const BOTTOM_MARGIN = FOOTER_H + 30;
  const MAX_CONTENT_H = height - TOP_MARGIN - BOTTOM_MARGIN;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = verse.fontStyle && FONT_STYLE_PRESETS[verse.fontStyle] ? verse.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  const accentColorHex = verse.accentColor || PALETTE.GOLD;
  const primaryFontFamily = primaryFontFamilyFor(verse.primaryLang, fontStyle);
  const englishFontFamily = preset.englishFontFamily;
  const englishStyle = preset.englishItalic ? 'italic ' : '';
  const hasSecondaryEnglish = typeof verse.englishText === 'string' && typeof verse.englishRef === 'string';
  const primaryIsEnglish = verse.primaryLang === 'en';
  const primaryStylePrefix = primaryIsEnglish ? englishStyle : '';
  const primaryBaseWeight = primaryIsEnglish ? preset.englishWeight : 700;
  const primaryHeroWeight = primaryIsEnglish ? preset.englishWeight : 900;
  // The English hero word (see splitFirstWordHero) switches to a script/cursive family, matching
  // the reference sample's "Peace" - body English stays in the preset's own serif family.
  const englishHeroFontFamily = '"Great Vibes", "Dancing Script", ' + englishFontFamily;

  let scale = 1.0;
  const MIN_TEXT_SCALE = 0.55;
  let primaryRefLines: string[] = [];
  let primaryRefFont = '', primaryRefLH = 0;
  let primaryLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let englishRefLines: string[] = [];
  let englishRefFont = '', englishRefLH = 0;
  let englishLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let gap = 0;
  let dividerGap = 0;
  let totalH = 0;

  for (let attempt = 0; attempt < 40; attempt++) {
    const primaryBaseSize = 36 * scale;
    const heroScale = 2.0;
    const primaryRefSize = 30 * scale;
    const englishBaseSize = 32 * scale;
    const englishHeroScale = 1.7;
    const englishRefSize = 26 * scale;
    gap = 26 * scale;
    dividerGap = 46 * scale;

    // heroMode: 'firstWord' - this layout's hero rule (see splitFirstWordHero): only the verse's
    // opening word is enlarged, not the shortest punctuation clause renderVersePoster uses.
    primaryLayout = buildClauseBlock(ctx, verse.primaryText, {
      baseFont: `${primaryStylePrefix}${primaryBaseWeight} ${primaryBaseSize}px ${primaryFontFamily}`,
      heroFont: `${primaryStylePrefix}${primaryHeroWeight} ${primaryBaseSize * heroScale}px ${primaryFontFamily}`,
      baseLH: primaryBaseSize * 1.42,
      heroLH: primaryBaseSize * heroScale * 1.3,
      clauseGap: 10 * scale,
      maxWidth: MAX_W,
      quoted: false,
      enableHero: true,
      heroMode: 'firstWord',
    });

    primaryRefFont = `700 ${primaryRefSize}px "Great Vibes", "Dancing Script", Montserrat`;
    primaryRefLH = primaryRefSize * 1.4;
    primaryRefLines = wrapText(ctx, verse.primaryRef, primaryRefFont, MAX_W - 20);

    let overflowsWidth = primaryLayout.overflowsWidth;

    if (hasSecondaryEnglish) {
      const englishBaseWeight = primaryIsEnglish ? preset.englishWeight : 500;
      englishLayout = buildClauseBlock(ctx, verse.englishText!, {
        baseFont: `${englishStyle}${englishBaseWeight} ${englishBaseSize}px ${englishFontFamily}`,
        heroFont: `700 ${englishBaseSize * englishHeroScale}px ${englishHeroFontFamily}`,
        baseLH: englishBaseSize * 1.45,
        heroLH: englishBaseSize * englishHeroScale * 1.25,
        clauseGap: 8 * scale,
        maxWidth: MAX_W,
        quoted: false,
        enableHero: true,
        heroMode: 'firstWord',
      });

      englishRefFont = `400 ${englishRefSize}px "Great Vibes", "Dancing Script", Montserrat`;
      englishRefLH = englishRefSize * 1.5;
      englishRefLines = wrapText(ctx, verse.englishRef!, englishRefFont, MAX_W - 20);

      overflowsWidth = overflowsWidth || englishLayout.overflowsWidth;
    }

    totalH = primaryLayout.totalHeight + gap + primaryRefLines.length * primaryRefLH;
    if (hasSecondaryEnglish) {
      totalH += dividerGap + englishLayout.totalHeight + gap * 0.6 + englishRefLines.length * englishRefLH;
    }

    if (totalH <= MAX_CONTENT_H && !overflowsWidth) break;
    if (scale <= MIN_TEXT_SCALE) break;
    scale = Math.max(MIN_TEXT_SCALE, scale * 0.9);
  }

  // Vertical placement search - identical mechanism to renderVersePoster's (same
  // computeCenterStripRowScores/findEmptiestBand), just given the LEFT column's own x-range instead
  // of a canvas-centered strip. No horizontal re-bias within the band (unlike renderVersePoster):
  // horizontalBiasWithinBand compares left-third vs right-third busyness across the FULL image
  // width, a signal meaningful for nudging within a centered band but not for this column, which is
  // already deliberately anchored left by construction - reusing that global metric here would risk
  // nudging text toward the subject boundary rather than away from it.
  let curY: number;
  const alignX = COLUMN_CENTER_X;
  let bestStartRow = 0, bandRows = DETAIL_GRID_ROWS;
  if (detailGrid) {
    const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
    const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
    const neededRows = Math.ceil((totalH / height) * DETAIL_GRID_ROWS * 1.18);
    const stripColStart = Math.floor((LEFT_MARGIN / width) * DETAIL_GRID_COLS);
    const stripColEnd = Math.ceil(((LEFT_MARGIN + COLUMN_W) / width) * DETAIL_GRID_COLS);
    const centerStripRowScores = computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd);
    bestStartRow = findEmptiestBand(centerStripRowScores, neededRows, minRow, maxRowExclusive);
    bandRows = Math.min(neededRows, maxRowExclusive - minRow);
    const rowPx = height / DETAIL_GRID_ROWS;
    const bandTopY = bestStartRow * rowPx;
    const bandHeightPx = bandRows * rowPx;
    curY = bandTopY + Math.max(0, (bandHeightPx - totalH) / 2);
  } else {
    curY = TOP_MARGIN + (MAX_CONTENT_H - totalH) / 2;
  }
  curY = Math.max(TOP_MARGIN, Math.min(curY, height - BOTTOM_MARGIN - totalH));

  // Theme still derived from the actual band luminance, not hardcoded to light - if a given verse's
  // background isn't genuinely bright on the left despite the composition prompt, falling back to
  // the light-on-dark treatment is the correct safety net rather than forcing unreadable dark text
  // onto a dark band.
  const bandLuminance = detailGrid ? averageLuminanceInBand(detailGrid, bestStartRow, bandRows) : 90;
  const theme = pickTheme(bandLuminance, accentColorHex);
  const isLight = theme.isLight;

  // No vignette, no bottom "legibility" gradient here - this style deliberately keeps the
  // background untouched rather than darkening it (see the background filter above). Only a very
  // light safety-net scrim behind the text, and only when the band actually came back dark despite
  // the composition prompt asking for bright/open - on the expected bright case this is a no-op.
  if (!isLight) {
    const scrimTop = curY - 40;
    const scrimBottom = curY + totalH + 40;
    const feather = 70;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, 'rgba(0,0,0,0)');
    scrimGrad.addColorStop(0.2, 'rgba(0,0,0,0.28)');
    scrimGrad.addColorStop(0.5, 'rgba(0,0,0,0.36)');
    scrimGrad.addColorStop(0.8, 'rgba(0,0,0,0.28)');
    scrimGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  curY = paintClauseBlock(ctx, primaryLayout, curY, alignX, theme);
  curY += gap;

  ctx.save();
  ctx.font = primaryRefFont;
  ctx.fillStyle = theme.accentColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur + 6;
  ctx.shadowOffsetY = isLight ? 0 : 3;
  primaryRefLines.forEach((line) => {
    curY += primaryRefLH / 2;
    ctx.fillText(line, alignX, curY);
    curY += primaryRefLH / 2;
  });
  ctx.restore();

  if (hasSecondaryEnglish) {
    curY += dividerGap / 2;
    drawFlourish(ctx, alignX, curY, Math.min(COLUMN_W * 0.22, 140 * scale), theme.accentColor);
    curY += dividerGap / 2;

    curY = paintClauseBlock(ctx, englishLayout, curY, alignX, theme);
    curY += gap * 0.6;

    ctx.save();
    ctx.font = englishRefFont;
    ctx.fillStyle = isLight ? 'rgba(36,26,16,0.75)' : 'rgba(255,255,255,0.8)';
    ctx.shadowColor = theme.shadowColor;
    ctx.shadowBlur = theme.shadowBlur;
    ctx.shadowOffsetY = isLight ? 0 : 2;
    englishRefLines.forEach((line) => {
      curY += englishRefLH / 2;
      ctx.fillText(line, alignX, curY);
      curY += englishRefLH / 2;
    });
    ctx.restore();
  }

  // Quiet branding line, bottom-center of the full frame - no dark bar (matches the reference
  // sample's clean, unobstructed bottom edge), just small letter-spaced text in the theme's own
  // color so it reads as a deliberate signature rather than an app watermark.
  const footerY = height - FOOTER_H / 2 - 6;
  ctx.save();
  ctx.font = '700 18px Lato, Montserrat';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLight ? 'rgba(36,26,16,0.68)' : 'rgba(255,255,255,0.82)';
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = 8;
  fillTextLetterSpaced(ctx, MINISTRY_NAME, width / 2, footerY, 3);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

// Option B - subject confined to a small bottom-right corner, text spanning the top full-width.
// Structurally much closer to renderVersePoster than renderEditorialPoster (full-width centered
// text stacking searched via a canvas-centered strip, not a side column) - the asymmetric corner
// placement lives entirely in the background composition prompt (see themeMapper.ts's
// CORNER_PLACEMENT_CLAUSE), not in new renderer geometry. Uses the same EDITORIAL_W/H canvas and
// bright/undarkened background treatment as renderEditorialPoster so all three Poster styles read
// as one consistent visual system.
// Families/weights behind each PosterDesign font choice - every combination here is loaded by
// index.html and preloaded via FONT_PRELOAD_SPECS (body weight differs for italic where a family
// only ships some weights in italic).
const DESIGN_ENGLISH_FONTS: Record<PosterEnglishFont, { family: string; body: number; bodyItalic: number; hero: number }> = {
  playfair: { family: '"Playfair Display"', body: 600, bodyItalic: 600, hero: 700 },
  cormorant: { family: '"Cormorant Garamond"', body: 700, bodyItalic: 600, hero: 700 },
  lora: { family: 'Lora', body: 400, bodyItalic: 600, hero: 700 },
  cinzel: { family: 'Cinzel', body: 700, bodyItalic: 700, hero: 900 },
  montserrat: { family: 'Montserrat', body: 500, bodyItalic: 500, hero: 800 },
  lato: { family: 'Lato', body: 400, bodyItalic: 400, hero: 900 },
  'eb-garamond': { family: '"EB Garamond"', body: 500, bodyItalic: 500, hero: 700 },
  'libre-baskerville': { family: '"Libre Baskerville"', body: 400, bodyItalic: 400, hero: 700 },
  'dm-serif-display': { family: '"DM Serif Display"', body: 400, bodyItalic: 400, hero: 400 },
  'crimson-pro': { family: '"Crimson Pro"', body: 500, bodyItalic: 500, hero: 700 },
  oswald: { family: 'Oswald', body: 400, bodyItalic: 400, hero: 700 },
};
// Tamil/Telugu faces: the family for emphasised words, its weight (single-weight display faces such as
// Tiro and Ramabhadra stay at 400 - a synthetic bold would smear them), and the body face it pairs with.
// stretch: a CSS font-stretch keyword for faces with a width axis (Anek) - condensed for impact.
interface IndicFace { family: string; hero: number; heroStretch?: string; body: { family: string; weight: number; stretch?: string } }
const NOTO_SANS_TA = { family: '"Noto Sans Tamil", sans-serif', weight: 500 };
const MUKTA_MALAR = { family: '"Mukta Malar", "Noto Sans Tamil", sans-serif', weight: 500 };
const NOTO_SANS_TE = { family: '"Noto Sans Telugu", sans-serif', weight: 500 };
const HIND_GUNTUR = { family: '"Hind Guntur", "Noto Sans Telugu", sans-serif', weight: 500 };
const TAMIL_FACES: Record<PosterTamilFont, IndicFace> = {
  'noto-serif-tamil': { family: '"Noto Serif Tamil", serif', hero: 700, body: NOTO_SANS_TA },
  'noto-sans-tamil': { family: '"Noto Sans Tamil", sans-serif', hero: 700, body: NOTO_SANS_TA },
  'arima-madurai': { family: '"Arima Madurai", serif', hero: 700, body: MUKTA_MALAR },
  'tiro-tamil': { family: '"Tiro Tamil", "Noto Serif Tamil", serif', hero: 400, body: MUKTA_MALAR },
  'mukta-malar': { family: '"Mukta Malar", "Noto Sans Tamil", sans-serif', hero: 700, body: MUKTA_MALAR },
  'hind-madurai': { family: '"Hind Madurai", "Noto Sans Tamil", sans-serif', hero: 700, body: { family: '"Hind Madurai", "Noto Sans Tamil", sans-serif', weight: 500 } },
  catamaran: { family: 'Catamaran, "Noto Sans Tamil", sans-serif', hero: 800, body: { family: 'Catamaran, "Noto Sans Tamil", sans-serif', weight: 500 } },
  'anek-tamil': { family: '"Anek Tamil", "Noto Sans Tamil", sans-serif', hero: 800, heroStretch: 'condensed', body: { family: '"Anek Tamil", "Noto Sans Tamil", sans-serif', weight: 500, stretch: 'semi-condensed' } },
};
const TELUGU_FACES: Record<PosterTeluguFont, IndicFace> = {
  'noto-serif-telugu': { family: '"Noto Serif Telugu", serif', hero: 700, body: NOTO_SANS_TE },
  'noto-sans-telugu': { family: '"Noto Sans Telugu", sans-serif', hero: 700, body: NOTO_SANS_TE },
  'tiro-telugu': { family: '"Tiro Telugu", "Noto Serif Telugu", serif', hero: 400, body: HIND_GUNTUR },
  'hind-guntur': { family: '"Hind Guntur", "Noto Sans Telugu", sans-serif', hero: 700, body: HIND_GUNTUR },
  'anek-telugu': { family: '"Anek Telugu", "Noto Sans Telugu", sans-serif', hero: 800, heroStretch: 'condensed', body: { family: '"Anek Telugu", "Noto Sans Telugu", sans-serif', weight: 500, stretch: 'semi-condensed' } },
  ramabhadra: { family: 'Ramabhadra, "Noto Serif Telugu", serif', hero: 400, body: HIND_GUNTUR },
};
// Vertical position of a block within the usable text area, 0 = top edge, 1 = bottom edge.
const ANCHOR_FRACTION: Record<PosterAnchor, number> = { top: 0, upper: 0.25, middle: 0.5, lower: 0.75, bottom: 1 };

export async function renderCornerPoster(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = EDITORIAL_W;
  canvas.height = EDITORIAL_H;
  const ctx = canvas.getContext('2d')!;
  const width = EDITORIAL_W, height = EDITORIAL_H;

  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.08) saturate(1.15)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  if (logoImg) {
    ctx.save();
    const logoSize = 100, margin = 60;
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  const SIDE_MARGIN = width * 0.1;
  const MAX_W = width - SIDE_MARGIN * 2;
  const CENTER_X = width / 2;
  const FOOTER_H = 70;
  const TOP_MARGIN = height * 0.11;
  const BOTTOM_MARGIN = FOOTER_H + 30;
  const MAX_CONTENT_H = height - TOP_MARGIN - BOTTOM_MARGIN;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = verse.fontStyle && FONT_STYLE_PRESETS[verse.fontStyle] ? verse.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  // A Claude design (verse.design) overrides the preset's typography; otherwise the per-verse preset.
  const design = verse.design;
  const accentColorHex = design?.accentColor || verse.accentColor || PALETTE.GOLD;
  const designEnglish = design ? DESIGN_ENGLISH_FONTS[design.englishFont] : null;
  const englishFontFamily = designEnglish ? designEnglish.family : preset.englishFontFamily;
  // Upright English body text throughout (italic serif beside a sans primary block looked mismatched).
  const englishItalic = false;
  const englishStyle = englishItalic ? 'italic ' : '';
  const hasSecondaryEnglish = typeof verse.englishText === 'string' && typeof verse.englishRef === 'string';
  const englishBodyWeight = designEnglish ? (englishItalic ? designEnglish.bodyItalic : designEnglish.body) : 600; // 600, not 500: the italic presets only ship 400 and 600+, so 500 silently rendered as the thin 400
  const englishSerifHeroWeight = designEnglish ? designEnglish.hero : 700;
  const heroEnabled = design ? design.heroMode !== 'none' : true;
  const englishHeroFontFamily = '"Great Vibes", "Dancing Script", ' + englishFontFamily;
  // Script faces are unreadable in capitals ("LORD" in Great Vibes renders as a run of ornate
  // loops), so a hero containing an all-caps word (LORD, GOD) keeps the serif instead - as does a
  // design that asks for no script hero.
  const englishHeroWords = splitFirstWordHero(stripCurlyQuotes(verse.englishText || ''))[0];
  // No script faces (see the professional type system): the emphasis stays in the English serif.
  void englishHeroWords;
  const useScriptHero = false;
  const englishHeroFont = (size: number) => useScriptHero
    ? `700 ${size}px ${englishHeroFontFamily}`
    : `${englishStyle}${englishSerifHeroWeight} ${size}px ${englishFontFamily}`;

  // Each language is built as its own block (verse lines + its reference), so the two can be laid
  // out either stacked in one band (the classic look) or as two independent blocks in different
  // clear areas of the background - see the arrangement choice below.
  type Align = 'center' | 'left' | 'right';
  interface LangBlock {
    layout: ClauseBlockLayout;
    refLines: string[];
    refFont: string;
    refLH: number;
    refGap: number;
    height: number;
    width: number;
  }
  const refsWidth = (lines: string[], font: string) => {
    ctx.save();
    ctx.font = font;
    const w = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
    ctx.restore();
    return w;
  };
  const buildPrimaryBlock = (s: number, maxW: number): LangBlock => {
    const baseSize = 38 * s, heroScale = 1.8, refSize = 32 * s;
    const pro = proPrimaryFonts(verse.primaryLang, englishFontFamily, design, fontStyle);
    const layout = buildClauseBlock(ctx, verse.primaryText, {
      keyPhrase: design?.emphasis?.[verse.primaryLang],
      fillKey: design?.typeStyle === 'impact',
      fillMax: 1.6,
      uppercase: verse.primaryLang === 'en' && englishFontFamily.includes('Oswald'),
      baseFont: `${pro.bodyWeight} ${baseSize}px ${pro.body}`,
      heroFont: `${pro.heroWeight} ${baseSize * heroScale}px ${pro.hero}`,
      baseLH: baseSize * 1.42,
      heroLH: baseSize * heroScale * 1.3,
      clauseGap: 12 * s,
      maxWidth: maxW,
      quoted: false,
      enableHero: heroEnabled,
      heroMode: 'firstWord',
    });
    // Citation in the verse's own typeface (see renderVersePoster for why not the script face).
    const refFont = proReferenceFont(verse.primaryLang, refSize * 0.6);
    const refLH = refSize * 1.4;
    const refLines = wrapText(ctx, proReferenceText(verse.primaryLang, verse.primaryRef), refFont, maxW - 20);
    const refGap = 28 * s;
    return {
      layout, refLines, refFont, refLH, refGap,
      height: layout.totalHeight + refGap + refLines.length * refLH,
      width: Math.max(maxLineWidth(ctx, layout), refsWidth(refLines, refFont)),
    };
  };
  const buildEnglishBlock = (s: number, maxW: number): LangBlock => {
    const baseSize = 34 * s, heroScale = 1.6, refSize = 28 * s;
    const baseWeight = proEnglishWeights(englishFontFamily).body;
    void englishBodyWeight;
    const layout = buildClauseBlock(ctx, verse.englishText!, {
      keyPhrase: design?.emphasis?.en,
      fillKey: design?.typeStyle === 'impact',
      fillMax: 1.5,
      uppercase: englishFontFamily.includes('Oswald'),
      baseFont: `${baseWeight} ${baseSize}px ${englishFontFamily}`,
      heroFont: englishHeroFont(baseSize * heroScale),
      baseLH: baseSize * 1.45,
      heroLH: baseSize * heroScale * 1.25,
      clauseGap: 10 * s,
      maxWidth: maxW,
      quoted: false,
      enableHero: heroEnabled,
      heroMode: 'firstWord',
    });
    const refFont = proReferenceFont('en', refSize * 0.6);
    const refLH = refSize * 1.5;
    const refLines = wrapText(ctx, proReferenceText('en', verse.englishRef!), refFont, maxW - 20);
    const refGap = 28 * s * 0.6;
    return {
      layout, refLines, refFont, refLH, refGap,
      height: layout.totalHeight + refGap + refLines.length * refLH,
      width: Math.max(maxLineWidth(ctx, layout), refsWidth(refLines, refFont)),
    };
  };

  // --- Arrangement A: stacked (primary, flourish divider, English) in one centered band ---
  const MIN_TEXT_SCALE = 0.55;
  const rowPx = height / DETAIL_GRID_ROWS;
  const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
  const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
  const stripColStart = Math.floor(((CENTER_X - MAX_W / 2) / width) * DETAIL_GRID_COLS);
  const stripColEnd = Math.ceil(((CENTER_X + MAX_W / 2) / width) * DETAIL_GRID_COLS);
  const centerStripRowScores = detailGrid ? computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd) : null;

  // Lays out the stacked arrangement at text scale `s` and places it in the emptiest band.
  const layoutStacked = (s: number) => {
    const dividerGap = 50 * s;
    const primaryBlock = buildPrimaryBlock(s, MAX_W - 20);
    const englishBlock = hasSecondaryEnglish ? buildEnglishBlock(s, MAX_W - 20) : null;
    const totalH = primaryBlock.height + (englishBlock ? dividerGap + englishBlock.height : 0);
    const overflowsWidth = primaryBlock.layout.overflowsWidth || !!englishBlock?.layout.overflowsWidth;
    let top: number;
    let x = CENTER_X;
    let bestStartRow = 0, bandRows = DETAIL_GRID_ROWS;
    if (detailGrid && centerStripRowScores) {
      const neededRows = Math.ceil((totalH / height) * DETAIL_GRID_ROWS * 1.18);
      bestStartRow = findEmptiestBand(centerStripRowScores, neededRows, minRow, maxRowExclusive);
      bandRows = Math.min(neededRows, maxRowExclusive - minRow);
      top = bestStartRow * rowPx + Math.max(0, (bandRows * rowPx - totalH) / 2);
      // Small bias only - the corner subject is already confined well clear of the top band by
      // the composition prompt, this just nudges for any minor asymmetry.
      const bias = horizontalBiasWithinBand(detailGrid, bestStartRow, bandRows);
      x = CENTER_X + bias * (SIDE_MARGIN + MAX_W / 2);
    } else {
      top = TOP_MARGIN + (MAX_CONTENT_H - totalH) / 2;
    }
    top = Math.max(TOP_MARGIN, Math.min(top, height - BOTTOM_MARGIN - totalH));
    return { s, dividerGap, primaryBlock, englishBlock, totalH, overflowsWidth, top, x, bestStartRow, bandRows };
  };

  let scale = 1.0;
  let stacked = layoutStacked(scale);
  for (let attempt = 0; attempt < 40; attempt++) {
    stacked = layoutStacked(scale);
    if (stacked.totalH <= MAX_CONTENT_H && !stacked.overflowsWidth) break;
    if (scale <= MIN_TEXT_SCALE) break;
    scale = Math.max(MIN_TEXT_SCALE, scale * 0.9);
  }
  interface Placed { block: LangBlock; top: number; x: number; align: Align; theme: PosterTheme }
  const rectOf = (b: LangBlock, top: number, x: number, align: Align) => {
    const x0 = align === 'center' ? x - b.width / 2 : align === 'left' ? x : x - b.width;
    return { x0, x1: x0 + b.width, y0: top, y1: top + b.height };
  };
  const busyOf = (b: LangBlock, top: number, x: number, align: Align) => {
    if (!detailGrid) return 0;
    const r = rectOf(b, top, x, align);
    return regionStats(detailGrid, width, height, r.x0, r.y0, r.x1, r.y1).peakBusy;
  };
  const themeFor = (b: LangBlock, top: number, x: number, align: Align) => {
    if (!detailGrid) return pickTheme(90, accentColorHex);
    const r = rectOf(b, top, x, align);
    const st = regionStats(detailGrid, width, height, r.x0, r.y0, r.x1, r.y1);
    return pickTheme(st.lum, accentColorHex, st.peakBusy);
  };
  const stackedBusyOf = (st: ReturnType<typeof layoutStacked>) => Math.max(
    busyOf(st.primaryBlock, st.top, st.x, 'center'),
    st.englishBlock ? busyOf(st.englishBlock, st.top + st.primaryBlock.height + st.dividerGap, st.x, 'center') : 0
  );

  // --- Arrangement A': compact stacked ---
  // When the stacked block runs into the subject but there is ONE clear area that is just a little
  // too short (Lamentations 3:24: ~490px of open sky above a seated figure, blocks needing ~560px),
  // shrinking the text slightly keeps the classic look while clearing the subject entirely.
  let stackedBusy = stackedBusyOf(stacked);
  if (detailGrid && stackedBusy > PEAK_BUSY_THRESHOLD) {
    // Largest scale (down to 75%) whose block, slid to its calmest vertical position, actually
    // clears the subject. A smaller size that is merely "a bit less busy" isn't worth the
    // readability cost, so if nothing clears it the original size stays.
    for (let s = stacked.s * 0.95; s >= Math.max(MIN_TEXT_SCALE, 0.75); s *= 0.95) {
      const candidate = layoutStacked(s);
      if (candidate.overflowsWidth) continue;
      let bestTop = candidate.top, bestBusy = Infinity;
      for (let r = minRow; (r * rowPx) + candidate.totalH <= height - BOTTOM_MARGIN; r++) {
        const busy = stackedBusyOf({ ...candidate, top: r * rowPx, x: CENTER_X });
        if (busy < bestBusy) { bestBusy = busy; bestTop = r * rowPx; }
      }
      if (bestBusy <= PEAK_BUSY_THRESHOLD) {
        const bestRow = Math.floor(bestTop / rowPx);
        stacked = { ...candidate, top: bestTop, x: CENTER_X, bestStartRow: bestRow, bandRows: Math.ceil(candidate.totalH / rowPx) };
        stackedBusy = bestBusy;
        break;
      }
    }
  }
  scale = stacked.s;
  const { primaryBlock, englishBlock, dividerGap, top: stackedTop, x: stackedX, bestStartRow, bandRows } = stacked;

  const stackedStats = detailGrid ? regionStats(detailGrid, width, height, stackedX - MAX_W / 2, stackedTop, stackedX + MAX_W / 2, stackedTop + stacked.totalH) : null;
  void bestStartRow; void bandRows;
  const stackedTheme = pickTheme(stackedStats ? stackedStats.lum : 90, accentColorHex, stackedStats?.peakBusy);
  let placed: Placed[] = [{ block: primaryBlock, top: stackedTop, x: stackedX, align: 'center', theme: stackedTheme }];
  if (englishBlock) {
    placed.push({ block: englishBlock, top: stackedTop + primaryBlock.height + dividerGap, x: stackedX, align: 'center', theme: stackedTheme });
  }
  let arrangement: 'stacked' | 'split' = 'stacked';

  // --- Arrangement B: two independent blocks ---
  // When the stacked band runs into the subject (a tall figure, a busy horizon), each language is
  // placed on its own in the clearest area available to it - centered, or in a left/right column
  // with matching text alignment - and gets its own light/dark treatment from the pixels behind it.
  // Only used when it is clearly calmer than stacked, so the classic look stays the default.
  if (englishBlock && detailGrid) {
    if (stackedBusy > PEAK_BUSY_THRESHOLD) {
      const SIDE_COL_W = width * 0.56;
      const columns: { align: Align; x: number; maxW: number; penalty: number }[] = [
        { align: 'center', x: CENTER_X, maxW: MAX_W - 20, penalty: 0 },
        { align: 'left', x: SIDE_MARGIN, maxW: SIDE_COL_W, penalty: 1.5 },
        { align: 'right', x: width - SIDE_MARGIN, maxW: SIDE_COL_W, penalty: 1.5 },
      ];
      // Blocks are smaller than the stacked total, so the split layout can afford full size again.
      const splitScale = Math.min(1, Math.max(scale, 0.85));
      // Every candidate position for a block, in every column option.
      type Candidate = { block: LangBlock; top: number; col: typeof columns[number]; busy: number };
      const candidatesFor = (build: (s: number, w: number) => LangBlock): Candidate[] => {
        const out: Candidate[] = [];
        // A block may also shrink a little to fit a clear area that is just too short for it, at a
        // small cost per step - so a slightly smaller primary block on top beats swapping the order.
        for (const sizeStep of [1, 0.9, 0.8]) {
          const sizePenalty = (1 - sizeStep) * 15;
          for (const col of columns) {
            const block = build(splitScale * sizeStep, col.maxW);
            if (block.layout.overflowsWidth) continue;
            for (let top = minRow * rowPx; top + block.height <= height - BOTTOM_MARGIN; top += rowPx) {
              out.push({ block, top, col, busy: busyOf(block, top, col.x, col.align) + col.penalty + sizePenalty });
            }
          }
        }
        return out;
      };
      // Choose the PAIR together (not one block greedily, then the other in whatever is left - that
      // let English take the top band and push the primary language below it): the pair's score is
      // its busier block, plus a reading-order penalty when English sits above the primary language
      // and a slight preference for higher placement.
      const pCands = candidatesFor(buildPrimaryBlock);
      const eCands = candidatesFor(buildEnglishBlock);
      const SPLIT_GAP = 40;
      let bestPair: { p: Candidate; e: Candidate; score: number } | null = null;
      for (const pc of pCands) {
        if (bestPair && pc.busy >= bestPair.score) continue;
        for (const ec of eCands) {
          const overlaps = ec.top < pc.top + pc.block.height + SPLIT_GAP && pc.top < ec.top + ec.block.height + SPLIT_GAP;
          if (overlaps) continue;
          const orderPenalty = ec.top < pc.top ? 8 : 0;
          const score = Math.max(pc.busy, ec.busy) + orderPenalty + (pc.top / height) * 0.5;
          if (!bestPair || score < bestPair.score) bestPair = { p: pc, e: ec, score };
        }
      }
      const p = bestPair?.p ?? null;
      const e = bestPair?.e ?? null;
      if (p && e) {
        const splitBusy = Math.max(busyOf(p.block, p.top, p.col.x, p.col.align), busyOf(e.block, e.top, e.col.x, e.col.align));
        if (splitBusy < stackedBusy * 0.6) {
          arrangement = 'split';
          placed = [p, e].map((b) => ({ block: b.block, top: b.top, x: b.col.x, align: b.col.align, theme: themeFor(b.block, b.top, b.col.x, b.col.align) }));
        }
      }
    }
  }

  // --- Claude design (verse.design) ---
  // Starts each block at the design's anchor/column and keeps it there only if the pixels behind it
  // are calm; otherwise slides it to the nearest calm position (shrinking a little if needed). If
  // the design can't be honoured without putting text on the subject, the automatic layout above
  // stands - a proposal never overrides legibility.
  let paintDividerGap = dividerGap;
  if (design) {
    const SIDE_COL_W_D = width * 0.56;
    const colFor = (align: Align) => align === 'left'
      ? { x: SIDE_MARGIN, maxW: SIDE_COL_W_D }
      : align === 'right' ? { x: width - SIDE_MARGIN, maxW: SIDE_COL_W_D } : { x: CENTER_X, maxW: MAX_W - 20 };
    const availTop = TOP_MARGIN, availBottom = height - BOTTOM_MARGIN;
    const anchorTop = (anchor: PosterAnchor, h: number) => availTop + ANCHOR_FRACTION[anchor] * Math.max(0, (availBottom - availTop) - h);
    const calm = (b: LangBlock, top: number, x: number, align: Align) => !detailGrid || busyOf(b, top, x, align) <= PEAK_BUSY_THRESHOLD;
    const nearestTop = (h: number, target: number, ok: (top: number) => boolean): number | null => {
      for (let d = 0; d * rowPx <= availBottom - availTop; d++) {
        for (const top of d === 0 ? [target] : [target - d * rowPx, target + d * rowPx]) {
          if (top < availTop || top + h > availBottom) continue;
          if (ok(top)) return top;
        }
      }
      return null;
    };
    let designPlaced: Placed[] | null = null;
    let designDividerGap = dividerGap;
    let designArrangement: 'stacked' | 'split' = 'stacked';
    if (design.arrangement === 'split' && englishBlock) {
      const pAlign = design.primary.align, eAlign = design.english.align;
      const pc = colFor(pAlign), ec = colFor(eAlign);
      const SPLIT_GAP_D = 40;
      for (let s = 1; s >= 0.7 && !designPlaced; s *= 0.92) {
        const pb = buildPrimaryBlock(s * design.primary.sizeScale, pc.maxW);
        const eb = buildEnglishBlock(s * design.english.sizeScale, ec.maxW);
        if (pb.layout.overflowsWidth || eb.layout.overflowsWidth) continue;
        const pTop = nearestTop(pb.height, anchorTop(design.primary.anchor, pb.height), (t) => calm(pb, t, pc.x, pAlign));
        if (pTop === null) continue;
        const pr = rectOf(pb, pTop, pc.x, pAlign);
        const eTop = nearestTop(eb.height, anchorTop(design.english.anchor, eb.height), (t) => {
          const er = rectOf(eb, t, ec.x, eAlign);
          const sharesColumn = er.x0 < pr.x1 && pr.x0 < er.x1;
          // In a shared column the primary language must read first and the blocks can't touch.
          if (sharesColumn && t < pr.y1 + SPLIT_GAP_D) return false;
          return calm(eb, t, ec.x, eAlign);
        });
        if (eTop === null) continue;
        designArrangement = 'split';
        designPlaced = [
          { block: pb, top: pTop, x: pc.x, align: pAlign, theme: themeFor(pb, pTop, pc.x, pAlign) },
          { block: eb, top: eTop, x: ec.x, align: eAlign, theme: themeFor(eb, eTop, ec.x, eAlign) },
        ];
      }
    }
    // Stacked - the design's own arrangement, or the fallback for a split design whose second
    // clear area doesn't exist on this photo: same typography and alignment, both languages
    // stacked in the one clear area, rather than discarding the design for the automatic layout.
    if (!designPlaced) {
      const align = design.primary.align;
      const col = colFor(align);
      for (let s = 1; s >= 0.6 && !designPlaced; s *= 0.92) {
        const pb = buildPrimaryBlock(s * design.primary.sizeScale, col.maxW);
        const eb = hasSecondaryEnglish ? buildEnglishBlock(s * design.english.sizeScale, col.maxW) : null;
        if (pb.layout.overflowsWidth || eb?.layout.overflowsWidth) continue;
        const gapD = 50 * s;
        const groupH = pb.height + (eb ? gapD + eb.height : 0);
        if (groupH > availBottom - availTop) continue;
        const top = nearestTop(groupH, anchorTop(design.primary.anchor, groupH),
          (t) => calm(pb, t, col.x, align) && (!eb || calm(eb, t + pb.height + gapD, col.x, align)));
        if (top === null) continue;
        const groupTheme = themeFor({ ...pb, height: groupH, width: Math.max(pb.width, eb?.width ?? 0) }, top, col.x, align);
        designDividerGap = gapD;
        designPlaced = [{ block: pb, top, x: col.x, align, theme: groupTheme }];
        if (eb) designPlaced.push({ block: eb, top: top + pb.height + gapD, x: col.x, align, theme: groupTheme });
      }
    }
    if (designPlaced) {
      placed = designPlaced;
      arrangement = designArrangement;
      paintDividerGap = designDividerGap;
    } else {
      console.info(`[poster] design "${design.name}" could not be placed on calm background; using the automatic layout`);
    }
  }

  // Light-on-dark scrim behind each dark-themed block (stacked: one scrim over the whole band).
  // Scrim strength follows the brightness behind the text: light text always, so a bright band needs
  // more darkening (up to ~1.75x) to stay crisp.
  const bandLum = (top: number, bottom: number) => (detailGrid ? regionStats(detailGrid, width, height, width * 0.12, top, width * 0.88, bottom).lum : 90);
  const paintDarkScrim = (top: number, bottom: number) => {
    const k = Math.min(1.75, Math.max(1, 1 + ((bandLum(top, bottom) - 100) / 155) * 0.75));
    const scrimTop = top - 40, scrimBottom = bottom + 40, feather = 70;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, 'rgba(18,12,8,0)'); // warm near-black, see renderVersePoster
    scrimGrad.addColorStop(0.2, `rgba(18,12,8,${0.28 * k})`);
    scrimGrad.addColorStop(0.5, `rgba(18,12,8,${0.36 * k})`);
    scrimGrad.addColorStop(0.8, `rgba(18,12,8,${0.28 * k})`);
    scrimGrad.addColorStop(1, 'rgba(18,12,8,0)');
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  };
  // Dark text on a bright photo gets the same treatment in reverse: a soft light haze across the
  // text band, so it reads cleanly over fabric/foliage texture instead of sitting straight on it.
  const paintLightScrim = (top: number, bottom: number) => {
    const scrimTop = top - 40, scrimBottom = bottom + 40, feather = 70;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, 'rgba(252,249,243,0)');
    scrimGrad.addColorStop(0.2, 'rgba(252,249,243,0.32)');
    scrimGrad.addColorStop(0.5, 'rgba(252,249,243,0.42)');
    scrimGrad.addColorStop(0.8, 'rgba(252,249,243,0.32)');
    scrimGrad.addColorStop(1, 'rgba(252,249,243,0)');
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  };
  const paintScrim = (light: boolean, top: number, bottom: number) => (light ? paintLightScrim : paintDarkScrim)(top, bottom);
  if (arrangement === 'stacked') {
    const last = placed[placed.length - 1];
    paintScrim(placed[0].theme.isLight, placed[0].top, last.top + last.block.height);
  } else {
    for (const pl of placed) paintScrim(pl.theme.isLight, pl.top, pl.top + pl.block.height);
  }

  // Per-block legibility check (see regionStats): each block measures the background directly
  // behind itself and gets a soft haze if that patch doesn't suit its theme.
  if (detailGrid) {
    for (const pl of placed) {
      const r = rectOf(pl.block, pl.top, pl.x, pl.align);
      if (blockNeedsPlate(pl.theme, regionStats(detailGrid, width, height, r.x0, r.y0, r.x1, r.y1))) {
        paintLegibilityPlate(ctx, pl.theme, r.x0, r.y0, r.x1, r.y1);
      }
    }
  }

  const paintBlock = (pl: Placed, isPrimary: boolean) => {
    const { block, align, theme: t } = pl;
    let y = paintClauseBlock(ctx, block.layout, pl.top, pl.x, t, align);
    y += block.refGap;
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = block.refFont;
    ctx.fillStyle = isPrimary ? t.accentColor : (t.isLight ? 'rgba(36,26,16,0.75)' : 'rgba(255,255,255,0.8)');
    ctx.shadowColor = t.shadowColor;
    ctx.shadowBlur = isPrimary ? t.shadowBlur + 6 : t.shadowBlur;
    ctx.shadowOffsetY = t.isLight ? 0 : isPrimary ? 3 : 2;
    block.refLines.forEach((line) => {
      y += block.refLH / 2;
      drawReferenceLine(ctx, line, pl.x, y, align, isPrimary ? verse.primaryLang : 'en');
      y += block.refLH / 2;
    });
    ctx.restore();
  };

  paintBlock(placed[0], true);
  if (placed[1]) {
    const en = placed[1];
    const dividerStyle = design?.divider ?? 'flourish';
    const dividerY = arrangement === 'stacked' ? en.top - paintDividerGap / 2 : en.top - 28;
    if (dividerStyle === 'flourish' && en.align === 'center') {
      const half = arrangement === 'stacked' ? Math.min(MAX_W * 0.2, 150 * scale) : Math.min(MAX_W * 0.15, 110);
      drawFlourish(ctx, en.x, dividerY, half, en.theme.accentColor);
    } else if (dividerStyle !== 'none') {
      // A simple accent rule - centred, or at the aligned edge of a left/right-aligned block.
      ctx.save();
      ctx.strokeStyle = en.theme.accentColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const len = en.align === 'center' ? 140 : 90;
      const x0 = en.align === 'center' ? en.x - len / 2 : en.align === 'left' ? en.x : en.x - len;
      ctx.moveTo(x0, dividerY);
      ctx.lineTo(x0 + len, dividerY);
      ctx.stroke();
      ctx.restore();
    }
    paintBlock(en, false);
  }

  // Branded footer: one consistent treatment on every poster - a dark strip fading up from the bottom
  // edge with the ministry name in white beside the Instagram mark, matching the video frames. (The
  // colour used to follow whatever was behind it, and light-grey text on a bright photo vanished.)
  const footerGrad = ctx.createLinearGradient(0, height - FOOTER_H - 50, 0, height);
  footerGrad.addColorStop(0, 'rgba(8,7,6,0)');
  footerGrad.addColorStop(0.45, 'rgba(8,7,6,0.62)');
  footerGrad.addColorStop(1, 'rgba(8,7,6,0.9)');
  ctx.fillStyle = footerGrad;
  ctx.fillRect(0, height - FOOTER_H - 50, width, FOOTER_H + 50);
  const footerY = height - FOOTER_H / 2 - 4;
  ctx.save();
  ctx.font = '700 20px Lato, Montserrat';
  const igSize = 30, igGap = 12;
  const nameW = ctx.measureText(MINISTRY_NAME).width + 3 * (MINISTRY_NAME.length - 1);
  const groupLeft = width / 2 - (igSize + igGap + nameW) / 2;
  drawInstagramIcon(ctx, groupLeft + igSize / 2, footerY, igSize);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 10;
  fillTextLetterSpaced(ctx, MINISTRY_NAME, groupLeft + igSize + igGap + nameW / 2, footerY, 3);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

// Option C - subject centered, text flanking it on BOTH sides at once: primary language (Tamil/
// Telugu) in the left column, English in the right column, rendered independently. Two separate
// buildClauseBlock/paintClauseBlock calls and two separate column searches (reusing
// computeCenterStripRowScores/findEmptiestBand twice), rather than one block choosing a side - this
// is a real architectural difference from renderEditorialPoster/renderCornerPoster, confirmed with
// the user directly (a true simultaneous split, not a single block picking whichever side is
// clearer). A single SHARED scale (the more-constrained of the two columns' own required scale)
// keeps both columns' font sizes visually consistent even when one language needs more room than
// the other. Theme (light/dark text) is derived once from the AVERAGE luminance of both found
// bands, applied to both columns, so the two sides never clash stylistically.
export async function renderCenteredPoster(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  verse: PosterVerseInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = EDITORIAL_W;
  canvas.height = EDITORIAL_H;
  const ctx = canvas.getContext('2d')!;
  const width = EDITORIAL_W, height = EDITORIAL_H;

  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.08) saturate(1.15)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  if (logoImg) {
    ctx.save();
    const logoSize = 100, margin = 60;
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  // Two independent flanking columns, ~32% of width each, with a ~6% outer margin and the middle
  // ~30% left as the subject zone (matching CENTERED_PLACEMENT_CLAUSE's composition contract).
  const OUTER_MARGIN = width * 0.06;
  const COLUMN_W = width * 0.32;
  const LEFT_X = OUTER_MARGIN;
  const RIGHT_X = width - OUTER_MARGIN - COLUMN_W;
  const LEFT_CENTER_X = LEFT_X + COLUMN_W / 2;
  const RIGHT_CENTER_X = RIGHT_X + COLUMN_W / 2;
  const MAX_W = COLUMN_W - 16;
  const FOOTER_H = 70;
  const TOP_MARGIN = height * 0.12;
  const BOTTOM_MARGIN = FOOTER_H + 30;
  const MAX_CONTENT_H = height - TOP_MARGIN - BOTTOM_MARGIN;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = verse.fontStyle && FONT_STYLE_PRESETS[verse.fontStyle] ? verse.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  const accentColorHex = verse.accentColor || PALETTE.GOLD;
  const primaryFontFamily = primaryFontFamilyFor(verse.primaryLang, fontStyle);
  const englishFontFamily = preset.englishFontFamily;
  const englishStyle = preset.englishItalic ? 'italic ' : '';
  const hasSecondaryEnglish = typeof verse.englishText === 'string' && typeof verse.englishRef === 'string';
  const primaryIsEnglish = verse.primaryLang === 'en';
  const primaryStylePrefix = primaryIsEnglish ? englishStyle : '';
  const primaryBaseWeight = primaryIsEnglish ? preset.englishWeight : 700;
  const primaryHeroWeight = primaryIsEnglish ? preset.englishWeight : 900;
  const englishHeroFontFamily = '"Great Vibes", "Dancing Script", ' + englishFontFamily;

  let scale = 1.0;
  const MIN_TEXT_SCALE = 0.5;
  let primaryRefLines: string[] = [];
  let primaryRefFont = '', primaryRefLH = 0;
  let primaryLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let primaryGap = 0;
  let primaryTotalH = 0;
  let englishRefLines: string[] = [];
  let englishRefFont = '', englishRefLH = 0;
  let englishLayout: ClauseBlockLayout = { lines: [], totalHeight: 0, overflowsWidth: false };
  let englishGap = 0;
  let englishTotalH = 0;

  for (let attempt = 0; attempt < 40; attempt++) {
    const primaryBaseSize = 30 * scale;
    const heroScale = 1.9;
    const primaryRefSize = 24 * scale;
    const englishBaseSize = 26 * scale;
    const englishHeroScale = 1.55;
    const englishRefSize = 20 * scale;
    primaryGap = 20 * scale;
    englishGap = 20 * scale;

    primaryLayout = buildClauseBlock(ctx, verse.primaryText, {
      baseFont: `${primaryStylePrefix}${primaryBaseWeight} ${primaryBaseSize}px ${primaryFontFamily}`,
      heroFont: `${primaryStylePrefix}${primaryHeroWeight} ${primaryBaseSize * heroScale}px ${primaryFontFamily}`,
      baseLH: primaryBaseSize * 1.4,
      heroLH: primaryBaseSize * heroScale * 1.28,
      clauseGap: 8 * scale,
      maxWidth: MAX_W,
      quoted: false,
      enableHero: true,
      heroMode: 'firstWord',
    });
    primaryRefFont = `700 ${primaryRefSize}px "Great Vibes", "Dancing Script", Montserrat`;
    primaryRefLH = primaryRefSize * 1.4;
    primaryRefLines = wrapText(ctx, verse.primaryRef, primaryRefFont, MAX_W - 10);
    primaryTotalH = primaryLayout.totalHeight + primaryGap + primaryRefLines.length * primaryRefLH;

    let overflowsWidth = primaryLayout.overflowsWidth;

    if (hasSecondaryEnglish) {
      const englishBaseWeight = primaryIsEnglish ? preset.englishWeight : 500;
      englishLayout = buildClauseBlock(ctx, verse.englishText!, {
        baseFont: `${englishStyle}${englishBaseWeight} ${englishBaseSize}px ${englishFontFamily}`,
        heroFont: `700 ${englishBaseSize * englishHeroScale}px ${englishHeroFontFamily}`,
        baseLH: englishBaseSize * 1.42,
        heroLH: englishBaseSize * englishHeroScale * 1.22,
        clauseGap: 7 * scale,
        maxWidth: MAX_W,
        quoted: false,
        enableHero: true,
        heroMode: 'firstWord',
      });
      englishRefFont = `400 ${englishRefSize}px "Great Vibes", "Dancing Script", Montserrat`;
      englishRefLH = englishRefSize * 1.5;
      englishRefLines = wrapText(ctx, verse.englishRef!, englishRefFont, MAX_W - 10);
      englishTotalH = englishLayout.totalHeight + englishGap + englishRefLines.length * englishRefLH;
      overflowsWidth = overflowsWidth || englishLayout.overflowsWidth;
    } else {
      englishTotalH = 0;
    }

    // Both columns must fit independently at this scale, not combined - they're side by side, not
    // stacked, so each only needs to fit MAX_CONTENT_H on its own.
    if (primaryTotalH <= MAX_CONTENT_H && englishTotalH <= MAX_CONTENT_H && !overflowsWidth) break;
    if (scale <= MIN_TEXT_SCALE) break;
    scale = Math.max(MIN_TEXT_SCALE, scale * 0.9);
  }

  // Two independent column searches - same computeCenterStripRowScores/findEmptiestBand primitives
  // as the other two Poster styles, just called twice with different x-ranges instead of once.
  function findColumnBand(colStartX: number, neededHeight: number): { curY: number; bestStartRow: number; bandRows: number } {
    if (!detailGrid) {
      return { curY: TOP_MARGIN + (MAX_CONTENT_H - neededHeight) / 2, bestStartRow: 0, bandRows: DETAIL_GRID_ROWS };
    }
    const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
    const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
    const neededRows = Math.ceil((neededHeight / height) * DETAIL_GRID_ROWS * 1.18);
    const stripColStart = Math.floor((colStartX / width) * DETAIL_GRID_COLS);
    const stripColEnd = Math.ceil(((colStartX + COLUMN_W) / width) * DETAIL_GRID_COLS);
    const rowScores = computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd);
    const bestStartRow = findEmptiestBand(rowScores, neededRows, minRow, maxRowExclusive);
    const bandRows = Math.min(neededRows, maxRowExclusive - minRow);
    const rowPx = height / DETAIL_GRID_ROWS;
    const bandTopY = bestStartRow * rowPx;
    const bandHeightPx = bandRows * rowPx;
    const curY = Math.max(TOP_MARGIN, Math.min(
      bandTopY + Math.max(0, (bandHeightPx - neededHeight) / 2),
      height - BOTTOM_MARGIN - neededHeight
    ));
    return { curY, bestStartRow, bandRows };
  }

  const leftBand = findColumnBand(LEFT_X, primaryTotalH);
  const rightBand = hasSecondaryEnglish ? findColumnBand(RIGHT_X, englishTotalH) : null;

  // One shared theme for both columns (average of both bands' luminance) so the two sides never
  // pick different light/dark treatments and clash on the same poster.
  const leftLum = detailGrid ? averageLuminanceInBand(detailGrid, leftBand.bestStartRow, leftBand.bandRows) : 90;
  const rightLum = rightBand && detailGrid ? averageLuminanceInBand(detailGrid, rightBand.bestStartRow, rightBand.bandRows) : leftLum;
  const bandLuminance = (leftLum + rightLum) / 2;
  const theme = pickTheme(bandLuminance, accentColorHex);
  const isLight = theme.isLight;

  if (!isLight) {
    const drawScrim = (curY: number, totalH: number) => {
      const scrimTop = curY - 36;
      const scrimBottom = curY + totalH + 36;
      const feather = 60;
      const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
      scrimGrad.addColorStop(0, 'rgba(0,0,0,0)');
      scrimGrad.addColorStop(0.2, 'rgba(0,0,0,0.26)');
      scrimGrad.addColorStop(0.5, 'rgba(0,0,0,0.34)');
      scrimGrad.addColorStop(0.8, 'rgba(0,0,0,0.26)');
      scrimGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = scrimGrad;
      ctx.fillRect(LEFT_X - 20, scrimTop - feather, COLUMN_W + 40, (scrimBottom + feather) - (scrimTop - feather));
    };
    drawScrim(leftBand.curY, primaryTotalH);
    if (rightBand) drawScrim(rightBand.curY, englishTotalH);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // LEFT column: primary language (Tamil/Telugu), matching the other two Poster styles' existing
  // "primary leads" convention, applied spatially here instead of only vertically.
  let leftY = paintClauseBlock(ctx, primaryLayout, leftBand.curY, LEFT_CENTER_X, theme);
  leftY += primaryGap;
  ctx.save();
  ctx.font = primaryRefFont;
  ctx.fillStyle = theme.accentColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur + 6;
  ctx.shadowOffsetY = isLight ? 0 : 3;
  primaryRefLines.forEach((line) => {
    leftY += primaryRefLH / 2;
    ctx.fillText(line, LEFT_CENTER_X, leftY);
    leftY += primaryRefLH / 2;
  });
  ctx.restore();

  // RIGHT column: English.
  if (hasSecondaryEnglish && rightBand) {
    let rightY = paintClauseBlock(ctx, englishLayout, rightBand.curY, RIGHT_CENTER_X, theme);
    rightY += englishGap;
    ctx.save();
    ctx.font = englishRefFont;
    ctx.fillStyle = isLight ? 'rgba(36,26,16,0.75)' : 'rgba(255,255,255,0.8)';
    ctx.shadowColor = theme.shadowColor;
    ctx.shadowBlur = theme.shadowBlur;
    ctx.shadowOffsetY = isLight ? 0 : 2;
    englishRefLines.forEach((line) => {
      rightY += englishRefLH / 2;
      ctx.fillText(line, RIGHT_CENTER_X, rightY);
      rightY += englishRefLH / 2;
    });
    ctx.restore();
  }

  const footerY = height - FOOTER_H / 2 - 6;
  ctx.save();
  ctx.font = '700 18px Lato, Montserrat';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLight ? 'rgba(36,26,16,0.68)' : 'rgba(255,255,255,0.82)';
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = 8;
  fillTextLetterSpaced(ctx, MINISTRY_NAME, width / 2, footerY, 3);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

export interface HookCardInput {
  hookText: string;
  reference: string;
  fontStyle?: FontStyleKey;
  accentColor?: string;
}

// The Verse Video's opening card (0-4s per spec: hook line, then reference) - a much simpler layout
// than renderVersePoster's clause-block verse text, since there's no Scripture here at all, just the
// AI-generated viewer hook (see VerseAnalysis.emotionalHook - never presented as or mixed with
// Scripture) and the reference. Reuses the same background treatment, smart text-placement search
// (computeCenterStripRowScores/findEmptiestBand - the fix for text landing on a busy subject applies
// here too), and theme-picking as the main poster, so the two cards read as one visual system.
export async function renderHookCard(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  input: HookCardInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT_W;
  canvas.height = PORTRAIT_H;
  const ctx = canvas.getContext('2d')!;
  const width = PORTRAIT_W, height = PORTRAIT_H;

  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.16) saturate(1.3) brightness(0.9)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  if (logoImg) {
    ctx.save();
    const logoSize = 100, margin = 60;
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  const SIDE_MARGIN = width * 0.11;
  const MAX_W = width - SIDE_MARGIN * 2;
  const FOOTER_H = 116;
  const TOP_MARGIN = height * 0.145;
  const BOTTOM_MARGIN = FOOTER_H + 40;
  const CENTER_X = width / 2;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = input.fontStyle && FONT_STYLE_PRESETS[input.fontStyle] ? input.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  const accentColorHex = input.accentColor || PALETTE.GOLD;
  // The hook is always spoken/on-screen narration copy (never Scripture), so it always uses the
  // preset's English/Latin display family regardless of the verse's own primary language - unlike
  // verse text, it isn't tied to a specific script's typeface pairing.
  const hookFontFamily = preset.englishFontFamily;
  const hookItalic = preset.englishItalic ? 'italic ' : '';
  const refFontFamily = 'Montserrat';

  let scale = 1.0;
  const MIN_SCALE = 0.5;
  let hookLines: string[] = [];
  let hookFont = '', hookLH = 0;
  let refLines: string[] = [];
  let refFont = '', refLH = 0;
  let totalH = 0;
  let gap = 0;

  // Deliberately capped at 70% of the safe content height (vs. the full area a long verse block
  // may need) - a hook card is meant to read as a punchy, compact title card, not a dense block.
  const maxContentH = (height - TOP_MARGIN - BOTTOM_MARGIN) * 0.7;

  for (let attempt = 0; attempt < 30; attempt++) {
    const hookSize = 72 * scale;
    const refSize = 34 * scale;
    gap = 36 * scale;
    hookFont = `${hookItalic}800 ${hookSize}px ${hookFontFamily}`;
    hookLH = hookSize * 1.3;
    hookLines = wrapText(ctx, input.hookText, hookFont, MAX_W - 40);

    refFont = `900 ${refSize}px ${refFontFamily}`;
    refLH = refSize * 1.35;
    refLines = wrapText(ctx, `— ${input.reference} —`, refFont, MAX_W - 40);

    totalH = hookLines.length * hookLH + gap + refLines.length * refLH;
    if (totalH <= maxContentH) break;
    if (scale <= MIN_SCALE) break;
    scale = Math.max(MIN_SCALE, scale * 0.9);
  }

  // Placement: same smart search as renderVersePoster - avoids landing on a busy/centered subject
  // rather than just averaging busyness over the full row width.
  let curY: number;
  let alignX = CENTER_X;
  let bandLuminanceRow = 0, bandLuminanceRows = DETAIL_GRID_ROWS;
  if (detailGrid) {
    const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
    const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
    const neededRows = Math.ceil((totalH / height) * DETAIL_GRID_ROWS * 1.3);
    const stripColStart = Math.floor(((CENTER_X - MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const stripColEnd = Math.ceil(((CENTER_X + MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const centerStripRowScores = computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd);
    const bestStartRow = findEmptiestBand(centerStripRowScores, neededRows, minRow, maxRowExclusive);
    const bandRows = Math.min(neededRows, maxRowExclusive - minRow);
    const rowPx = height / DETAIL_GRID_ROWS;
    curY = bestStartRow * rowPx + Math.max(0, (bandRows * rowPx - totalH) / 2);
    const bias = horizontalBiasWithinBand(detailGrid, bestStartRow, bandRows);
    alignX = CENTER_X + bias * (SIDE_MARGIN + MAX_W / 2);
    bandLuminanceRow = bestStartRow;
    bandLuminanceRows = bandRows;
  } else {
    curY = TOP_MARGIN + ((height - TOP_MARGIN - BOTTOM_MARGIN) - totalH) / 2;
  }
  curY = Math.max(TOP_MARGIN, Math.min(curY, height - BOTTOM_MARGIN - totalH));

  const bandLuminance = detailGrid ? averageLuminanceInBand(detailGrid, bandLuminanceRow, bandLuminanceRows) : 90;
  const theme = pickTheme(bandLuminance, accentColorHex);
  const isLight = theme.isLight;

  const vign = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.85);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(0.55, isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.14)');
  vign.addColorStop(1, isLight ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, width, height);

  const legibilityGrad = ctx.createLinearGradient(0, 0, 0, height);
  legibilityGrad.addColorStop(0, isLight ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.08)');
  legibilityGrad.addColorStop(0.35, isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.2)');
  legibilityGrad.addColorStop(0.75, isLight ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.42)');
  legibilityGrad.addColorStop(1, isLight ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.72)');
  ctx.fillStyle = legibilityGrad;
  ctx.fillRect(0, 0, width, height);

  if (!isLight) {
    const scrimTop = curY - 50;
    const scrimBottom = curY + totalH + 50;
    const feather = 90;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, 'rgba(0,0,0,0)');
    scrimGrad.addColorStop(0.18, 'rgba(0,0,0,0.38)');
    scrimGrad.addColorStop(0.5, 'rgba(0,0,0,0.46)');
    scrimGrad.addColorStop(0.82, 'rgba(0,0,0,0.38)');
    scrimGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  }

  // Hook text - the visually dominant element on this card, in the theme's hero color/glow
  // (matching the poster's own hero-clause treatment) for the same "this is the emphasized phrase"
  // visual language across both cards.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.font = hookFont;
  ctx.fillStyle = theme.heroColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur * 1.8;
  ctx.shadowOffsetY = isLight ? 1 : 5;
  hookLines.forEach((line) => {
    curY += hookLH / 2;
    ctx.fillText(line, alignX, curY);
    curY += hookLH / 2;
  });
  ctx.restore();
  curY += gap;

  ctx.save();
  ctx.font = refFont;
  ctx.fillStyle = theme.accentColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur + 4;
  ctx.shadowOffsetY = isLight ? 0 : 3;
  refLines.forEach((line) => {
    curY += refLH / 2;
    ctx.fillText(line, alignX, curY);
    curY += refLH / 2;
  });
  ctx.restore();

  const footerBarGrad = ctx.createLinearGradient(0, height - FOOTER_H, 0, height);
  footerBarGrad.addColorStop(0, 'rgba(8,7,6,0)');
  footerBarGrad.addColorStop(0.4, 'rgba(8,7,6,0.78)');
  footerBarGrad.addColorStop(1, 'rgba(8,7,6,0.96)');
  ctx.fillStyle = footerBarGrad;
  ctx.fillRect(0, height - FOOTER_H, width, FOOTER_H);

  const footerY = height - FOOTER_H + 58;
  const igSize = 40;
  const igGap = 16;
  const ministryText = MINISTRY_NAME;
  ctx.save();
  ctx.font = '700 22px Lato, Montserrat';
  const ministryTextWidth = ctx.measureText(ministryText).width;
  const totalGroupW = igSize + igGap + ministryTextWidth;
  const groupLeft = (width - totalGroupW) / 2;
  drawInstagramIcon(ctx, groupLeft + igSize / 2, footerY, igSize);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 1;
  fillTextLetterSpaced(ctx, ministryText, groupLeft + igSize + igGap + ministryTextWidth / 2, footerY, 4);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

export const THUMBNAIL_W = 1280;
export const THUMBNAIL_H = 720;

export interface ThumbnailInput {
  thumbnailText: string;
  fontStyle?: FontStyleKey;
  accentColor?: string;
}

// YouTube thumbnail (16:9) - replaces the old server-side FFmpeg drawtext endpoint
// (/api/thumbnail/generate in server.ts, removed), which could only draw plain fixed-position text
// and had no way to detect where the background was actually busy. This reuses the same
// canvas-based background treatment and smart placement search (computeCenterStripRowScores/
// findEmptiestBand - all the row/col<->pixel math is ratio-based, so it generalizes correctly from
// the poster's 9:16 to this 16:9 canvas without change) as the poster and hook card, so all three
// keep reading as one visual system. Deliberately uncluttered - just the short thumbnailText (never
// the full verse - see ai/youtubeMetadata.ts's prompt) and a small logo badge, no footer bar, since
// a thumbnail has to read at a fraction of its real size on a mobile device.
export async function renderThumbnail(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  input: ThumbnailInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_W;
  canvas.height = THUMBNAIL_H;
  const ctx = canvas.getContext('2d')!;
  const width = THUMBNAIL_W, height = THUMBNAIL_H;

  if (bgImg) {
    const ratio = Math.max(width / bgImg.width, height / bgImg.height);
    const bgW = bgImg.width * ratio;
    const bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = 'contrast(1.2) saturate(1.35) brightness(0.88)';
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
  }

  if (logoImg) {
    ctx.save();
    const logoSize = 72, margin = 36;
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2 + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(margin + logoSize / 2, margin + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, margin, margin, logoSize, logoSize);
    ctx.restore();
  }

  const SIDE_MARGIN = width * 0.08;
  const MAX_W = width - SIDE_MARGIN * 2;
  const TOP_MARGIN = height * 0.12;
  const BOTTOM_MARGIN = height * 0.1;
  const CENTER_X = width / 2;

  const detailGrid = bgImg ? computeDetailGrid(bgImg, width, height) : null;

  const fontStyle = input.fontStyle && FONT_STYLE_PRESETS[input.fontStyle] ? input.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  const accentColorHex = input.accentColor || PALETTE.GOLD;

  let scale = 1.0;
  const MIN_SCALE = 0.5;
  let textLines: string[] = [];
  let textFont = '', textLH = 0;
  let totalH = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    const textSize = 92 * scale;
    textFont = `900 ${textSize}px ${preset.englishFontFamily.includes('Cinzel') || preset.englishFontFamily.includes('Playfair') ? 'Montserrat' : preset.englishFontFamily}`;
    textLH = textSize * 1.15;
    textLines = wrapText(ctx, input.thumbnailText.toUpperCase(), textFont, MAX_W - 40);
    totalH = textLines.length * textLH;
    if (totalH <= (height - TOP_MARGIN - BOTTOM_MARGIN)) break;
    if (scale <= MIN_SCALE) break;
    scale = Math.max(MIN_SCALE, scale * 0.9);
  }

  let curY: number;
  let alignX = CENTER_X;
  let bandLuminanceRow = 0, bandLuminanceRows = DETAIL_GRID_ROWS;
  if (detailGrid) {
    const minRow = Math.floor((TOP_MARGIN / height) * DETAIL_GRID_ROWS);
    const maxRowExclusive = Math.ceil(((height - BOTTOM_MARGIN) / height) * DETAIL_GRID_ROWS);
    const neededRows = Math.ceil((totalH / height) * DETAIL_GRID_ROWS * 1.3);
    const stripColStart = Math.floor(((CENTER_X - MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const stripColEnd = Math.ceil(((CENTER_X + MAX_W / 2) / width) * DETAIL_GRID_COLS);
    const centerStripRowScores = computeCenterStripRowScores(detailGrid, stripColStart, stripColEnd);
    const bestStartRow = findEmptiestBand(centerStripRowScores, neededRows, minRow, maxRowExclusive);
    const bandRows = Math.min(neededRows, maxRowExclusive - minRow);
    const rowPx = height / DETAIL_GRID_ROWS;
    curY = bestStartRow * rowPx + Math.max(0, (bandRows * rowPx - totalH) / 2);
    const bias = horizontalBiasWithinBand(detailGrid, bestStartRow, bandRows);
    alignX = CENTER_X + bias * (SIDE_MARGIN + MAX_W / 2);
    bandLuminanceRow = bestStartRow;
    bandLuminanceRows = bandRows;
  } else {
    curY = TOP_MARGIN + ((height - TOP_MARGIN - BOTTOM_MARGIN) - totalH) / 2;
  }
  curY = Math.max(TOP_MARGIN, Math.min(curY, height - BOTTOM_MARGIN - totalH));

  const bandLuminance = detailGrid ? averageLuminanceInBand(detailGrid, bandLuminanceRow, bandLuminanceRows) : 90;
  const theme = pickTheme(bandLuminance, accentColorHex);
  const isLight = theme.isLight;

  // Stronger vignette/legibility treatment than the poster - a thumbnail is judged at a fraction of
  // its real size, so text contrast needs a wider margin for safety.
  const legibilityGrad = ctx.createLinearGradient(0, 0, 0, height);
  legibilityGrad.addColorStop(0, isLight ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.15)');
  legibilityGrad.addColorStop(0.5, isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.28)');
  legibilityGrad.addColorStop(1, isLight ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.4)');
  ctx.fillStyle = legibilityGrad;
  ctx.fillRect(0, 0, width, height);

  if (!isLight) {
    const scrimTop = curY - 40;
    const scrimBottom = curY + totalH + 40;
    const feather = 70;
    const scrimGrad = ctx.createLinearGradient(0, scrimTop - feather, 0, scrimBottom + feather);
    scrimGrad.addColorStop(0, 'rgba(0,0,0,0)');
    scrimGrad.addColorStop(0.2, 'rgba(0,0,0,0.42)');
    scrimGrad.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    scrimGrad.addColorStop(0.8, 'rgba(0,0,0,0.42)');
    scrimGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scrimGrad;
    ctx.fillRect(0, scrimTop - feather, width, (scrimBottom + feather) - (scrimTop - feather));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.font = textFont;
  ctx.fillStyle = theme.heroColor;
  ctx.shadowColor = theme.shadowColor;
  ctx.shadowBlur = theme.shadowBlur * 2;
  ctx.shadowOffsetY = isLight ? 1 : 5;
  // A thin dark outline keeps the hero-colored text legible over bright/busy patches even a strong
  // shadow alone wouldn't fully cover, at thumbnail scale.
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  textLines.forEach((line) => {
    curY += textLH / 2;
    ctx.strokeText(line, alignX, curY);
    ctx.fillText(line, alignX, curY);
    curY += textLH / 2;
  });
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', 0.92);
  });
}

// The background is generated smaller (720x1280, same 9:16 ratio) for speed and cover-fit-scaled
// up automatically inside renderVersePoster - no change needed there. This is only for the saved
// background.png artifact itself, which should stay at the canonical 1080x1920 poster resolution.
// A straight stretch (not cover-fit) is correct here since the source is already the exact same
// aspect ratio, so nothing is cropped.
// --- Meditation Video frame (1920x1080 landscape) ---
// The Meditation Video is landscape (YouTube treats short vertical videos as Shorts), but the verse
// poster is portrait. Fitting that poster into the wide frame left two near-black bars full of
// blurred smears of the poster's own text. This instead composes a real landscape frame: the clean
// background photo (no text) full-bleed and softly blurred, a title block on the left, and the
// verse poster as a framed card on the right.
export const MEDITATION_W = 1920;
export const MEDITATION_H = 1080;

const MEDITATION_TITLE: Record<'en' | 'ta' | 'te', string> = {
  en: 'Daily Meditation',
  ta: 'இன்றைய தியானம்',
  te: 'నేటి ధ్యానం',
};
const MEDITATION_SUBTITLE: Record<'en' | 'ta' | 'te', string> = {
  en: 'Verse  ·  Reflection  ·  Prayer',
  ta: 'வசனம்  ·  தியானம்  ·  ஜெபம்',
  te: 'వచనం  ·  ధ్యానం  ·  ప్రార్థన',
};

export interface MeditationFrameInput {
  lang: 'en' | 'ta' | 'te';
  reference: string; // in this language, e.g. "சங்கீதம் 23:1"
  fontStyle?: FontStyleKey;
  accentColor?: string;
  // The verse's poster design - its fonts and accent win over the theme preset (one look per verse).
  design?: PosterDesign;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Largest font size (stepping down from maxPx) at which `text` fits on one line within maxWidth.
function fitFontSize(ctx: CanvasRenderingContext2D, text: string, fontFor: (px: number) => string, maxPx: number, minPx: number, maxWidth: number): number {
  for (let px = maxPx; px > minPx; px -= 2) {
    ctx.font = fontFor(px);
    if (ctx.measureText(text).width <= maxWidth) return px;
  }
  return minPx;
}

// Where renderMeditationFrame places the poster card, in frame pixels - also used to map the
// poster's word boxes onto the frame for the reading highlighter.
export function meditationCardRect(posterW: number, posterH: number): { x: number; y: number; w: number; h: number } {
  const h = Math.round(MEDITATION_H * 0.86);
  const w = Math.round(h * (posterW / posterH));
  return { x: Math.round(MEDITATION_W * 0.93 - w), y: Math.round((MEDITATION_H - h) / 2), w, h };
}

export async function renderMeditationFrame(
  bgImg: HTMLImageElement | null,
  logoImg: HTMLImageElement | null,
  posterImg: HTMLImageElement,
  input: MeditationFrameInput
): Promise<Blob> {
  await ensurePosterFontsPreloaded();
  await document.fonts.ready;

  const width = MEDITATION_W, height = MEDITATION_H;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Backdrop: the clean background photo, cover-fit, blurred and dimmed so the card and title read
  // clearly. Overscan by the blur radius so the blur doesn't pull in transparent edges.
  ctx.fillStyle = '#0b0a09';
  ctx.fillRect(0, 0, width, height);
  if (bgImg) {
    const blur = 26;
    const ratio = Math.max((width + blur * 4) / bgImg.width, (height + blur * 4) / bgImg.height);
    const bgW = bgImg.width * ratio, bgH = bgImg.height * ratio;
    ctx.save();
    ctx.filter = `blur(${blur}px) brightness(0.62) saturate(1.15)`;
    ctx.drawImage(bgImg, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
    ctx.restore();
  }
  // Left-to-right shade behind the title block, plus a soft vignette.
  const shade = ctx.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, 'rgba(6,5,4,0.72)');
  shade.addColorStop(0.55, 'rgba(6,5,4,0.35)');
  shade.addColorStop(1, 'rgba(6,5,4,0.15)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, width * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // Poster card, right side: full poster at 9:16, rounded, with a deep shadow and a hairline border.
  const { x: cardX, y: cardY, w: cardW, h: cardH } = meditationCardRect(posterImg.width, posterImg.height);
  const radius = 26;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 24;
  roundedRectPath(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRectPath(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.clip();
  ctx.drawImage(posterImg, cardX, cardY, cardW, cardH);
  ctx.restore();
  ctx.save();
  roundedRectPath(ctx, cardX + 0.75, cardY + 0.75, cardW - 1.5, cardH - 1.5, radius);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Title block, left side, centered in the space left of the card.
  const fontStyle = input.fontStyle && FONT_STYLE_PRESETS[input.fontStyle] ? input.fontStyle : DEFAULT_FONT_STYLE;
  const preset = FONT_STYLE_PRESETS[fontStyle];
  const design = input.design;
  const designEnglish = design ? DESIGN_ENGLISH_FONTS[design.englishFont] : null;
  // The same colour pair as the posters (see DUOTONES), dark-background version.
  const accent = duotoneFor(design?.accentColor || input.accentColor || PALETTE.GOLD).dark[1];
  const englishFamily = designEnglish ? designEnglish.family : preset.englishFontFamily;
  const englishItalic = design ? design.englishItalic : preset.englishItalic;
  const colLeft = width * 0.07;
  const colRight = cardX - width * 0.05;
  const colW = colRight - colLeft;
  const colCX = (colLeft + colRight) / 2;
  const titlePro = proPrimaryFonts(input.lang, englishFamily, design, fontStyle);
  const titleFamily = titlePro.hero;
  void englishItalic; // upright throughout (professional type system)
  const titleFont = (px: number) => `${titlePro.heroWeight} ${px}px ${titleFamily}`;
  // Reference in the shared style: tracked capitals for English, the clean sans for Tamil/Telugu.
  const refFont = (px: number) => proReferenceFont(input.lang, px * 0.62);
  const refText = proReferenceText(input.lang, input.reference);
  const subFont = (px: number) => input.lang === 'en' ? `700 ${px}px Montserrat` : `700 ${px}px ${titleFamily}`;

  const title = MEDITATION_TITLE[input.lang];
  const titlePx = fitFontSize(ctx, title, titleFont, 104, 48, colW);
  const refPx = fitFontSize(ctx, refText, refFont, 56, 28, colW * 0.8);
  // English is drawn upper-case and letter-spaced (below), so size it against that, with room for the spacing.
  const subText = input.lang === 'en' ? MEDITATION_SUBTITLE.en.toUpperCase() : MEDITATION_SUBTITLE[input.lang];
  const subPx = fitFontSize(ctx, subText, subFont, 30, 18, input.lang === 'en' ? colW * 0.82 : colW);

  // Vertical rhythm: logo, title, flourish, reference, subtitle - as one centered stack.
  const logoSize = logoImg ? 112 : 0;
  const gaps = { afterLogo: 44, afterTitle: 40, afterFlourish: 40, afterRef: 34 };
  const stackH = logoSize + (logoImg ? gaps.afterLogo : 0) + titlePx * 1.25 + gaps.afterTitle + 14 + gaps.afterFlourish + refPx * 1.3 + gaps.afterRef + subPx * 1.4;
  let y = (height - stackH) / 2 - 20;

  if (logoImg) {
    const lx = colCX - logoSize / 2;
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(colCX, y + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(colCX, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImg, lx, y, logoSize, logoSize);
    ctx.restore();
    y += logoSize + gaps.afterLogo;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 2;

  ctx.font = titleFont(titlePx);
  ctx.fillStyle = PALETTE.WHITE;
  y += (titlePx * 1.25) / 2;
  ctx.fillText(title, colCX, y);
  y += (titlePx * 1.25) / 2 + gaps.afterTitle;

  drawFlourish(ctx, colCX, y + 7, Math.min(170, colW * 0.3), accent);
  y += 14 + gaps.afterFlourish;

  ctx.font = refFont(refPx);
  ctx.fillStyle = accent;
  y += (refPx * 1.3) / 2;
  drawReferenceLine(ctx, refText, colCX, y, 'center', input.lang);
  y += (refPx * 1.3) / 2 + gaps.afterRef;

  ctx.font = subFont(subPx);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  y += (subPx * 1.4) / 2;
  if (input.lang === 'en') fillTextLetterSpaced(ctx, MEDITATION_SUBTITLE.en.toUpperCase(), colCX, y, 3);
  else ctx.fillText(MEDITATION_SUBTITLE[input.lang], colCX, y);
  ctx.restore();

  // Ministry footer, bottom of the left column - same treatment as the posters' footer.
  const footerY = height - 78;
  const igSize = 36, igGap = 14;
  ctx.save();
  ctx.font = '700 22px Lato, Montserrat';
  const ministryW = ctx.measureText(MINISTRY_NAME).width + 4 * (MINISTRY_NAME.length - 1);
  const groupLeft = colCX - (igSize + igGap + ministryW) / 2;
  drawInstagramIcon(ctx, groupLeft + igSize / 2, footerY, igSize);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  fillTextLetterSpaced(ctx, MINISTRY_NAME, groupLeft + igSize + igGap + ministryW / 2, footerY, 4);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

export function upscaleToCanonical(img: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT_W;
  canvas.height = PORTRAIT_H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, PORTRAIT_W, PORTRAIT_H);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

// Same idea as upscaleToCanonical above, but for the editorial background's own 4:5 canonical size
// (810x1013 generated -> EDITORIAL_W x EDITORIAL_H saved) rather than the vertical poster's 9:16 -
// using upscaleToCanonical here would stretch a 4:5 source into a 9:16 target and distort it.
export function upscaleToEditorialCanonical(img: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = EDITORIAL_W;
  canvas.height = EDITORIAL_H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, EDITORIAL_W, EDITORIAL_H);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png');
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
