import type { VerseAnalysis, FontStyleKey } from '../types';
import { getThemeSpec, detectTheme } from './themeMapper';
import type { BibleThemeKey, PosterLayout } from './themeMapper';

// Bump whenever the prompt or validation rules below change materially, so cache keys (which
// include this) invalidate old entries after a code change rather than only after a data change.
// Version 12: Pro-quality cinematic upgrade - enhanced visual concepts with reference-level
// storytelling (bread-sharing documentary realism, desert olive tree landscape, golden wheat
// field pastoral, warrior-on-horseback epic), specific focal-length lens specifications per
// theme, upgraded figure-free fallbacks matching reference composition patterns, strengthened
// vision review with pro-quality lighting/texture/composition scoring, and enriched negative
// prompts against common AI artifacts that reduce realism.
// Version 13: Fixed every Shorts background converging on the same warm golden-hour look
// (reported directly from the YouTube Studio Shorts grid - many different verses all reading as
// the same photo). Root cause: ai/analyzer.ts's rule 8 "technique cheat sheet" offered exactly
// one fixed color grade per emotional register, and 3 of its 4 registers were warm gold/amber/
// orange with no cool or neutral alternative - so nearly every verse (comfort, love, healing,
// peace, hope, creation, salvation, triumph all funnel through those 3) landed on the same
// palette regardless of the verse's own imagery. Rule 8 now lists several grade options per
// register (including genuinely cool/neutral ones) for Claude to pick from based on the verse's
// own wording, and a new rule 9 explicitly instructs against defaulting to golden-hour warmth.
// Version 14: v13's "please vary the grade, pick from this list" instruction alone was verified
// directly against live Claude output and did NOT work - 6 of 7 test verses across different
// themes still came back with a warm amber/gold grade regardless. Replaced the soft instruction
// with a concrete per-verse ASSIGNED grade (themeMapper.ts's pickColorGrade, deterministic hash
// of the verse text so repeats stay stable) handed to Claude in the userPrompt as a specific
// instruction to follow - the same pattern already used for the theme/visualConcept hints, which
// Claude reliably does follow. Also threads the same assignment into the no-Claude static
// fallback path via buildStandardizedPrompt's new colorGradeOverride param.
// Version 15: The new 'editorial' layout's composition rule (subject-right/text-left) was verified
// directly against real generation logs to be the single most commonly violated instruction in the
// whole pipeline - 4 of 5 background attempts for one verse placed the subject on the LEFT or in
// the CENTER despite the rule explicitly saying RIGHT, something the vertical (subject-bottom)
// layout has no equivalent failure mode for. Strengthened rule 6's editorial wording (explicit "NOT
// left, NOT center" negation, repeated emphasis, required to state "right" in both "composition"
// and "prompt" rather than leaving the side implicit) and the matching themeMapper.ts placement
// clause + negative-prompt terms. Bumped so the John 14:27 analysis already cached under the
// weaker v14 editorial wording gets regenerated rather than silently reused.
// Version 16: Added two more Poster layouts, 'corner' and 'centered' (see
// ai/themeMapper.ts's pickPosterLayoutForTheme), auto-selected per verse theme alongside the
// existing 'editorial'. 'corner' initially failed 5/5 review attempts for a Genesis 1:1 (Creation
// theme) test - verified directly - because it asked to confine an entire wide landscape to a
// small corner, which a landscape structurally can't do. Fixed by distinguishing calm ATMOSPHERE
// (may fill the whole frame, including the top, as long as it stays low-detail) from the CONCRETE
// SUBJECT (the only thing that must be corner-confined). Bumped so that verse's cached failure
// doesn't get silently reused under the old wording.
// Version 17: validateClaudeAnalysis's composition-guarantee safety net was appending a hardcoded
// VERTICAL (top/bottom) guarantee onto every analysis regardless of the actual layout - confirmed
// directly against a real Psalm 23:1 'editorial' analysis, whose Claude-written prompt correctly
// said "right third... left two-thirds open" but still got a contradictory "confined to the bottom
// 25%-45%, nothing above the midline" guarantee appended, because the old trigger-word guard was
// vertical-shaped and didn't recognize Claude's valid editorial phrasing. Now layout-aware (see
// COMPOSITION_PLACEMENT_GUARANTEE_BY_LAYOUT / COMPOSITION_GUARANTEE_TRIGGER_WORDS). Bumped so every
// non-vertical layout's cached analyses (which may carry this same contradiction) regenerate.
// Bumped to 18: "prompt" is now a short, front-loaded description (subject/crop/props first, under
// ~110 words, crops described positively) with a short quality suffix, instead of ~200 words where
// the image model dropped or under-weighted the verse-specific details - see ai/analyzer.ts rule 7.
export const CLAUDE_ANALYZER_VERSION = 18;

const REQUIRED_STRING_FIELDS: (keyof VerseAnalysis)[] = ['theme', 'emotion', 'viewerSituation', 'emotionalHook', 'visualConcept', 'composition', 'prompt', 'negativePrompt'];

// Manipulative/misleading patterns the hook must never use, regardless of how compelling they'd be
// - checked defensively here (not just prompted against in ai/analyzer.ts) since a single bad hook
// reaching a real viewer is a real integrity problem, not just an off-brand one. Falls back to a
// plain, honest restatement of the theme rather than blocking generation over it.
const BANNED_HOOK_PATTERNS = [/sent this (message |verse )?specifically to you/i, /god will (punish|curse)/i, /you won'?t believe/i, /watch (this|till the end) or/i];

const GENERIC_NEGATIVE_DEFAULTS = 'text, typography, letters, words, watermark, logo, signature, caption, blurry, low quality, distorted anatomy, extra limbs, duplicate subjects, illustration, cartoon, anime, 3d render, cgi, painting, clipart, amateur photo, snapshot, distorted face, ugly, deformed, extra fingers, oversharpened, oversaturated, plastic skin, waxy texture, uncanny valley, fake lighting, flat lighting, no depth, washed out, high iso noise, jpeg artifacts, banding, posterization, bad hands, fused fingers, missing fingers, mutated hands, malformed limbs, floating limbs, disconnected limbs';

// Appended to "prompt" whenever Claude's own wording doesn't already read as cinematic/professional
// - guarantees every background request carries these quality cues regardless of how closely a
// given Claude response followed ai/analyzer.ts's styling rules.
// Kept short on purpose (was ~100 words of camera/film-stock names): it is appended after Claude's
// own prompt, and every extra word here pushes the verse-specific subject/composition further from
// the front, where image models weight the prompt most.
const CINEMATIC_QUALITY_SUFFIX = 'cinematic film still, photorealistic, natural light, fine film grain, shallow depth of field, professional photography';

// The fixed set of poster typeface pairings the system may choose from - see
// components/posterRenderer.ts's FONT_STYLE_PRESETS for what each key actually renders as. A fixed
// enum (not a freeform font name) so an unloaded/invalid family never silently falls back to a
// system font.
export const FONT_STYLE_KEYS: FontStyleKey[] = ['classic-serif', 'delicate-serif', 'engraved-display', 'decorative-warm'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Deterministic last-resort visual direction when Claude is unavailable/unconfigured - never blocks
// poster generation on AI being reachable. Uses the standardized themeMapper templates so even
// this fallback produces verse-relevant visuals when keyword detection can run on the verse text.
export function staticFallbackAnalysis(
  english: string = '',
  tamil: string = '',
  telugu: string = '',
  // Used by the rare double-failure path where BOTH Claude analysis and its own internal static
  // fallback (ai/analyzer.ts's staticFallbackAugmented) are unreachable for /verse/analyze-poster -
  // see server/routes/verse.routes.ts. Swaps the placement clause to match whichever renderer the
  // caller resolved for this verse (renderEditorialPoster/renderCornerPoster/renderCenteredPoster)
  // instead of always the vertical one.
  layout: 'vertical' | 'editorial' | 'corner' | 'centered' = 'vertical'
): VerseAnalysis {
  let themeKey: BibleThemeKey = 'GENERIC';
  if (english || tamil || telugu) {
    try {
      themeKey = detectTheme(english, tamil, telugu).themeKey;
    } catch {
      themeKey = 'GENERIC';
    }
  }
  const spec = getThemeSpec(themeKey);
  const composition = spec.compositionPattern;
  const visualConcept = spec.visualConcepts[0];
  const subjectPlacementHint = composition.toLowerCase();
  let placementClause = '';
  if (layout === 'editorial') {
    placementClause = 'subject confined to the right 35% of the frame\'s width only, tightly grouped; the left 60% of the frame is wide open uncluttered sky or a soft blurred simple backdrop, completely empty of any subject or object - kept deliberately low-detail and smooth, ample negative space reserved for text overlay in a left-hand column';
  } else if (layout === 'corner') {
    placementClause = 'the one sharply-detailed concrete subject confined to a small area in the bottom-right corner only (roughly the bottom 20% of height, right half of width) and nowhere else; calm soft low-detail atmosphere (sky, hazy distant landscape) may extend across the rest of the frame including the top, it does not need to be literally empty - just calm and uncluttered - reserved for text overlay';
  } else if (layout === 'centered') {
    placementClause = 'subject confined to the center 30% of the frame\'s width only, full height, tightly grouped; both the left third and the right third of the frame are wide open uncluttered sky or a soft blurred simple backdrop, completely empty of any subject or object on either side - kept deliberately low-detail and smooth, ample negative space reserved for text overlay on both sides at once';
  } else if (subjectPlacementHint.includes('upper') && subjectPlacementHint.includes('text')) {
    placementClause = 'subject fills the lower half of the frame only, tightly grouped; the entire upper half of the frame is wide open uncluttered sky or a soft blurred simple backdrop, completely empty of any subject, horizon, or object - kept deliberately low-detail and smooth, ample negative space reserved for text overlay';
  } else {
    placementClause = 'subject confined to the lower third / lower half of the frame only, tightly grouped; the upper two-thirds of the frame are wide open uncluttered sky or soft blurred simple atmosphere, completely free of any subject, horizon clutter, or objects - kept deliberately low-detail to serve as clean negative space for text overlay';
  }
  const prompt = `${visualConcept} - ${spec.cinematicPromptBase} - ${placementClause} - ${CINEMATIC_QUALITY_SUFFIX}`;
  return {
    themeKey,
    theme: spec.label,
    emotion: spec.emotion,
    viewerSituation: spec.viewerSituation,
    emotionalHook: spec.emotionalHook,
    visualConcept,
    composition,
    prompt,
    negativePrompt: GENERIC_NEGATIVE_DEFAULTS,
    fontStyle: spec.fontStyle,
    accentColor: spec.accentColor,
    provider: 'static-fallback'
  };
}

// Appended to prompt when Claude's own prompt text doesn't already carry an explicit, quantified
// composition instruction. This mirrors BACKGROUND_RETRY_COMPOSITION_OVERRIDE in verse.routes.ts
// but as a prompt-time guarantee rather than a retry-time escalation: hosted text-to-image
// models follow quantified placement directives far more reliably than soft descriptive ones.
//
// Per-layout, NOT a single constant: this used to be one hardcoded vertical (top/bottom) guarantee
// appended unconditionally regardless of which layout was actually requested. Confirmed directly
// against a real 'editorial' (left/right) analysis for Psalm 23:1: Claude's own prompt correctly
// described "positioned in the right third... left two-thirds open", but that phrasing didn't match
// any of the (vertical-shaped) trigger words below, so the guard fired and appended THIS vertical
// guarantee text ("confined to the bottom 25%-45%... nothing crosses the vertical midpoint") onto an
// editorial prompt - two flatly contradictory composition directives in one prompt sent to the image
// model. Fixed by keying this off the same `layout` the rest of the pipeline already threads through.
const COMPOSITION_PLACEMENT_GUARANTEE_BY_LAYOUT: Record<PosterLayout, string> = {
  vertical: 'COMPOSITION GUARANTEE: the entire subject (any person, animal, object, building, or tree) is confined strictly to the bottom 25% - 45% of the frame only. The upper 55%+ is completely open and empty: plain sky, distant softly-blurred backdrop, or a smooth uniform gradient. Absolutely no tall silhouette, head, shoulder, hand, building, tree, or any object crosses above the vertical midpoint (50% line) of the image. Subject fills the lower zone to a PRO level: no tiny subject lost in space, no cramped edges, a deliberate and intentional composition that frames the scene like a professional editorial poster, not a thumbnail.',
  editorial: 'COMPOSITION GUARANTEE: the entire subject (any person, animal, object, building, or tree) is confined strictly to the RIGHT 25% - 45% of the frame\'s width only, on the right-hand side, NOT the left and NOT the center. The LEFT 55%+ of the frame (its full height) is completely open and empty: plain sky, distant softly-blurred backdrop, or a smooth uniform gradient. Absolutely no part of the subject - not a hand, branch, or shadow - crosses left of that vertical dividing line. Subject fills the right-hand zone to a PRO level: no tiny subject lost in space, no cramped edges, a deliberate and intentional composition that frames the scene like a premium devotional print, not a thumbnail.',
  corner: 'COMPOSITION GUARANTEE: distinguish calm ATMOSPHERE (open sky, distant soft hills, a smooth gradient - may fill the entire frame including the top, as long as it stays low-detail and uncluttered) from the CONCRETE SUBJECT (any single sharply-detailed foreground element - a person, animal, building, or tree with visible texture), which must be confined SPECIFICALLY to a small area in the bottom-right corner only (roughly the bottom 20% of height, right half of width) and nowhere else in the frame. The top 50% must have no sharply-detailed concrete element at all. Subject fills that corner zone to a PRO level: no tiny subject lost in space, a deliberate and intentional composition that frames the scene like a professional editorial poster, not a thumbnail.',
  centered: 'COMPOSITION GUARANTEE: the entire subject (any person, animal, object, or symbolic item) is confined strictly to the CENTER 30% of the frame\'s width, full height, tightly grouped. BOTH the left 30%-35% and the right 30%-35% of the frame are completely open and empty: plain sky, distant softly-blurred backdrop, or a smooth uniform gradient, since text will be placed independently in both flanking columns at once. Absolutely no part of the subject crosses into either the left third or the right third. Subject fills the center column to a PRO level: no tiny subject lost in space, a deliberate and intentional composition that frames the scene like a professional editorial poster, not a thumbnail.',
};

// Per-layout trigger phrases that indicate Claude's own prompt text already carries an adequate
// quantified placement directive for THAT layout, so the (correctly-matching) guarantee above would
// be redundant. Deliberately layout-specific - the old single vertical-shaped trigger list ("upper",
// "completely open", "reserve") is exactly what missed Claude's valid editorial phrasing above.
const COMPOSITION_GUARANTEE_TRIGGER_WORDS: Record<PosterLayout, string[]> = {
  vertical: ['completely open', 'upper', 'reserve', 'composition guarantee'],
  editorial: ['right third', 'right side', 'right-hand', 'right 2', 'right 3', 'right 4', 'composition guarantee'],
  corner: ['bottom-right', 'bottom right', 'composition guarantee'],
  centered: ['center column', 'both sides', 'flanked', 'composition guarantee'],
};

// Validates/coerces Claude's raw JSON reply into a well-formed VerseAnalysis - malformed or missing
// fields fall back to the static defaults for just that field rather than propagating bad data into
// the image-generation prompt. Theme key is always computed deterministically from the actual verse
// text (never from Claude) so every poster has a consistent, verse-grounded visual theme.
export function validateClaudeAnalysis(
  parsed: any,
  english: string = '',
  tamil: string = '',
  telugu: string = '',
  layout: PosterLayout = 'vertical'
): VerseAnalysis {
  const fallback = staticFallbackAnalysis(english, tamil, telugu);
  let themeKey: BibleThemeKey = fallback.themeKey;
  try {
    themeKey = detectTheme(english, tamil, telugu).themeKey;
  } catch {
    themeKey = fallback.themeKey;
  }
  const themeSpec = getThemeSpec(themeKey);
  const result: any = {
    provider: 'claude',
    themeKey,
  };
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = parsed?.[field];
    if (field === 'theme') {
      result[field] = typeof value === 'string' && value.trim() ? value.trim() : themeSpec.label;
    } else {
      const fallbackVal = (fallback as any)[field];
      result[field] = typeof value === 'string' && value.trim() ? value.trim() : fallbackVal;
    }
  }
  // Always ensure the mandatory "no text in the image" / "no illustration" negative terms are
  // present even if Claude's own negativePrompt omitted them - hard requirements (see
  // ai/analyzer.ts's prompt), not something to leave to chance on a single model call.
  const mustHave = ['text', 'typography', 'watermark', 'logo', 'illustration', 'cartoon', 'cgi', 'low quality', 'blurry', 'distorted'];
  const lowerNeg = String(result.negativePrompt).toLowerCase();
  const missing = mustHave.filter((term) => !lowerNeg.includes(term));
  if (missing.length) {
    result.negativePrompt = `${result.negativePrompt}, ${missing.join(', ')}`;
  }

  // Same guarantee for the positive side: every background request reads as cinematic/professional
  // regardless of how closely Claude's own wording followed the styling rules.
  const lowerPrompt = String(result.prompt).toLowerCase();
  if (!lowerPrompt.includes('cinematic') || !lowerPrompt.includes('professional')) {
    result.prompt = `${result.prompt}, ${CINEMATIC_QUALITY_SUFFIX}`;
  }
  // Quantified composition guarantee: ensure the prompt explicitly reserves the correct zone as
  // clear negative space for the Scripture overlay, matching whichever layout this analysis was
  // actually generated for. Hosted text-to-image models follow this kind of quantified directive far
  // more reliably than the softer prose Claude produces on its own - see the comment on
  // COMPOSITION_PLACEMENT_GUARANTEE_BY_LAYOUT above for why this must be layout-aware.
  const triggerWords = COMPOSITION_GUARANTEE_TRIGGER_WORDS[layout] ?? COMPOSITION_GUARANTEE_TRIGGER_WORDS.vertical;
  if (!triggerWords.some((word) => lowerPrompt.includes(word))) {
    const guarantee = COMPOSITION_PLACEMENT_GUARANTEE_BY_LAYOUT[layout] ?? COMPOSITION_PLACEMENT_GUARANTEE_BY_LAYOUT.vertical;
    result.prompt = `${result.prompt}. ${guarantee}`;
  }

  // Defensive backstop on top of ai/analyzer.ts's prompt instructions - a hook is user-facing copy
  // that could ship as-is to a real viewer, so a manipulative/misleading pattern slipping through
  // one model call is a real integrity problem worth catching here, not just prompting against.
  if (BANNED_HOOK_PATTERNS.some((re) => re.test(result.emotionalHook))) {
    result.emotionalHook = fallback.emotionalHook;
  }

  // Font/accent: prefer the theme-mapper's deterministic pairing when Claude picked something off,
  // but still honor Claude's selection if it's one of the valid keys (it may have picked up on a
  // nuance the keyword scan missed).
  const parsedFontValid = FONT_STYLE_KEYS.includes(parsed?.fontStyle);
  result.fontStyle = parsedFontValid ? parsed.fontStyle : themeSpec.fontStyle;
  const accentColor = typeof parsed?.accentColor === 'string' ? parsed.accentColor.trim() : '';
  result.accentColor = HEX_COLOR_RE.test(accentColor) ? accentColor : themeSpec.accentColor;

  return result as VerseAnalysis;
}
