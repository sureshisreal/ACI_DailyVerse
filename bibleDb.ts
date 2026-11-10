import path from 'path';
import { DatabaseSync } from 'node:sqlite';

// Fully offline, verified scripture text - the MyBible-format SQLite dumps in Db/ are the same
// BSI OV (Tamil/Telugu) and KJV (English) editions the old Gemini prompts asked the model to go
// search for and copy verbatim. Reading them directly removes the hallucination risk entirely
// instead of just working around it with a fallback chain.
export type BibleLang = 'en' | 'ta' | 'te';

const DB_PATHS: Record<BibleLang, string> = {
  en: path.join(process.cwd(), 'Db', 'kjv.db'),
  ta: path.join(process.cwd(), 'Db', 'tamil.db'),
  te: path.join(process.cwd(), 'Db', 'telugu.db'),
};

const dbs: Partial<Record<BibleLang, DatabaseSync>> = {};
const bookNamesByLang: Partial<Record<BibleLang, string[]>> = {};

// The booknames column is a hand-authored CSV-ish string, not real CSV - kjv.db/tamil.db wrap every
// name in matching quotes, telugu.db's export is missing the outer quotes on the first/last name.
// Splitting on the quote-comma-quote boundary (whichever quote character is used) and trimming any
// leftover boundary quote off the ends handles every variant seen across the three files.
function parseBookNames(raw: string): string[] {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  return trimmed.split(/['"]\s*,\s*['"]/).map(name => name.trim());
}

function getDb(lang: BibleLang): DatabaseSync {
  let db = dbs[lang];
  if (!db) {
    db = new DatabaseSync(DB_PATHS[lang], { readOnly: true });
    dbs[lang] = db;
    const row = db.prepare('SELECT booknames FROM configuration').get() as { booknames: string } | undefined;
    bookNamesByLang[lang] = row ? parseBookNames(row.booknames) : [];
  }
  return db;
}

// Common alternate spellings people type that don't match the DB's canonical (KJV) book name.
const BOOK_ALIASES: Record<string, string> = {
  'psalms': 'psalm',
  'song of songs': 'song of solomon',
  "solomon's song": 'song of solomon',
  'revelations': 'revelation',
};

function normalizeBookName(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return BOOK_ALIASES[key] || key;
}

function findBookNum(bookName: string): number | null {
  const englishNames = getDb('en') && bookNamesByLang.en!;
  const target = normalizeBookName(bookName);
  const idx = englishNames.findIndex(name => name.toLowerCase() === target);
  return idx === -1 ? null : idx + 1;
}

const REFERENCE_RE = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/;

// telugu.db stores some conjuncts in the wrong code-point order: the dependent vowel sign comes
// BEFORE the halant + following consonant (e.g. Lamentations 3:24 "న మ ి ్ మ క", which renders as a
// broken "నమి్మక") instead of after the whole cluster ("న మ ్ మ ి క" = నమ్మిక). A vowel sign directly
// followed by a halant is never valid Telugu, so moving the sign to the end of its consonant cluster
// is always the correct repair - 329 such spots across 312 verses (e.g. తొమి్మది -> తొమ్మిది). Fixed on
// read rather than by rewriting the DB file. tamil.db has no such cases.
const TELUGU_MISORDERED_VOWEL_RE = /([క-హ])([ా-ౌౖ])((?:్[క-హ])+)/g;

// One-off corruptions the general rule can't repair: legacy Telugu fonts drew మ as వ + ు, and that
// glyph sequence was stored as letters (2 Samuel 23:10 "తివిు్మరిగ" for తిమ్మిరిగ).
const TELUGU_WORD_FIXES: [string, string][] = [['తివిు్మరిగ', 'తిమ్మిరిగ']];

function normalizeVerseText(text: string, lang: BibleLang): string {
  if (lang !== 'te') return text;
  let fixed = text;
  for (const [bad, good] of TELUGU_WORD_FIXES) fixed = fixed.split(bad).join(good);
  return fixed.replace(TELUGU_MISORDERED_VOWEL_RE, '$1$3$2');
}

export function getVerseFromDb(reference: string, lang: BibleLang): { text: string; reference: string } | null {
  const match = reference.trim().match(REFERENCE_RE);
  if (!match) return null;

  const [, bookRaw, chapterStr, verseStartStr, verseEndStr] = match;
  const bookNum = findBookNum(bookRaw);
  if (bookNum == null) return null;

  const chapter = parseInt(chapterStr, 10);
  const verseStart = parseInt(verseStartStr, 10);
  const verseEnd = verseEndStr ? parseInt(verseEndStr, 10) : verseStart;

  try {
    const db = getDb(lang);
    const rows = db.prepare(
      'SELECT word, verseNum FROM words WHERE bookNum = ? AND chNum = ? AND verseNum BETWEEN ? AND ? ORDER BY verseNum'
    ).all(bookNum, chapter, verseStart, verseEnd) as { word: string; verseNum: number }[];
    if (rows.length === 0) return null;

    const text = normalizeVerseText(rows.map(r => r.word.trim()).join(' '), lang);
    const localBookName = bookNamesByLang[lang]![bookNum - 1];
    const verseSuffix = verseEnd !== verseStart ? `${verseStart}-${verseEnd}` : `${verseStart}`;
    return { text, reference: `${localBookName} ${chapter}:${verseSuffix}` };
  } catch (err: any) {
    console.warn(`Bible DB lookup failed for "${reference}" (${lang}):`, err?.message || err);
    return null;
  }
}
