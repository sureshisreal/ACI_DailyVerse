# The Apostolic Church of India — Professional Bible Verse Poster Standardization

## Problem
The current poster-generation pipeline produces posters that, while functionally complete, do not yet consistently meet the visual and editorial standard of professionally designed Christian-ministry social-media posters. Specifically:

- Ministry-brand surfaces are not yet fully consistent across the repository (some surfaces use a newer rebrand name while `posterRenderer.ts`'s `MINISTRY_NAME` footer reads `The Apostolic Church of India` and the bundled logo asset is `ACI.png`; user direction is to standardize on the original `The Apostolic Church of India` everywhere).
- Long Bible verses are rendered in their entirety, which on a 9:16 mobile poster produces dense, hard-to-absorb blocks of text instead of a quick-impact message.
- The editorial step of selecting a meaningful, grammatically-complete portion of a long verse (the single clause or half-verse that carries the central promise) does not exist; the poster paints whatever the DB returned.
- The quality-control gates (Bible accuracy, Tamil↔English correspondence, reference correctness, composition suitability) are reactive fallbacks rather than deterministic pipeline checks with recorded evidence.
- While the image-generation prompt already asks for cinematic quality and the placement renderer already searches for empty bands, several knobs (cinematic suffix enforcement, quantified lower-frame-only subject guarantee, accent-color clamping range, Tamil glyph readability) need tightening so *every* output, not just the average case, lands at ministry standard.

This spec locks the pipeline end-to-end to the user's nine-point poster standard so every generated Tamil↔English and Telugu↔English bilingual poster consistently reads as a premium The Apostolic Church of India deliverable.

## Users
- **Primary:** The Apostolic Church of India social-media content producers generating 1–20 bilingual posters per session in the SPA UI.
- **Secondary:** YouTube Shorts / Meditation-Video pipeline, which reuses the same poster renderer and background image for still-frames and thumbnails.

## Goals
1. **Verse → Visual Concept:** Every background image is deterministically tied to the verse's actual message via the 20-theme `themeMapper` classifier, with a Claude-augmented layer that never falls back to a generic "religious" scene.
2. **Impactful verse display:** For verses above a word-count threshold, the poster displays the most meaningful continuous grammatical portion (approx. half the verse or the core promise clause) instead of the full text, never paraphrasing, always quoting the exact translation, and always retaining the Bible reference.
3. **Cinematic visual standard:** Background reads as a professional cinematic film still / editorial photograph, with quantified subject placement confined to the lower 25–45 % of the frame, upper area kept deliberately empty for text.
4. **Typography hierarchy:** Tamil primary → Accent-script reference → Flourish divider → English secondary with hero-word emphasis → English reference, at the established hero scales (Tamil 2.15, English 1.55), references in flowing script faces, no curly quotes around verse text, Tamil glyphs correctly shaped and high-contrast.
5. **Brand identity:** Every poster carries The Apostolic Church of India brand in a consistent location and treatment — the ACI logo badge top-left, the Instagram-gradient icon plus `THE APOSTOLIC CHURCH OF INDIA` (letter-spaced Lato 700, title-cased) in the gradient footer, the page `<title>` and `Header.tsx` heading all aligned to this same identity, with no stray alternate ministry-brand strings anywhere in the tracked source tree.
6. **Bible accuracy:** No invented verses, no rewrites, Tamil and English selections correspond, the reference is always correct, partial selections are a single continuous meaningful span.
7. **Intelligent composition:** Placement (vertical band + horizontal bias) is derived from real pixel busyness of the generated image, not assumed; text never paints across a face, a focal object, or the subject's silhouette.
8. **Design-system consistency:** Aspect ratio, margins, safe zones, hierarchy scales, accent-color luminance range, divider, footer, and logo size are standardized so the full collection of posters reads as one branded library despite each having a different verse and background.
9. **Quality-control gates:** Deterministic checks for Bible correctness, selection grammaticality, reference matching, and composition are run; Claude-aided review gates also run with a static fallback so failures never block generation.

## Non-Goals
- No support for new languages beyond English, Tamil, Telugu.
- No rewrite of the hosted Pollinations / Picsum image-fetch stack or migration to a local model.
- No changes to the Meditation / YouTube upload pipelines except where they share the poster renderer or analysis output.
- No authoring of user-facing documentation or README updates (project convention: docs are user-request-only).

---

## Functional Requirements

### FR1. Theme-grounded Visual Concept
- Before any image is generated, the verse text (EN + TA + TE) is classified by the deterministic keyword `detectTheme()` classifier into one of the 20 `BibleThemeKey` categories.
- The classifier's result is passed as a strong hint to the Claude analyzer, and `validateClaudeAnalysis()` stamps the final deterministic `themeKey` onto the returned `VerseAnalysis` regardless of any Claude suggestion.
- If Claude is unavailable, `staticFallbackAnalysis()` builds the complete visual from `themeMapper`'s library, again keyed off the deterministic theme key.
- The prompt always ends with both the cinematic quality suffix and the quantified "lower 25–45 % only" composition guarantee.

### FR2. Intelligent Verse-Portion Selection
- A new pipeline step, **Verse Portion Selection**, runs between verse lookup and poster render for every poster-language pair (Tamil block and English block independently).
- **Eligibility:** A verse is eligible for truncation if its word count (space-delimited tokens, Tamil/Telugu grapheme clusters counting as "words" via Unicode segmentation) exceeds an `LONG_VERSE_WORD_THRESHOLD` constant.
- **Selection rules (applied in this priority order):**
  1. Split by the verse's own punctuation (comma, semicolon, colon, full-stop / Tamil। / Telugu।). Prefer the single clause that contains the theme-keyword match (if any) or the closing clause (devotional emphasis convention).
  2. If no punctuation split yields a clause ≥ 3 words, split by word count: retain a continuous ~45–55 % central span, anchored to the clause/keyword match when one exists.
  3. Always verify the selection forms a grammatically and contextually meaningful statement on its own — never cut between a pronoun and its antecedent, between a preposition and its object, or after an article leaving a dangling noun phrase.
  4. Never paraphrase, never drop words non-contiguously. The displayed text is an exact contiguous substring of the DB verse.
- **Fallback for very short verses:** Display the complete verse.
- **Reference is always displayed in full** and never truncated.
- A deterministic heuristic selector is shipped as the primary path; a Claude-helper selector runs only when the heuristic cannot confidently identify a clause boundary (e.g., Telugu DB punctuation absence) and has a 1:1 fallback to the heuristic selector if Claude is unavailable.

### FR3. Cinematic Image & Quantified Composition
- Every prompt carries the cinematic quality tag, the explicit quantified "subject strictly in the bottom 25–45 % only, upper 55 %+ completely empty" guarantee, and the theme-mapper's `cinematicPromptBase` / `compositionPattern`.
- On retry after a composition-review rejection, `BACKGROUND_RETRY_COMPOSITION_OVERRIDE` is appended (already in place) — bump it further: lower the subject cap to "bottom 25 % only" on retry 2+ and include a negative clause against tall silhouettes crossing the upper half.
- `IMAGE_GENERATOR_VERSION` is bumped so cached pre-standard images are invalidated.

### FR4. Typography Hierarchy
- Poster hierarchy (matches project memory and the user's point 4):
  1. **Primary-language block (Tamil or Telugu):** Hero scale 2.15 on the hero clause, steady 700–900 weight body. Exact fonts per the `FONT_STYLE_PRESETS` table.
  2. **Primary reference:** Flowing script face (Great Vibes / Dancing Script fallback chain) in the theme accent color, below the primary verse.
  3. **Flourish divider (if bilingual):** Accent-colored thin lines flanking a diamond, between the two language blocks.
  4. **Secondary (English) block:** Hero scale 1.55 on the hero clause.
  5. **English reference:** Flowing script face in the accent color (or at 0.75 alpha of theme base for the secondary block's "calmer" reference treatment).
- Curly quotes are **never** rendered around Scripture verse body text. The `quoted` flag in the clause builder is always `false` for verse text; it remains available for non-Scripture copy only.
- Tamil (Noto Serif Tamil / Arima Madurai) and Telugu (Noto Serif Telugu) use the 700/900 weight variants already loaded; glyph shaping is correct because the faces are loaded via Google Fonts with the full South Asian subsets. Line height for Tamil/Telugu is tightened slightly (from 1.50 to 1.42 on body, 1.55 → 1.48 on hero) to keep the block visually compact and readable.

### FR5. The Apostolic Church of India Branding (consistent lock across all surfaces)
- `MINISTRY_NAME` in `posterRenderer.ts` is the literal string `The Apostolic Church of India`; the footer renders it as title-case (already the value of `MINISTRY_NAME`) in `700 22px Lato` with `4 px` letter-spacing — no forced ALL-CAPS conversion, since the existing constant already matches the user-specified name.
- **Top-left logo badge:** Circular dark badge with 2 px white stroke, centered 100 px `ACI.png` logo (the bundled asset in `components/`), 60 px corner margin, 24 px shadow-blur.
- **Footer:** Gradient bar `0 → rgba(8,7,6,0) → 40 % rgba(8,7,6,0.78) → 100 % rgba(8,7,6,0.96)`, Instagram-gradient procedural camera icon sized 40 px, 16 px gap between icon and ministry text, text at `rgba(255,255,255,0.94)`.
- Every ministry-name surface in the codebase (`index.html` `<title>`, `Header.tsx` heading, any other string literals) is brought into alignment so **no tracked-source file contains the stray alternate-brand string `Rehoboth Revival Ministries` after implementation**.

### FR6. Bible Accuracy Gate
- Before a `PosterVerseInput` reaches the renderer, a deterministic validator runs:
  1. Reference matches the verse exactly (a SQL re-lookup of the reference returns the same EN/TA/TE text that entered the pipeline).
  2. When a verse portion is selected for Tamil or English, the selected substring is verified to be a **contiguous substring** of the DB text. Case, punctuation, and diacritics are byte-for-byte equal.
  3. The EN and TA selected portions correspond: the word containing the theme keyword (if any) is present in the same relative clause of both languages when the structure allows; if the heuristic cannot confirm this, it is logged and the poster continues rather than blocking.
- Failures on checks 1 or 2 are **blocking**: the pipeline falls back to displaying the complete unmodified DB verse for that language and logs the reason. Check 3 is informational only.

### FR7. Intelligent Composition
- `computeDetailGrid()`, `computeCenterStripRowScores()`, `findEmptiestBand()`, and `horizontalBiasWithinBand()` in `posterRenderer.ts` form the deterministic composition engine. These are already in place; the following adjustments are made:
  - `TOP_BIAS_PER_ROW` is raised from 0.03 to 0.055 so even a marginally-flatter lower band must be noticeably flatter to win over the clearly-empty upper sky.
  - The scrim's feather and weight are tuned: on light themes, a very-light 8 % alpha scrim is kept (previously zero) to protect against a partly-bright band the luminance threshold missed. On dark themes, the 46 % peak scrim is retained.
  - Placement bounds are clamped so text never overlaps the top-left logo badge's 160 px bottom edge (already in place — verified that `TOP_MARGIN = height * 0.10` ≈ 192 px clears the 160 px badge bottom by 32 px).

### FR8. Consistent Design System
- **Aspect ratio:** 1080 × 1920, 9:16. All generated backgrounds are fetched at the same 9:16 ratio and upscaled client-side.
- **Margins / safe zones:**
  - Side margin `SIDE_MARGIN = width * 0.11` (= 118.8 px ≈ 120 px).
  - Top safe zone: clears the logo badge bottom (160 px) + 32 px gap = 192 px.
  - Bottom safe zone: footer 116 px + 40 px gap = 156 px above footer top.
- **Typography scales (already set, restandardized):**
  - Primary base: 42 px × scale, hero 2.15×.
  - Primary ref: 36 px × scale.
  - English base: 40 px × scale, hero 1.55×.
  - English ref: 30 px × scale.
  - Minimum text scale clamp: 0.60.
- **Accent color clamping:** `accentForTheme()` currently clamps saturation to [0.35, 0.90] and lightness to 0.32 (light theme) / 0.68 (dark theme). Saturation floor is raised to 0.45 so the accent never reads as a dull gray on either theme.
- **Divider:** Flourish half-width is `min(MAX_W * 0.22, 160 * scale)`.
- **Footer:** 116 px tall gradient, Y anchor at `height - FOOTER_H + 58` (already in place).

### FR9. Quality Control & Evidence
- A `runQualityControl()` pipeline step is inserted right before `renderVersePoster()` is called in the client component. It returns a typed `QCResult` with per-check pass/fail + reason strings.
- Rule ACs produce evidence strings; rubric ACs produce 0–2 scores + rationale.
- `QCResult` is logged to the console in development; in production this is the evidence a reviewer would inspect. The UI does not surface it unless a blocking check fails, in which case the poster renderer is called with the fallback (full verse) inputs.

---

## Non-Functional Requirements

### NFR1. Backwards Compatibility
- The saved output directory format (manifest.json, poster PNGs named by reference slug) is unchanged; the bulk-mode Save All flow in `manifest.service.ts` is not modified.
- The REST API shapes on `verse.routes.ts` (`/verse/lookup`, `/verse/analyze`, `/verse/save`) are unchanged. The client already sends the full DB verse text through; verse-portion selection is applied client-side before rendering, not in the API.
- Existing cache entries for `CLAUDE_ANALYZER_VERSION` prior to the new version number are invalidated by the version bump.

### NFR2. Resilience
- Every Claude-dependent step (analyzer, Claude-assisted portion selector, background vision review) has a 1:1 deterministic static fallback that requires no API. Generation never blocks on a missing API key or network error.
- A failed or ambiguous verse-portion selection falls back to the full DB verse, never to a best-guess partial.

### NFR3. Performance
- The client-side heuristic verse-portion selector runs in O(verse length) time with no I/O; the optional Claude-assisted path is cached per (reference, language, version).
- Poster total render time is not materially increased by the QC step (canvas-based busyness scan is already O(cols×rows) on a 32×96 grid ≈ 3072 cells).

### NFR4. South Asian Script Correctness
- All Tamil and Telugu renders use Google Fonts Noto variants with the full Indian-script subset (already loaded via the `<link>` in `index.html`).
- No synthetic italics or bolds are ever applied to Tamil/Telugu faces; the loaded 700/900 weights are used explicitly.
- Word-wrap never splits a Tamil/Telugu consonant+vowel cluster: `wrapText()` splits on whitespace only.

### NFR5. No Curly Quotes on Scripture
- The verse-clause builder's `quoted` option is only ever set `true` for hook cards / narration openers, never for Bible verse body. A defensive assertion strips curly-quote characters U+201C, U+201D from any `primaryText` / `englishText` that enters `renderVersePoster()` as a guard against a caller accidentally setting `quoted: true`.

---

## Constraints
- **Scripture immutability:** No code path ever concatenates, rewrites, paraphrases, or reorders words in a Bible verse. The only permitted text transformation for a verse body is to take a contiguous substring of the DB text (and the reference is always shown in full).
- **No inventing verses:** Any input reference that does not resolve in the SQLite DB returns a 404 (already the behavior of `/verse/lookup`); the pipeline never synthesizes a verse.
- **Brand string literal:** The ministry brand rendered on every poster footer (via `MINISTRY_NAME`), referenced in the UI `<title>` / header, and used in any human-facing ministry-name strings is exactly `The Apostolic Church of India` (title-case matches user direction). After implementation, the tracked source tree contains no file with the alternate-brand string `Rehoboth Revival Ministries`.
- **Hosted image stack only:** Pollinations.ai (keyless free tier, with Picsum photos hard-fallback) remains the image source. No new image-generation service is integrated.
- **No new languages.**

## Dependencies
- Existing: `ai/themeMapper.ts` (20-theme classifier, visual concept library, prompt builder).
- Existing: `ai/analyzer.ts` + `ai/schema.ts` (Claude analyzer with static fallback, version bump).
- Existing: `server/services/image-generation.service.ts` (Pollinations + Picsum, cache, mutex, version bump).
- Existing: `components/posterRenderer.ts` (canvas render, busyness grid, placement, footer, Instagram icon, logo badge).
- Existing: SQLite KJV/Tamil/Telugu DBs at `Db/*.db`, lookup via `bibleDb.ts` → `verse.service.ts`.
- Existing: Google Fonts `<link>` in `index.html` for all poster faces.

## Assumptions
- The provided `components/ACI.png` logo is the correct logo asset for The Apostolic Church of India identity; if a newer/larger-resolution logo asset is provided later, swapping it in is a one-file asset replace (no code change beyond the import path if the filename changes) and is out of scope for this code change.
- Tamil and Telugu word-count segmentation for the "long verse" heuristic treats whitespace as the delimiter, matching the existing `splitIntoClauses()` convention.
- The `CLAUDE_ANALYZER_VERSION` and `IMAGE_GENERATOR_VERSION` bumps will cause a one-time cache repopulation on the next run of previously-seen verses, which is the intended behavior.

## Open Questions
None for implementation — all design decisions are resolved by the requirements above. If the user later provides a replacement logo PNG for The Apostolic Church of India, that is a separate follow-up scoped to asset replacement only.

---

## Acceptance Criteria

Every AC below is either a **rule** (objectively verifiable binary pass/fail with observable evidence) or a **rubric** (evaluative 0–2 quality dimension with a threshold).

### Bible Accuracy (FR2, FR6)

- **AC1 (rule):** For any Tamil verse whose DB word count exceeds `LONG_VERSE_WORD_THRESHOLD`, the Tamil text actually painted on the poster is either (a) the exact contiguous substring of the DB Tamil verse chosen by the verse-portion selector, or (b) the full DB Tamil verse when the selector falls back. Evidence: the QC log contains the Tamil selected substring plus a `contiguous_substring_match: true` assertion against the DB verse.
- **AC2 (rule):** For any English verse whose DB word count exceeds `LONG_VERSE_WORD_THRESHOLD`, the English text actually painted on the poster is either (a) the exact contiguous substring of the DB English verse, or (b) the full DB English verse. Evidence same as AC1 for EN.
- **AC3 (rule):** The Bible reference painted on the poster (both primary-language reference line and secondary-language reference line) byte-for-byte equals the reference the user entered and the DB lookup returned. Evidence: QC log `reference_match: true`.
- **AC4 (rule):** Curly-quote characters U+201C and U+201D never appear in the rendered primary-verse or English-verse body on the final poster PNG. Evidence: poster PNG OCR or canvas text-string audit of `primaryLayout` and `englishLayout` paint-line strings contains no curly quote codepoints.

### Theme-grounded Imagery (FR1, FR3)

- **AC5 (rule):** The returned `VerseAnalysis.themeKey` (stamped by `validateClaudeAnalysis`) is always one of the 20 `BibleThemeKey` enum members and equals the result of `detectTheme()` on the same EN/TA/TE triple. Evidence: `themeKey === detectTheme(en, ta, te).themeKey` assertion in the analyzer output.
- **AC6 (rule):** Every image-generation prompt string sent to Pollinations contains the substring `cinematic film still, professional photography` AND a quantified subject-placement clause such as `bottom 25%` or `lower 25% - 45%` AND an upper-frame-empty guarantee such as `upper 55%+ completely open`. Evidence: `analysis.prompt` string contains both substrings after validation by `validateClaudeAnalysis()`.
- **AC7 (rubric, threshold ≥ 1.5 / 2):** Visual storytelling relevance.
  - Score 2: Background scene clearly and concretely illustrates the verse's theme promise (e.g., a provision-verse poster shows bread/harvest/sheep feeding; a peace-verse poster shows still waters / open wheat field at sunset).
  - Score 1: Scene is thematically adjacent but not concretely tied (e.g., a generic warm sunset instead of a specific provision visual).
  - Score 0: Generic or off-theme religious stock imagery (floating crosses, generic stained-glass gradients, unrelated landscapes).
  - Evidence: Three sampled generated posters saved to disk and manually reviewed against their theme-key labels.

### Typography & Hierarchy (FR4, FR8)

- **AC8 (rule):** On a bilingual poster, the vertical paint order is: primary-language clause block → primary reference → flourish divider → English clause block → English reference → footer. No block is reordered or missing. Evidence: visual inspection of the rendered poster or a canvas-call-trace audit of `paintClauseBlock` / divider / reference draw calls in the order specified.
- **AC9 (rule):** Primary-language hero clause font size divided by primary base font size equals 2.15 (±0.01 floating point tolerance). English hero clause font size divided by English base font size equals 1.55 (±0.01). Evidence: `heroFont` string parse of `<weight> <size>px <family>` from `buildClauseBlock()` gives the ratio.
- **AC10 (rule):** Primary-language reference font and English reference font always begin with a script family in the loaded chain: `"Great Vibes"` or `"Dancing Script"` appears before any sans fallback in the CSS `font` string. Evidence: font string inspection of `primaryRefFont` and `englishRefFont` variables.
- **AC11 (rubric, threshold ≥ 1.5 / 2):** Tamil/Telugu glyph rendering readability on mobile.
  - Score 2: Glyphs are correctly shaped (consonant+vowel clusters, ligatures, pulli/anuswara all correct), stroke weight is heavy enough to read against a busy photo even at the 0.6 min scale, line spacing is comfortable without gapping.
  - Score 1: Glyphs correct but at the tightest scale some lines feel dense.
  - Score 0: Mis-shaped clusters, synthetic italic/bold applied to a South Asian script, or lines that collide with the photo subject.
  - Evidence: Tamil poster and Telugu poster each manually reviewed at real-phone size (scaled to 9:16 on a 6" device mockup).

### Branding (FR5)

- **AC12 (rule):** The footer text painted on the poster by `fillTextLetterSpaced()` equals the exact string `The Apostolic Church of India`. Evidence: `ministryText` constant in `posterRenderer.ts` equals this string (same byte-for-byte value as the `MINISTRY_NAME` variable), and the file contains no other competing ministry-name literal used in the footer path.
- **AC13 (rule):** The `<title>` in `index.html`, the `Header.tsx` ministry-name heading, and the footer bar all carry the same `The Apostolic Church of India` brand (no tracked source file contains the string `Rehoboth Revival Ministries` after implementation). Evidence: full-repository grep for `Rehoboth Revival Ministries` (excluding `.git`, `node_modules`, `cache`, `Db`) returns 0 file matches.
- **AC14 (rule):** The footer Instagram icon (procedural) plus ministry-text group is horizontally centered in the 1080 px canvas, the icon is 40 px, gap is 16 px, ministry text is `700 22px Lato` with 4 px letter-spacing. Evidence: `igSize=40`, `igGap=16`, `ctx.font='700 22px Lato, Montserrat'`, and `fillTextLetterSpaced()` spacing=4.

### Composition & Readability (FR7, FR8)

- **AC15 (rule):** For at least 19 out of 20 generated posters in a random sample, the `findEmptiestBand()` algorithm places the text block in a vertical band whose grid-busyness score is the minimum achievable within the scan range (i.e., text does not land on a clearly busier band when a flatter one exists). Evidence: a unit-style replay of the detail-grid search over 20 cached background images, asserting that the chosen band's busyness sum is ≤ every other candidate band's sum.
- **AC16 (rule):** The rendered text block's top edge is never less than `TOP_MARGIN` (≈192 px from canvas top) and its bottom edge is never greater than `height - BOTTOM_MARGIN` (≈1764 px from canvas top / 156 px above the footer's gradient start). Evidence: `curY` start + `totalH` at the end of the render loop satisfy these bounds in code.
- **AC17 (rubric, threshold ≥ 1.5 / 2):** Subject/focal-point clearance.
  - Score 2: In the sampled posters, no verse text paints across a face, a hand, a distinct animal/building silhouette, or the image's obvious focal object. The upper frame has genuinely clear sky/atmosphere.
  - Score 1: One poster in three has a minor edge overlap (e.g., a small branch tip) but no text is illegible.
  - Score 0: Text regularly overlaps the subject's body or face, or the "clear upper area" actually contains a tall subject crossing through it.
  - Evidence: Three sampled posters reviewed manually.

### Cinematic Visual Quality (FR3)

- **AC18 (rubric, threshold ≥ 1.5 / 2):** Cinematic / professional imagery standard.
  - Score 2: Background reads as a cinematic film still / editorial photo with clear lighting direction, a deliberate color grade, visible atmosphere/texture/film-grain cue, subject and background clearly separated by depth.
  - Score 1: Quality is good but flat (adequate photo, no obvious cinematic cues, "nice stock photo" rather than "movie still").
  - Score 0: Illustration, cartoon, CGI look, visible watermarks/text, or distorted anatomy/subjects.
  - Evidence: Three sampled posters reviewed manually.

### Resilience (NFR2)

- **AC19 (rule):** With the Claude API intentionally unavailable (no key), the full pipeline still produces a valid saved poster for every valid DB reference: analyzer uses static fallback, verse-portion selector uses the heuristic path, background review is short-circuited to "suitable=true", image uses Pollinations keyless (flux-schnell default) → Picsum as needed. Evidence: offline-mode smoke test (mocked Claude rejection) produces a PNG poster and a saved manifest entry.
- **AC20 (rule):** `CLAUDE_ANALYZER_VERSION` and `IMAGE_GENERATOR_VERSION` are both strictly greater than their values in the baseline code (7 and 5 respectively). Cache keys that include these constants will invalidate pre-standard entries. Evidence: numeric value assertion in `ai/schema.ts` and `server/services/image-generation.service.ts`.
