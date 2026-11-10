// Picks how much of a long verse the poster shows. Unlike the deleted heuristic version of this
// module (pure punctuation/word-count string-splitting, no language understanding), this asks
// Claude to do what the task actually requires: read the whole verse, find its central message,
// and - only if a SHORTER piece of it is still a complete, grammatically independent thought in
// ALL THREE of English/Tamil/Telugu at once - return that same thought verbatim in each language.
// If it can't find one, or the model's answer fails verification, every caller gets the full verse
// in every language. There is no per-language fallback: either all three shorten together to the
// same thought, or all three stay full - a mix of the two was the exact bug the previous version of
// this module (pure heuristics, no model) produced.
import fs from 'fs';
import path from 'path';
import { askClaudeForJson } from './claude';
import { sha256 } from '../server/utils/hash';

// Bump whenever the prompt or validation rules below change materially, invalidating old cache
// entries after a code change rather than only after a data change (see ai/meditation.ts).
// v2 (reverted): briefly restructured onto a literal persona/numbered-RULESET/numbered-WORKFLOW
// wording - verified via direct testing to regress real behavior: it stopped finding legitimate
// shortenings entirely (e.g. Psalm 46:10's "Be still, and know that I am God", which v1 found
// correctly, came back "full" under v2, as did every other long verse tried). Leading with a
// loss-averse "never shorten" framing before any goal-oriented framing appears to have pushed the
// model to treat "when in doubt, full" as "always full". v3 restores v1's prompt (GOAL framing
// before the rules, verified to actually produce correct "portion" decisions when warranted) and
// keeps only the purely additive, low-risk pieces from that wording (persona line, named
// translations).
export const VERSE_PORTION_VERSION = 3;

// Verses at or under this word count are already comfortable to read in full - skip the Claude
// call entirely rather than pay for a round trip whose only possible outcome is "full" anyway.
const PORTION_ELIGIBLE_WORD_THRESHOLD = 18;

// Cross-language, grammar-judgment task on Scripture text. Set to the cheapest model to save cost;
// Haiku has shown failures on sustained Tamil/Telugu judgments before, but a failed or unverifiable
// answer here just falls back to the full verse (see below), so the cost of a miss is small.
const PORTION_MODEL = 'claude-haiku-4-5';

const CACHE_DIR = path.join(process.cwd(), 'cache', 'verse-portion');

export interface VersePortionResult {
  decision: 'full' | 'portion';
  english: string;
  tamil: string;
  telugu: string;
  // Short internal note (Claude's stated reasoning, or why this fell back to full) - logged for
  // debugging, never shown to a reader.
  reason: string;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Exact substring check, with one narrow, deliberate tolerance: a mid-sentence terminator
// (colon/semicolon/comma) at exactly the cut point may come back as a period instead. Verified
// directly against a real failure - for Psalm 46:10 ("Be still, and know that I am God: I will be
// exalted...") Claude correctly identified "Be still, and know that I am God" as the complete
// standalone thought but, reasonably, closed it with a period rather than reproducing the
// mid-sentence colon that was never meant to end a sentence on its own - a strict substring check
// rejected this as if it were a rewrite, when every single word was exact and only the closing
// punctuation mark changed. This does not weaken "never rewrite Scripture": no word, letter, or
// meaning-bearing punctuation (question marks, exclamation points, etc.) is touched - only a
// continuation mark exactly at the boundary Claude chose to end the excerpt may become a
// terminator, which is standard typographic practice for a truncated Scripture quotation.
function isContiguousSubstring(full: string, selected: string): boolean {
  const f = normalizeWs(full);
  const s = normalizeWs(selected);
  if (s.length === 0) return false;
  if (f.includes(s)) return true;

  if (s.endsWith('.')) {
    const core = s.slice(0, -1);
    const idx = f.indexOf(core);
    if (idx !== -1 && /[:;,]/.test(f[idx + core.length] || '')) return true;
  }
  return false;
}

// Minimal, deliberately narrow backstop against the exact failure the product spec calls out by
// name (a selection ending in "to…", "that…", "which…", "who…", "because…", "so that…" - i.e. a
// clause that grammatically demands the words after it). Claude is the primary judge of
// completeness across all three languages; this only catches the single, cheaply-detectable English
// failure mode explicitly named in the spec as unacceptable, as defense in depth - not a
// replacement for the model's judgment, and not attempted for Tamil/Telugu (a regex word-list can't
// judge grammatical dependency in those scripts the way it can for English).
const ENGLISH_DANGLING_END = new Set([
  'to', 'that', 'which', 'who', 'whom', 'whose', 'because', 'so', 'and', 'but', 'or', 'for', 'nor',
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'by', 'with', 'his', 'her', 'their', 'our', 'your', 'my',
]);
const ENGLISH_DANGLING_START = new Set([
  'that', 'which', 'who', 'whom', 'whose', 'because', 'therefore', 'and', 'but', 'or', 'so',
]);

function lastWord(s: string): string {
  const m = s.trim().match(/([A-Za-z']+)[^A-Za-z']*$/);
  return m ? m[1].toLowerCase() : '';
}
function firstWord(s: string): string {
  const m = s.trim().match(/^[^A-Za-z']*([A-Za-z']+)/);
  return m ? m[1].toLowerCase() : '';
}

function englishPassesDanglingCheck(selected: string): boolean {
  const last = lastWord(selected);
  const first = firstWord(selected);
  if (last && ENGLISH_DANGLING_END.has(last)) return false;
  if (first && ENGLISH_DANGLING_START.has(first)) return false;
  return true;
}

function cacheKeyFor(reference: string, english: string, tamil: string, telugu: string): string {
  return sha256([reference, english, tamil, telugu, String(VERSE_PORTION_VERSION)].join('|'));
}

function readCache(key: string): VersePortionResult | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, result: VersePortionResult): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(result, null, 2));
  } catch (err) {
    console.warn('[ai/versePortionSelector] Failed to write cache:', err);
  }
}

const SYSTEM_PROMPT = `You are an expert multilingual Biblical editor specializing in English, Tamil, and Telugu Scripture layout. You choose how much of a Bible verse a devotional poster displays, in English, Tamil, and Telugu at once. You will be given the exact verse text in all three languages (already resolved from a verified translation - KJV-style for English, standard published translations for Tamil and Telugu). Respond with ONLY minified JSON, no prose, no markdown fences, in exactly this shape:
{"decision":"full"|"portion","english":"...","tamil":"...","telugu":"...","reason":"..."}

GOAL: readers get a comfortable amount of Scripture without losing meaning. This is NOT about hitting a target length, word count, or percentage - it is about finding one complete, meaningful Biblical thought.

HOW TO DECIDE:
1. Read the complete verse in all three languages first. Identify its central Biblical message, main instruction or promise, and natural sentence/clause boundaries.
2. Only set "decision":"portion" if you can find a SHORTER continuous piece of the verse that is a complete, self-contained thought - one that is grammatically whole, makes full sense read on its own, and clearly carries the verse's intended message without needing the omitted words to complete it.
3. A portion must NEVER end (in English) on a word like "to", "that", "which", "who", "because", "so that", or any other word whose clause is left grammatically unfinished - the equivalent failure (a clause left dangling, needing the cut words to complete its grammar or meaning) is just as unacceptable in Tamil and Telugu, even though the specific words differ.
4. The SAME thought/meaning must be independently complete and grammatically whole in English AND Tamil AND Telugu. Do not shorten one language's text if the equivalent slice of another language would be incomplete or grammatically dependent - if even one language can't produce a complete independent portion for that thought, use "decision":"full" for all three instead.
5. If you cannot confidently find a portion that is complete in all three languages, set "decision":"full" - a complete full verse always beats an incomplete shorter one. When in doubt, choose "full".

RULES FOR "portion" (all three fields required, even ones you didn't change):
- Each of "english"/"tamil"/"telugu" must be copied EXACTLY, character-for-character, from the verse text you were given for that language - a real contiguous substring of it. Never paraphrase, translate, summarize, modernize, reorder, add words, or drop words from inside the passage.
- Each must be a single continuous span (you may only trim from the start and/or end of the verse - never remove a piece from the middle and stitch the rest together).
- Preserve original punctuation exactly as it appears within the span you keep.

RULES FOR "decision":"full": set "english"/"tamil"/"telugu" to the complete, unmodified original text you were given for each language.

"reason": one short sentence (internal note, never shown to a reader) explaining your decision - the central thought you identified, or why no complete synchronized portion existed.

Priority order when these conflict: meaning and Scripture accuracy first, then completeness, then three-language consistency, then reader comfort/brevity last. Never shorten Scripture at the expense of any of the higher priorities.`;

interface ParsedPortionResponse {
  decision?: string;
  english?: string;
  tamil?: string;
  telugu?: string;
  reason?: string;
}

// Verifies a Claude "portion" response actually honors the rules above before it's ever trusted:
// each language's text must be a genuine contiguous substring of that language's full verse (the
// hard guarantee that Scripture was never rewritten), non-trivially shorter than the full verse,
// and - for English, the one language a cheap word-list check can judge - not left dangling on an
// unfinished clause. Any single failure discards the WHOLE portion (never just one language's), so
// the caller always gets either three matching complete portions or three full verses.
function validatePortion(
  parsed: ParsedPortionResponse,
  fullEnglish: string,
  fullTamil: string,
  fullTelugu: string,
): { english: string; tamil: string; telugu: string } | null {
  if (typeof parsed.english !== 'string' || typeof parsed.tamil !== 'string' || typeof parsed.telugu !== 'string') {
    return null;
  }
  const english = parsed.english.trim();
  const tamil = parsed.tamil.trim();
  const telugu = parsed.telugu.trim();
  if (!english || !tamil || !telugu) return null;

  if (!isContiguousSubstring(fullEnglish, english)) return null;
  if (!isContiguousSubstring(fullTamil, tamil)) return null;
  if (!isContiguousSubstring(fullTelugu, telugu)) return null;

  // Must actually be shorter (and non-trivially so) - a "portion" that came back equal to (or
  // barely trimmed from) the full verse isn't a real shortening decision.
  if (wordCount(english) < 3 || wordCount(english) >= wordCount(fullEnglish)) return null;

  if (!englishPassesDanglingCheck(english)) return null;

  return { english, tamil, telugu };
}

async function requestPortionFromClaude(
  reference: string,
  english: string,
  tamil: string,
  telugu: string,
): Promise<VersePortionResult | null> {
  const userPrompt = `Reference: ${reference}\n\nEnglish: ${english}\n\nTamil: ${tamil}\n\nTelugu: ${telugu}`;

  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await askClaudeForJson(SYSTEM_PROMPT, userPrompt, 1600, PORTION_MODEL) as ParsedPortionResponse;
      const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : '(no reason given)';

      if (raw.decision === 'full') {
        return { decision: 'full', english, tamil, telugu, reason };
      }
      if (raw.decision === 'portion') {
        const validated = validatePortion(raw, english, tamil, telugu);
        if (validated) {
          return { decision: 'portion', ...validated, reason };
        }
        // Claude proposed a portion that failed verification (not a verbatim substring, too
        // short/long, or dangling) - retry once rather than immediately giving up a real
        // shortening opportunity to a single malformed response.
        continue;
      }
      // Unrecognized "decision" value - malformed response, retry.
    } catch {
      // Network/parse/API error - retry within budget, then fall through to the safe default.
    }
  }
  return null;
}

// One Claude call per unique verse, cached to disk. Never throws and never returns a mixed
// result - on any failure (no API key, network error, malformed/unverifiable response, or a verse
// too short to be worth asking about) this resolves to the always-safe "full" decision, since a
// complete verse is always a valid answer per the product's own priority order.
export async function selectVersePortion(
  reference: string,
  english: string,
  tamil: string,
  telugu: string,
): Promise<VersePortionResult> {
  const fullResult: VersePortionResult = { decision: 'full', english, tamil, telugu, reason: 'full verse' };

  if (wordCount(english) <= PORTION_ELIGIBLE_WORD_THRESHOLD) {
    return { ...fullResult, reason: `short verse (${wordCount(english)} words) - no shortening needed` };
  }

  const key = cacheKeyFor(reference, english, tamil, telugu);
  const cached = readCache(key);
  if (cached) return cached;

  let result: VersePortionResult;
  try {
    result = (await requestPortionFromClaude(reference, english, tamil, telugu))
      ?? { ...fullResult, reason: 'Claude portion selection unavailable or unverifiable - using full verse' };
  } catch (err: any) {
    result = { ...fullResult, reason: `portion selection failed (${err?.message || err}) - using full verse` };
  }

  writeCache(key, result);
  return result;
}
