# Implementation Tasks — Professional Poster Standardization

Derived from `spec.md` in this folder. Every task maps to one or more Acceptance Criteria; every task carries its own Test Requirements (TR) typed strictly as `rule` or `rubric`.

Priority order: tasks are processed top-to-bottom. Every task's status starts as `pending` and moves through `in_progress` → `completed` (all TRs self-verified with evidence recorded).

---

## Task 1: Standardize ministry-brand identity lock — keep and consistently apply "The Apostolic Church of India"

**File paths to read first:**
- [posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L16-L16) (line 16 `MINISTRY_NAME` current value)
- [index.html](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/index.html#L6-L6) (line 6 `<title>`)
- [components/Header.tsx](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/Header.tsx) (ministry heading)
- Full-repo grep first for the literal string `Rehoboth Revival Ministries` (any case) to identify all stray locations

**Work:**
1. Leave `MINISTRY_NAME` in `components/posterRenderer.ts` at its current literal `The Apostolic Church of India` (the user direction is to keep this). Confirm the `ministryText = MINISTRY_NAME` line at the footer draw site uses the same string, no ALL-CAPS coercion.
2. Audit every ministry-name string in tracked source:
   - `index.html` `<title>`: change `Rehoboth Revival Ministries - Daily Verse Generator` → `The Apostolic Church of India - Daily Verse Generator` (or wherever Rehoboth appears).
   - `components/Header.tsx` heading or any ministry-name prop: replace Rehoboth with `The Apostolic Church of India`.
3. Run a full-project grep for `Rehoboth`; replace every occurrence in application source (not in `.trae/` spec artifacts, not in `.git/`, `node_modules/`, `cache/`, `Db/`) with `The Apostolic Church of India`, preserving the grammatical role in each sentence (e.g. possessive `'s` retained where present).
4. Verify the bundled logo asset path (`components/ACI.png`, imported in `DailyVerseGenerator.tsx` as `ministryLogoUrl`) still matches — no filename or import path change needed (logo is ACI-branded, matches the kept identity).

**Work (old direction — explicitly canceled per user "Keep The Apostolic Church of India"):**
~~1. In `components/posterRenderer.ts`, change the `MINISTRY_NAME` constant from `'The Apostolic Church of India'` to `'REHOBOTH REVIVAL MINISTRIES'`.
2. In `index.html`, update `<title>` to `Rehoboth Revival Ministries - Daily Verse Generator` (already partially correct — verify and align any mismatch).
3. Grep the entire repo for `The Apostolic Church of India`; replace every occurrence with the new brand, except files under `.git/`, `node_modules/`, `cache/`, and `Db/`.
4. Verify `Header.tsx` already carries the new brand — if not, update its heading string.~~

**Status:** pending

**Test Requirements:**
- **TR1.1 (rule, maps AC13):** A full-project case-sensitive grep for `Rehoboth Revival Ministries` in the tracked application source tree (excluding `.trae/` specs folder, `.git/`, `node_modules/`, `cache/`, `Db/`) returns 0 file matches. Evidence: `grep -R "Rehoboth Revival Ministries" --exclude-dir=.trae --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=cache --exclude-dir=Db .` returns empty.
- **TR1.2 (rule, maps AC12):** `components/posterRenderer.ts`'s `MINISTRY_NAME` equals the exact 29-character string `'The Apostolic Church of India'` (kept). Evidence: direct file read of line 16.
- **TR1.3 (rule, maps AC13):** `index.html` `<title>` contains `The Apostolic Church of India`. Evidence: line 6 file read.
- **TR1.4 (rule, maps AC13):** `components/Header.tsx`'s visible ministry heading contains `The Apostolic Church of India` (or points to it via a constant/prop). Evidence: direct read of Header render return.

**Completion Evidence:** to be recorded at completion.

---

## Task 2: Bump analyzer and image-generator versions to invalidate pre-standard caches

**File paths to read first:**
- [ai/schema.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/ai/schema.ts#L8-L8) (CLAUDE_ANALYZER_VERSION = 7)
- [server/services/image-generation.service.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/server/services/image-generation.service.ts#L15-L15) (IMAGE_GENERATOR_VERSION = 5)

**Work:**
1. Increment `CLAUDE_ANALYZER_VERSION` from 7 to 8 in `ai/schema.ts`. Add a short comment on the same or preceding line documenting the bump reason (standardization: verse portion selection, accent clamping, top-bias tuning, ACI brand-consistency lock).
2. Increment `IMAGE_GENERATOR_VERSION` from 5 to 6 in `server/services/image-generation.service.ts`; add a comment documenting the bump reason matching above plus retry-composition-escalation tightening from Task 4.

**Status:** pending

**Test Requirements:**
- **TR2.1 (rule, maps AC20):** `ai/schema.ts` exports `CLAUDE_ANALYZER_VERSION = 8` and the value is `> 7`.
- **TR2.2 (rule, maps AC20):** `server/services/image-generation.service.ts` exports `IMAGE_GENERATOR_VERSION = 6` and the value is `> 5`.

**Completion Evidence:** to be recorded.

---

## Task 3: Implement heuristic + Claude-assisted Verse Portion Selector

**File paths to read first:**
- [types.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/types.ts)
- [components/posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L320-L343) (splitIntoClauses / pickHeroIndex)
- [server/services/verse.service.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/server/services/verse.service.ts)

**Work:**
1. Create a new module `ai/versePortionSelector.ts`.
2. Export:
   - A constant `LONG_VERSE_WORD_THRESHOLD = 22` (word count — over this = portion-selectable, under = display full verse).
   - A type `PortionSelection = { selected: string; method: 'full' | 'punctuation-clause' | 'word-span-fallback' | 'claude-checked'; reason: string; }`.
   - `countWords(text: string, lang: 'en' | 'ta' | 'te'): number` — splits on whitespace for EN; for TA/TE, also counts whitespace-delimited tokens (South Asian scripts typically word-separate the same way in the DB).
   - `findKeywordClauseIndex(clauses: string[], themeMatchedKeywords: string[]): number` — returns the clause index that contains any one of the matched theme keywords, or -1.
   - `selectVersePortionHeuristic(text: string, lang: 'en' | 'ta' | 'te', themeMatchedKeywords?: string[]): PortionSelection` — per FR2 rules:
     - If `countWords(text) <= LONG_VERSE_WORD_THRESHOLD` return `{ selected: text, method: 'full', reason: 'short verse, below threshold' }`.
     - Else split on `[,;:।\.]` punctuation, trim each clause, drop empties. If splitting yields ≥2 clauses, pick one using: keyword-matched clause (if found via `findKeywordClauseIndex`), else the last clause (devotional-closing-clause convention), then also append the immediately preceding clause if the chosen clause alone is < 3 words. Join with `, ` or `. ` context-appropriately — simpler approach: return the exact contiguous raw substring of the DB text that spans from the start of the chosen clause(s) to the end of the chosen clause(s).
     - If punctuation split yields <2 usable clauses, fall back to word-span selection: a contiguous span of `round(countWords(text) * 0.5)` words, anchored to a keyword match when one exists (span starts ≈ at the keyword-containing word, centered), else centered. Construct the span by re-splitting the raw text by whitespace into tokens, reconstructing with a single space between tokens (so the result is still a grammatical contiguous substring).
     - In every path, enforce that `selected` is a **contiguous substring** of the input `text` (ignoring only internal whitespace normalization differences between the heuristic reconstruction and the DB; strictly: the chosen tokens must appear consecutively in order, and the selection is built from the DB substring between the first chosen token's start character and the last chosen token's end character to preserve punctuation).
     - Return the selected portion plus a human-readable reason.
   - `stripCurlyQuotes(s: string): string` — removes U+201C and U+201D characters from a string. Used by posterRenderer as a defensive measure.
   - Optional: `selectVersePortionWithClaude(...)` signature and stub that simply delegates to the heuristic (full AI-assisted selection explicitly deferred; the deterministic heuristic is the shipping path per project resilience rules — Claude assistance is a bonus only if later added, not a blocker now — keep the implementation scope deterministic, aligns with NFR2 resilience).

3. Wire defensive `stripCurlyQuotes()` calls into `posterRenderer.ts`'s `buildClauseBlock()`: the `text` argument is passed through `stripCurlyQuotes()` before any split/paint.
4. Ensure `quoted: false` is always passed for verse text in `posterRenderer.ts` (already `quoted: false` in the existing render loops, per current code lines 751-752 and 771-772 — re-verify both the primary and the English `buildClauseBlock` invocations are `quoted: false`). Keep `quoted` option available for hook cards and non-verse copy.

**Status:** pending

**Test Requirements:**
- **TR3.1 (rule, maps AC1, AC2):** For a pre-defined EN sample verse (>22 words, punctuated), `selectVersePortionHeuristic(english, 'en', keywords)` returns a `selected` string that is a contiguous substring of the input and shorter than the input by at least 20 %. Evidence: spot-checked using John 3:16 and a long Psalm verse sample.
- **TR3.2 (rule, maps AC1):** For a short EN verse (<= 22 words), `method === 'full'` and `selected === text`.
- **TR3.3 (rule, maps AC4):** `stripCurlyQuotes('“Hello” world')` returns `'Hello world'` (no curly quote codepoints remain). Evidence: direct Node-style import-and-call assertion or TS eval.
- **TR3.4 (rule, maps AC1, AC2, FR6):** The result of `selectVersePortionHeuristic` for any input always produces a `selected` value such that `text.includes(selected)` OR a whitespace-normalized comparison (`text.replace(/\s+/g,' ').includes(selected.replace(/\s+/g,' '))`) holds. Evidence: randomized 100-verse loop over stored DB samples comparing both.
- **TR3.5 (rule, maps AC4):** Both invocations of `buildClauseBlock` inside `renderVersePoster()` pass `quoted: false`. Evidence: direct read of posterRenderer.ts lines.

**Completion Evidence:** to be recorded.

---

## Task 4: Tighten cinematic prompt guarantees, retry override, and accent-color clamping

**File paths to read first:**
- [ai/schema.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/ai/schema.ts#L77-L136) (COMPOSITION_PLACEMENT_GUARANTEE, CINEMATIC_QUALITY_SUFFIX, validateClaudeAnalysis)
- [ai/themeMapper.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/ai/themeMapper.ts#L544-L573) (buildStandardizedPrompt)
- [components/posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L461-L465) (accentForTheme)
- [server/routes/verse.routes.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/server/routes/verse.routes.ts#L36-L37) (BACKGROUND_RETRY_COMPOSITION_OVERRIDE)

**Work:**
1. In `ai/schema.ts`:
   - Reword `COMPOSITION_PLACEMENT_GUARANTEE` to explicitly say: `…strictly to the bottom 25% - 45% of the frame only. The upper 55%+ is completely open and empty: plain sky, distant softly-blurred backdrop, or a smooth uniform gradient. Absolutely no tall silhouette, head, shoulder, hand, building, tree, or any object crosses above the vertical midpoint (50% line) of the image.` (keeps quantified language, adds anti-silhouette clause per FR3).
   - Confirm `CINEMATIC_QUALITY_SUFFIX` already reads `cinematic film still, professional photography, photorealistic, highly detailed, 8k, film grain, depth and atmosphere` — if shorter, extend it to this exact literal.
2. In `ai/themeMapper.ts`'s `buildStandardizedPrompt()`:
   - Ensure the constructed `prompt` always terminates with `CINEMATIC_QUALITY_SUFFIX` (currently a trailing join includes it — verify and strengthen so it's always the final clause).
   - Ensure every prompt carries a quantified subject-placement guarantee (the function already branches by placement hint — strengthen to inject the same reworded guarantee regardless of branch, and end with `cinematic film still, professional photography, photorealistic, highly detailed, 8k, film grain, depth and atmosphere`).
3. In `components/posterRenderer.ts`'s `accentForTheme()`:
   - Raise saturation floor from 0.35 to 0.45 per FR8 / NFR-accent rule.
   - Document the change in a short inline comment.
4. In `server/routes/verse.routes.ts`:
   - Change `BACKGROUND_RETRY_COMPOSITION_OVERRIDE` to: `'CRITICAL COMPOSITION OVERRIDE (RETRY ESCALATION): the entire subject is confined to a small tight group strictly within the BOTTOM 25% of the frame only. No head, hand, shoulder, building, tree, or tall silhouette crosses the 30% vertical line or above. The TOP 70% of the frame is COMPLETELY EMPTY — only plain open sky, soft blurred distant atmosphere, or smooth gradient. Negative constraint: no vertically-tall standing figure, no tower, no steeple, no object taller than 25% of frame height anywhere in the image.'`

**Status:** pending

**Test Requirements:**
- **TR4.1 (rule, maps AC6):** For each of 5 sampled BibleThemeKeys, `buildStandardizedPrompt(getThemeSpec(key), spec.visualConcepts[0]).prompt` contains the phrase `bottom 25%` and the phrase `cinematic film still, professional photography`. Evidence: 5 string assertions.
- **TR4.2 (rule, maps AC6):** After `validateClaudeAnalysis()` runs on a deliberately minimal raw input, the resulting `analysis.prompt` contains both the quantified placement guarantee string (contains `upper 55%+ completely open` or equivalent, per new wording) and the cinematic suffix.
- **TR4.3 (rule, maps FR8 / design-system):** `accentForTheme('#8F9EA0', true)` returns a hex whose HSL saturation (computed via `hexToHsl`) is ≥ 0.44 (within floating-point tolerance of the 0.45 floor).
- **TR4.4 (rule, maps FR3):** New `BACKGROUND_RETRY_COMPOSITION_OVERRIDE` string contains `BOTTOM 25%` and `TOP 70%` literal substrings.

**Completion Evidence:** to be recorded.

---

## Task 5: Tune posterRenderer composition bias, line-height, and scrims

**File paths to read first:**
- [posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L233-L270) (TOP_BIAS_PER_ROW, findEmptiestBand, horizontalBiasWithinBand)
- [posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L735-L790) (scale loop / clause block layout params)
- [posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L851-L866) (scrim)

**Work:**
1. Change `TOP_BIAS_PER_ROW` from `0.03` to `0.055` in `findEmptiestBand` (per FR7). Add a one-line comment explaining it prevents a slightly flatter lower band from winning over clearly-empty upper sky.
2. In the `buildClauseBlock` calls inside the `renderVersePoster` scale-loop:
   - For primary-language (Tamil/Telugu) layout: change `baseLH` from `primaryBaseSize * 1.5` to `primaryBaseSize * 1.42`; change `heroLH` from `primaryBaseSize * heroScale * 1.55` to `primaryBaseSize * heroScale * 1.48`. (English stays unchanged — its scripts are naturally more compact at the given 1.45 / 1.45 multipliers.)
3. Scrim tuning for light themes: change the `if (!isLight) { … }` guard to always draw a scrim, with a very-low-alpha light version:
   - Dark theme (previously): peak alpha `0.46` — unchanged.
   - Light theme new branch: draw the same `scrimGrad` shape with peak alpha = 0.08 instead of 0.46. Structure the code with a ternary so peak alpha is parameterized. Update comments.

**Status:** pending

**Test Requirements:**
- **TR5.1 (rule, maps FR7):** `TOP_BIAS_PER_ROW === 0.055` in `posterRenderer.ts`. Evidence: line read.
- **TR5.2 (rule, maps AC9, FR4):** In the Tamil/Telugu `buildClauseBlock` call, `baseLH === primaryBaseSize * 1.42` (± 0.0001) and `heroLH === primaryBaseSize * 2.15 * 1.48` (± 0.0001). Evidence: line read and arithmetic.
- **TR5.3 (rubric, maps AC11 / AC17, threshold ≥ 1.5 / 2):** Tamil block compactness at min scale 0.60.
  - Score 2: Tamil sample poster renders cleanly without inter-line crowding or collisions, block height noticeably smaller than the previous 1.50/1.55 multipliers.
  - Score 1: Acceptable but tighter than ideal.
  - Score 0: Glyphs collide or become illegible.
  - Evidence: Render a Tamil poster with a long verse (portion-selected) at the clamped 0.60 scale and visually inspect.

**Completion Evidence:** to be recorded.

---

## Task 6: Implement client-side QC step + wire verse-portion selection into poster render

**File paths to read first:**
- [components/DailyVerseGenerator.tsx](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/DailyVerseGenerator.tsx) (poster-render call sites)
- [components/posterRenderer.ts](file:///Users/sureshbabuisreal/Documents/PersonalGithub/ACI/remix_-remix_-remix_-verse_with-prayer_animated_v3_fix-font-size-issue_pro_v1/components/posterRenderer.ts#L620-L648) (PosterVerseInput)
- New module from Task 3: `ai/versePortionSelector.ts`

**Work:**
1. In `ai/versePortionSelector.ts`, add and export a `runQualityControl()` function with signature:

   ```ts
   export interface QCCheck { rule: string; pass: boolean; detail?: string; }
   export interface QCResult {
     pass: boolean;
     checks: QCCheck[];
     tamilSelection: PortionSelection | null;
     teluguSelection: PortionSelection | null;
     englishSelection: PortionSelection | null;
   }

   export function runQualityControl(params: {
     reference: string;
     tamilFull: string | null;
     teluguFull: string | null;
     englishFull: string | null;
     tamilSelected?: string;
     teluguSelected?: string;
     englishSelected?: string;
     themeMatchedKeywords?: string[];
   }): QCResult;
   ```

   The function records the following checks:
   - `reference_not_empty`: reference string non-empty.
   - `tamil_selected_is_substring_of_full`: if `tamilSelected` is provided and differs from `tamilFull`, verify it is a contiguous substring (after whitespace normalization) of `tamilFull`; if it fails, QC.pass=false.
   - `telugu_selected_is_substring_of_full`: same for Telugu.
   - `english_selected_is_substring_of_full`: same for English.
   - `tamil_reference_correspondence`: informational only — not blocking. Looks for theme keyword presence in same-relative clause.
   - `curly_quotes_absent_from_selections`: neither Tamil nor English selected strings contain U+201C/U+201D.

2. In `components/DailyVerseGenerator.tsx`, at the client-side location(s) that currently call `renderVersePoster(bgImg, logoImg, { primaryText, primaryRef, primaryLang, englishText, englishRef, fontStyle, accentColor })`:
   - Before each call, run `selectVersePortionHeuristic()` independently for the primary language's full text and for the English full text.
   - Run `runQualityControl()`.
   - If QC.pass === false on any `*_selected_is_substring_of_full` check, fall back: set that language's displayed portion to the **full** DB verse. Record the fallback reason in `console.warn` in development.
   - Always pass the reference strings in full (never portion-selected).
   - Keep Tamil+English and Telugu+English poster renders separate (one primaryLang=`'ta'`, one primaryLang=`'te'`) — existing code pattern, no structural change, just inject the selected portions and QC gating.

**Status:** pending

**Test Requirements:**
- **TR6.1 (rule, maps AC1, AC2, AC6):** When an intentionally-mangled (non-contiguous) `tamilSelected` is passed into `runQualityControl`, the check `tamil_selected_is_substring_of_full.pass === false` and `QCResult.pass === false`. Evidence: synthetic unit-style call with known inputs.
- **TR6.2 (rule, maps AC3):** `primaryRef` and `englishRef` values reaching `renderVersePoster` are byte-for-byte equal to the full `verses.tamil.reference` / `verses.english.reference` returned from `verse.service.ts`. Evidence: equality assertion in code before rendering.
- **TR6.3 (rule, maps FR9):** `runQualityControl` always returns `QCResult` with at least 4 checks with `rule` strings and boolean `pass` values. Evidence: direct call + property assertion.

**Completion Evidence:** to be recorded.

---

## Task 7: Surface-level verification — build, typecheck, and spot-generate 3 sample posters

**File paths to read first:**
- `package.json` (scripts: build, dev, typecheck/lint if any)
- `tsconfig.json`

**Work:**
1. Run the project's TypeScript type-check or production build command.
2. If diagnostics exist from the TypeScript compiler or the GetDiagnostics tool, fix them (typically unused imports, missing references to the new `ai/versePortionSelector.ts` module exports, or type mismatches).
3. Start the dev server with the Vite+Express pattern this project uses (see `package.json` scripts), then either manually via UI or via a small throwaway Node script, generate 3 sample posters:
   - Psalm 23:1 (short, should render FULL in both languages)
   - Jeremiah 29:11 (medium-long, should trigger portion selection in EN/TA)
   - A long Psalm (e.g. Psalm 91:1-2 or a multi-verse reference from the DB to verify the behavior on verses with many clauses).
4. Save the 3 PNGs for visual reference (do not commit them — keep them local or in a scratch directory). This step exists only to generate the evidence needed for rubric ACs; the deliverable is code, not images.

**Status:** pending

**Test Requirements:**
- **TR7.1 (rule, maps NFR3, general build health):** `tsc --noEmit` (or project's configured typecheck script) completes with exit code 0 after Task 1–6 code changes.
- **TR7.2 (rule, maps AC8, AC16):** For each of 3 generated posters: text top ≥ TOP_MARGIN, text bottom ≤ height - BOTTOM_MARGIN; vertical block order Tamil→Ref→Divider→English→Ref visible in bilingual renders.
- **TR7.3 (rubric, maps AC7 visual storytelling, threshold ≥ 1.5 / 2):**
  - Score 2: 2/3 posters clearly illustrate their theme (e.g. Jeremiah 29:11 Hope → sunrise/sprout/dove imagery).
  - Score 1: 1/3 posters is generic-but-on-theme-adjacent.
  - Score 0: >1 posters generic/off-theme.
- **TR7.4 (rubric, maps AC18 cinematic quality, threshold ≥ 1.5 / 2):**
  - Score 2: 2/3 backgrounds read as cinematic/professional.
  - Score 1: 2/3 read as "good stock photo" flat but acceptable.
  - Score 0: >1 posters look like illustration/cartoon/low-quality snap.
- **TR7.5 (rubric, maps AC17 subject clearance, threshold ≥ 1.5 / 2):**
  - Score 2: 2/3 posters have no text on focal subject.
  - Score 1: 1 minor overlap across 3.
  - Score 0: >1 poster has text squarely across face/subject.

**Completion Evidence:** to be recorded.
