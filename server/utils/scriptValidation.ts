// Shared Tamil/Telugu foreign-script leak detector - previously duplicated (with a narrower, buggy
// range) in both ai/meditation.ts and ai/contentPackage.ts. Catches a real, repeatedly-observed
// Claude failure mode: a stray character or whole word from a different Indic script slipping into
// otherwise-correct Tamil/Telugu text (verified directly in testing - a whole Bengali word, "আজ",
// appeared mid-paragraph in a generated Tamil meditation). Covers every major Indic script block
// contiguous with Tamil/Telugu's own (Devanagari through Sinhala, U+0900-U+0DFF) except the
// language's own block, deliberately as the whole neighboring range rather than an
// observed-failures allowlist - a script no one has seen leak yet is still a leak.
export const FOREIGN_SCRIPT_RANGES: Record<'ta' | 'te', RegExp> = {
  // Devanagari-Oriya (U+0900-U+0B7F) + Telugu-Sinhala (U+0C00-U+0DFF), skipping Tamil's own block
  // (U+0B80-U+0BFF).
  ta: /[ऀ-୿ఀ-෿]/,
  // Devanagari-Tamil (U+0900-U+0BFF) + Kannada-Sinhala (U+0C80-U+0DFF), skipping Telugu's own block
  // (U+0C00-U+0C7F).
  te: /[ऀ-௿ಀ-෿]/,
};

// Returns the first foreign-script character found in `text` for the given language, or null if
// the text is clean.
export function findForeignScriptChar(text: string, lang: 'ta' | 'te'): string | null {
  const match = FOREIGN_SCRIPT_RANGES[lang].exec(text);
  return match ? match[0] : null;
}

// Throws with a descriptive message identifying the field, for a single flat string field (see
// ai/meditation.ts). For validating a nested object tree of many fields, walk it directly with
// findForeignScriptChar instead (see ai/contentPackage.ts's findForeignScriptViolations).
export function assertNoForeignScript(text: string, lang: 'ta' | 'te', field: string): void {
  const char = findForeignScriptChar(text, lang);
  if (char) {
    throw new Error(`"${field}" contains a foreign-script character ("${char}") - not genuine ${lang === 'ta' ? 'Tamil' : 'Telugu'} text`);
  }
}
