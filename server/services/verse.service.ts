import { getVerseFromDb } from '../../bibleDb';

export interface VerseResult {
  text: string;
  reference: string;
}

export interface DailyVerse {
  reference: string;
  english: VerseResult | null;
  tamil: VerseResult | null;
  telugu: VerseResult | null;
}

// The single entry point for Scripture lookup - the rest of the app (routes, UI) should never
// query bibleDb.ts directly. The SQLite databases in Db/ are the ONLY source of Scripture; there
// is no JSON override/fallback. A missing language comes back as `null`, never a substituted
// verse; callers must surface that as a blocking error for that language, not fall through to
// different content under the same reference label.
export function getDailyVerse(reference: string): DailyVerse {
  return {
    reference,
    english: getVerseFromDb(reference, 'en'),
    tamil: getVerseFromDb(reference, 'ta'),
    telugu: getVerseFromDb(reference, 'te')
  };
}
