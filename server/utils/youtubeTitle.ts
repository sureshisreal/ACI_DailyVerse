// Last-line cleanup for YouTube titles - applied both when Claude's metadata is validated
// (ai/youtubeMetadata.ts) and again right before upload (server/services/youtube.service.ts), since
// cached and UI-supplied titles never pass back through validation. Each rule targets a defect
// actually seen on the live channel's titles (2026-09-28): hashtags stuffed into the title and cut
// off on mobile, stray JSON leftovers like `#புதியபடைப்பு",`, slug references like "zephaniah-3-17",
// lowercase book names like "isaiah 65:17", and "65: 17" spacing.

// YouTube's hard limit - an upload with a longer title is rejected outright.
export const YOUTUBE_TITLE_MAX_LENGTH = 100;

// Punctuation that's only ever an artifact at a title's edges (quotes/commas from JSON leaking
// through, separators left dangling after hashtags are removed). Deliberately excludes ? ! and ),
// which legitimately end titles.
const EDGE_JUNK = /^[\s"'“”‘’`,;:|—–-]+|[\s"'“”‘’`,;:|—–.-]+$/gu;

export function sanitizeYoutubeTitle(raw: string): string {
  let title = raw
    // YouTube rejects titles containing angle brackets.
    .replace(/[<>]/g, '')
    // Hashtags belong in the description (YouTube surfaces the first three above the title anyway).
    .replace(/(^|\s)#[^\s#]+/gu, ' ')
    .replace(/["“”`]/g, (q, _offset, s) => (isBalancedQuote(s, q) ? q : ''))
    // "zephaniah-3-17" -> "zephaniah 3:17"
    .replace(/\b([A-Za-z]+)-(\d{1,3})-(\d{1,3})\b/g, '$1 $2:$3')
    // "zephaniah - 3:17" -> "zephaniah 3:17"
    .replace(/\b([A-Za-z]+)\s+-\s+(\d{1,3}:\d{1,3})/g, '$1 $2')
    // "65: 17" -> "65:17"
    .replace(/(\d)\s*:\s+(\d)/g, '$1:$2')
    // "isaiah 65:17" -> "Isaiah 65:17" - the word directly before chapter:verse is the book name.
    .replace(/\b([a-z])([a-z]+)(?=\s+\d{1,3}:\d)/g, (_m, first: string, rest: string) => first.toUpperCase() + rest)
    .replace(/\s+/g, ' ')
    // A combining mark can't start a word - one at the front means a leading character was lost.
    .replace(/^\p{M}+/u, '')
    .replace(EDGE_JUNK, '');

  if (title.length > YOUTUBE_TITLE_MAX_LENGTH) {
    const cut = title.slice(0, YOUTUBE_TITLE_MAX_LENGTH);
    const lastSpace = cut.lastIndexOf(' ');
    // Cut at a word boundary so a Tamil/Telugu syllable cluster is never split mid-grapheme.
    title = (lastSpace > YOUTUBE_TITLE_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).replace(EDGE_JUNK, '');
  }
  return title;
}

// Keeps paired quotes (a quoted phrase) and drops unpaired ones, which are always JSON leftovers.
function isBalancedQuote(s: string, q: string): boolean {
  if (q === '“' || q === '”') return s.includes('“') && s.includes('”');
  return (s.split(q).length - 1) % 2 === 0;
}
