// Reading highlighter: pairs each word box on the poster (posterRenderer.ts's
// renderVersePosterHighlightSet) with when that word is spoken, for /api/video/generate's
// `highlight` option, which makes each word glow while it is being read.
//
// The poster's words and the spoken words don't line up one-to-one: the poster may show only a
// portion of the verse (ai/versePortionSelector.ts), the narration appends the spoken reference, and
// punctuation/quotes differ. So words are matched loosely in order, and any poster word that can't be
// matched gets a time interpolated from its matched neighbours.
import type { PosterWordBox } from './posterRenderer';

export interface SpokenWord { text: string; start: number; end: number }
export interface HighlightWord { x: number; y: number; w: number; h: number; layer: number; start: number; end: number }

function normalizeWord(w: string): string {
  return w.normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}]/gu, '');
}

function wordsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Agglutinative scripts (Tamil/Telugu) and TTS tokenizers sometimes split or join differently.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

const LOOKAHEAD = 8;
// A word's band stays up until the next word starts, unless there's a real pause (e.g. a comma).
const MAX_BRIDGE_SEC = 0.45;

export function buildHighlightWords(boxes: PosterWordBox[], spoken: SpokenWord[]): HighlightWord[] | null {
  if (!boxes.length || !spoken.length) return null;
  const spokenNorm = spoken.map((s) => normalizeWord(s.text));
  const times: ({ start: number; end: number } | null)[] = [];
  let j = 0;
  let matched = 0;
  for (const box of boxes) {
    const target = normalizeWord(box.text);
    let found = -1;
    for (let k = j; k < Math.min(spoken.length, j + LOOKAHEAD); k++) {
      if (wordsMatch(target, spokenNorm[k])) { found = k; break; }
    }
    if (found >= 0) {
      times.push({ start: spoken[found].start, end: spoken[found].end });
      j = found + 1;
      matched++;
    } else {
      times.push(null);
    }
  }
  // Too few matches means the timings belong to different text - better no highlight than a wrong one.
  if (matched < Math.max(1, Math.ceil(boxes.length * 0.5))) return null;

  // Interpolate unmatched words between their nearest matched neighbours.
  for (let i = 0; i < times.length; i++) {
    if (times[i]) continue;
    let p = i - 1; while (p >= 0 && !times[p]) p--;
    let n = i + 1; while (n < times.length && !times[n]) n++;
    const from = p >= 0 ? times[p]!.end : (n < times.length ? Math.max(0, times[n]!.start - 0.4 * (n - i)) : 0);
    const to = n < times.length ? times[n]!.start : from + 0.4 * (i - p);
    const span = n - p - 1;
    const slot = (to - from) / Math.max(1, span);
    const idx = i - p - 1;
    times[i] = { start: from + slot * idx, end: from + slot * (idx + 1) };
  }

  return boxes.map((b, i) => {
    const t = times[i]!;
    const next = times[i + 1];
    const end = next && next.start > t.end && next.start - t.end <= MAX_BRIDGE_SEC ? next.start : t.end;
    return { x: b.x, y: b.y, w: b.w, h: b.h, layer: b.layer, start: t.start, end: Math.max(end, t.start + 0.12) };
  });
}

// Maps word boxes from poster pixels into another frame (e.g. the meditation frame's poster card).
export function transformBoxes(boxes: PosterWordBox[], posterW: number, rect: { x: number; y: number; w: number }): PosterWordBox[] {
  const s = rect.w / posterW;
  return boxes.map((b) => ({ ...b, x: rect.x + b.x * s, y: rect.y + b.y * s, w: b.w * s, h: b.h * s }));
}
