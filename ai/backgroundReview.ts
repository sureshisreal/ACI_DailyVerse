import { askClaudeVisionForJson } from './claude';

export interface PreReviewComposition {
  passed: boolean;
  clearRegion: 'top' | 'middle' | 'bottom' | 'none';
  bandStats: { band: 'top' | 'middle' | 'bottom'; complexity: number; brightness: number; contrast: number }[];
  reason: string;
  visionSaved?: boolean;
}

const SAMPLE_STEP = 40;
const BYTES_PER_PX_3 = 3;

let visionSavedCount = 0;
let visionDeferredCount = 0;

export function getPreReviewStats(): { visionSaved: number; visionDeferred: number; savingsPct: number } {
  const total = visionSavedCount + visionDeferredCount;
  return {
    visionSaved: visionSavedCount,
    visionDeferred: visionDeferredCount,
    savingsPct: total === 0 ? 0 : Math.round((visionSavedCount / total) * 10000) / 100,
  };
}

function decodePngHeader(buffer: Buffer): { width: number; height: number; valid: boolean } {
  if (buffer.length < 24) return { width: 0, height: 0, valid: false };
  const sigOk =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  if (!sigOk) return { width: 0, height: 0, valid: false };
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  while (offset < buffer.length - 12) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkData = offset + 8;
    if (chunkType === 'IHDR' && length >= 13) {
      width = buffer.readUInt32BE(chunkData);
      height = buffer.readUInt32BE(chunkData + 4);
      bitDepth = buffer.readUInt8(chunkData + 8);
      colorType = buffer.readUInt8(chunkData + 9);
      break;
    }
    offset += 8 + length + 4;
  }
  if (!width || !height || !(colorType === 2 || colorType === 6) || bitDepth !== 8) {
    return { width, height, valid: false };
  }
  return { width, height, valid: true };
}

function decodeJpegHeader(buffer: Buffer): { width: number; height: number; valid: boolean } {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { width: 0, height: 0, valid: false };
  }
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) return { width: 0, height: 0, valid: false };
    let marker = buffer[offset + 1];
    while (marker === 0xff && offset < buffer.length - 2) {
      offset++;
      marker = buffer[offset + 1];
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return { width: 0, height: 0, valid: false };
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (offset + 8 < buffer.length) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height, valid: true };
      }
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0, valid: false };
}

function fastBufferComplexitySample(buffer: Buffer): {
  sampleBandComplexity: [number, number, number];
  sampleBandBrightness: [number, number, number];
  overallComplexity: number;
} {
  const n = Math.min(buffer.length, 300_000);
  const step = Math.max(1, Math.floor(n / 10000));
  let running = 0;
  let prev = buffer[Math.min(100, n - 1)] ?? 0;
  let highs = 0, mids = 0, lows = 0;
  let brightH = 0, brightM = 0, brightL = 0;
  let countH = 0, countM = 0, countL = 0;
  for (let i = 100; i < n; i += step) {
    const cur = buffer[i];
    const delta = Math.abs(cur - prev);
    running += delta;
    if (i < n * 0.33) {
      highs += delta;
      brightH += cur;
      countH++;
    } else if (i < n * 0.66) {
      mids += delta;
      brightM += cur;
      countM++;
    } else {
      lows += delta;
      brightL += cur;
      countL++;
    }
    prev = cur;
  }
  const total = Math.max(1, highs + mids + lows);
  const topC = (highs + (highs > mids * 1.2 ? highs - mids * 0.8 : 0)) / total;
  const midC = mids / total;
  const botC = (lows + (lows > mids * 1.2 ? lows - mids * 0.8 : 0)) / total;
  const avgBrightness = (a: number, c: number) => c === 0 ? 128 : Math.round(a / c);
  return {
    sampleBandComplexity: [topC, midC, botC],
    sampleBandBrightness: [avgBrightness(brightH, countH), avgBrightness(brightM, countM), avgBrightness(brightL, countL)],
    overallComplexity: running / Math.max(1, Math.floor(n / step)),
  };
}

// IMPORTANT LIMITATION: this operates on raw COMPRESSED file bytes (PNG/JPEG), not decoded pixels
// - there's no image-decoding dependency in this project, so "top/middle/bottom band complexity"
// here really means "complexity of the first/middle/last third of the compressed byte stream," a
// loose proxy at best. It has no way to tell that a subject only 20-25% of the frame's WIDTH (e.g.
// a slim standing figure) still fully occupies a "clear" band, because compressed-byte-position
// carries no real per-row spatial meaning the way posterRenderer.ts's own pixel-based detailGrid
// does (see computeCenterStripRowScores's comment on the same "narrow-but-tall subject dilutes a
// naive average" failure mode). Verified directly: a background generated for Psalm 30:5 (a
// full-height hooded silhouette, head clearly in frame, covering nearly the entire vertical extent)
// shipped with the poster's verse text rendered straight across the figure's head/torso - exactly
// the case this heuristic cannot see. Below, this is still trusted to HARD-FAIL obviously-bad images
// (skip vision, reject) - a false reject just costs a retry with a fresh seed, self-correcting and
// low-risk. It is deliberately no longer trusted to PASS-CLEAR (skip vision, accept) - a false
// accept ships the exact defect above straight to users, so every "looks probably fine" case now
// falls through to the real Claude Vision check below instead of skipping it.
export function preReviewCompositionLocal(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png',
  opts: { requiredRegion?: 'top' | 'any' } = {}
): PreReviewComposition {
  const requiredRegion = opts.requiredRegion || 'top';
  let buffer: Buffer;
  try {
    buffer = Buffer.from(imageBase64, 'base64');
  } catch {
    visionDeferredCount++;
    return { passed: true, clearRegion: 'none', bandStats: [], reason: 'pre-review decode failed, defer to vision' };
  }

  if (buffer.length < 4000) {
    visionSavedCount++;
    return {
      passed: false,
      clearRegion: 'none',
      bandStats: [],
      reason: `pre-review FAIL: tiny image buffer (${buffer.length} bytes) — not a real poster background, short-circuit vision`,
      visionSaved: true,
    };
  }

  const header = mediaType === 'image/png'
    ? decodePngHeader(buffer)
    : decodeJpegHeader(buffer);

  if (header.valid) {
    const aspectRatio = header.height / Math.max(1, header.width);
    if (aspectRatio < 1.1) {
      visionSavedCount++;
      return {
        passed: false,
        clearRegion: 'none',
        bandStats: [],
        reason: `pre-review FAIL: aspect ratio ${aspectRatio.toFixed(2)} (${header.width}x${header.height}) is not portrait — text overlay zone cannot exist, short-circuit vision`,
        visionSaved: true,
      };
    }
  }

  const { sampleBandComplexity, sampleBandBrightness, overallComplexity } = fastBufferComplexitySample(buffer);

  const [topC, midC, botC] = sampleBandComplexity;
  const [topB, midB, botB] = sampleBandBrightness;
  const bandStats = [
    { band: 'top' as const, complexity: topC, brightness: topB, contrast: topC },
    { band: 'middle' as const, complexity: midC, brightness: midB, contrast: midC },
    { band: 'bottom' as const, complexity: botC, brightness: botB, contrast: botC },
  ];

  const topQuiet = topC <= 0.25;
  const topModerate = topC <= 0.38;
  const topBusy = topC > 0.45;
  const topVeryBusy = topC > 0.52;
  const botBusy = botC >= 0.42;
  const botVeryBusy = botC >= 0.50;
  const stronglyTopFocused = botC > topC * 1.6;
  const allBandsBusy = topC > 0.38 && midC > 0.38 && botC > 0.38;
  const frameUniformlyNoisy = overallComplexity > 10 && topC > 0.42 && botC > 0.42;

  let clearRegion: 'top' | 'middle' | 'bottom' | 'none' = 'none';
  let passed = true;
  let reason = '';
  let visionSaved = false;

  if (requiredRegion === 'top') {
    if (topVeryBusy && (botVeryBusy || allBandsBusy)) {
      passed = false;
      clearRegion = 'none';
      visionSaved = true;
      reason = `pre-review FAIL: top-band complexity ${topC.toFixed(2)} with all-bands busy (mid=${midC.toFixed(2)}, bot=${botC.toFixed(2)}) — no text zone possible, short-circuit vision`;
    } else if (topVeryBusy && botBusy) {
      passed = false;
      clearRegion = 'none';
      visionSaved = true;
      reason = `pre-review FAIL: top complexity ${topC.toFixed(2)} + bottom busy ${botC.toFixed(2)} — entire frame busy, short-circuit vision`;
    } else if (frameUniformlyNoisy) {
      passed = false;
      clearRegion = 'none';
      visionSaved = true;
      reason = `pre-review FAIL: uniformly noisy frame (overallComplexity=${overallComplexity.toFixed(1)}, top=${topC.toFixed(2)}, bot=${botC.toFixed(2)}) — no calm band anywhere, short-circuit vision`;
    } else if (topBusy && !stronglyTopFocused && botC <= 0.30) {
      passed = false;
      clearRegion = 'none';
      visionSaved = true;
      reason = `pre-review FAIL: top busy ${topC.toFixed(2)} but subject also quiet (bot=${botC.toFixed(2)}) — likely a centered tall silhouette, top zone blocked, short-circuit vision`;
    } else if (topQuiet || stronglyTopFocused) {
      clearRegion = 'top';
      passed = true;
      reason = `pre-review LIKELY-CLEAR: lower bands dominant (bot=${botC.toFixed(2)} > top=${topC.toFixed(2)}); defer to vision to confirm`;
    } else if (topModerate && (stronglyTopFocused || botC >= 0.38)) {
      clearRegion = 'top';
      passed = true;
      reason = `pre-review LIKELY-CLEAR: top complexity ${topC.toFixed(2)} within safe bound + bottom focused ${botC.toFixed(2)}; defer to vision to confirm`;
    } else if (topBusy) {
      clearRegion = 'none';
      passed = true;
      reason = `pre-review INCONCLUSIVE: top complexity ${topC.toFixed(2)} borderline → defer to vision for final call`;
    } else {
      clearRegion = 'top';
      passed = true;
      reason = `pre-review LIKELY-CLEAR: balanced safe complexities (top=${topC.toFixed(2)}, mid=${midC.toFixed(2)}, bot=${botC.toFixed(2)}); defer to vision to confirm`;
    }
  } else {
    if (topQuiet) clearRegion = 'top';
    else if (midC <= 0.25) clearRegion = 'middle';
    else if (botC <= 0.25) clearRegion = 'bottom';
    if (clearRegion !== 'none') {
      passed = true;
      visionSaved = true;
      reason = `pre-review PASS-CLEAR: any-region found clear band=${clearRegion} (top=${topC.toFixed(2)}, mid=${midC.toFixed(2)}, bot=${botC.toFixed(2)}); skip vision`;
    } else if (allBandsBusy || frameUniformlyNoisy) {
      passed = false;
      visionSaved = true;
      reason = `pre-review FAIL: no clear band in any region (top=${topC.toFixed(2)}, mid=${midC.toFixed(2)}, bot=${botC.toFixed(2)}) — uniformly busy, short-circuit vision`;
    } else {
      passed = true;
      reason = `pre-review INCONCLUSIVE: borderline complexities, defer to vision (top=${topC.toFixed(2)}, mid=${midC.toFixed(2)}, bot=${botC.toFixed(2)})`;
    }
  }

  if (visionSaved) visionSavedCount++;
  else visionDeferredCount++;

  return { passed, clearRegion, bandStats, reason, visionSaved };
}

// Composition instructions in ai/analyzer.ts's own image prompt ask the text-to-image model to
// leave a clear half-frame for text overlay, but a hosted free model doesn't reliably honor that -
// verified directly against this app's own output: a generated background with a tall standing
// figure positioned so no half of the frame was actually clear enough, causing the poster's verse
// text to render across the figure regardless of how well the placement algorithm
// (posterRenderer.ts's findEmptiestBand) searches for open space, because no genuinely open band
// tall enough existed anywhere in the image. Placement logic alone can only route text around empty
// space that exists - it can't manufacture space a bad composition never left. This is the second,
// earlier line of defense: an actual look at the generated image before it's accepted at all, so a
// composition like that gets rejected and regenerated with a fresh seed instead of shipped as-is.
//
// Also checks THEME RELEVANCE and CHRISTIAN CONTEXT in the same call (added alongside composition,
// not a separate vision request): ai/themeMapper.ts's per-theme visual concepts and ai/analyzer.ts's
// prompt already push hard toward verse-specific, explicitly Christian imagery, but neither
// guarantees the hosted text-to-image model actually followed that prompt rather than drifting
// toward something generic - this is the actual enforcement, the same "look at what was really
// generated, don't just trust the prompt" principle composition review already applies. Relevance
// and Christian-ness are judged as two SEPARATE questions (an image can be relevant to the verse's
// theme without reading as Christian at all, e.g. a purely secular "person walking a path" for a
// guidance verse) - both must pass, matching "every background must be BOTH Christian and relevant"
// rather than treating one as a substitute for the other.
const COMPOSITION_SECTION_VERTICAL = `COMPOSITION - ZERO OVERLAP DIRECTIVE (suitable/clearRegion/reason):
- The image must have a genuine CLEAN TEXT ZONE: one large, genuinely low-detail, low-clutter, low-contrast contiguous band - occupying at least half the image's total height - completely free of any part of the main subject (a person's silhouette, head, or limbs count as intruding even if only partially crossing into it; so do animals, buildings, or other concrete objects) AND free of competing visual noise (texture, light rays, birds, busy detail) that would fight with overlaid text for attention, even where the subject itself doesn't reach.
- "clearRegion" is whichever contiguous band (top, middle, or bottom third-plus of the frame) is actually a genuine Clean Text Zone, or "none" if no such band exists.
- "suitable" is true only when that zone is real, large (at least half the frame's height), calm/low-clutter, and the subject does not cross into it anywhere - not even partially. Zero overlap, ever, is the standard - not "mostly clear."
- Be strict: a subject whose head, hand, or edge just barely crosses into the otherwise-clear region makes that region unsuitable, and so does a merely "busy-looking" zone even without the subject in it.`;

const COMPOSITION_SECTION_EDITORIAL = `COMPOSITION - SIDE OVERLAP DIRECTIVE (suitable/clearRegion/reason) - this poster's text runs in a LEFT-hand column, not a top band:
- The image must have a genuine CLEAN TEXT ZONE: one large, genuinely low-detail, low-clutter, low-contrast contiguous column running the FULL HEIGHT of the frame on the LEFT side - occupying at least half the image's total width - completely free of any part of the main subject (a person's silhouette, head, or limbs count as intruding even if only partially crossing into it; so do animals, buildings, or other concrete objects) AND free of competing visual noise (texture, light rays, birds, busy detail).
- "clearRegion" is "left" when the left portion of the frame is the genuine Clean Text Zone, "right" if it's actually the right portion instead (the generator sometimes mirrors the composition), or "none" if no such column exists anywhere.
- "suitable" is true only when that column is real, large (at least half the frame's width), calm/low-clutter, runs the full height, and the subject does not cross into it anywhere - not even partially. Zero overlap, ever, is the standard - not "mostly clear." A full head-to-foot human figure confined entirely to the opposite (subject) column is fine here and should NOT be marked unsuitable for having a visible head - that concern only applies to the vertical/top-band layout, not this side-split one.
- Be strict: a subject whose hand, branch, or edge just barely crosses into the otherwise-clear column makes that column unsuitable, and so does a merely "busy-looking" column even without the subject in it.`;

const COMPOSITION_SECTION_CORNER = `COMPOSITION - CORNER DIRECTIVE (suitable/clearRegion/reason) - this poster's CONCRETE subject should sit in a small bottom-right corner, with calm atmosphere everywhere else (the top does NOT need to be literally empty - a soft, low-detail sky or hazy distant landscape there is fine and expected, it just can't have a sharply-detailed concrete element in it):
- Judge two DIFFERENT things separately: calm ATMOSPHERE (open sky, distant soft hills, a hazy low-detail landscape backdrop) is allowed anywhere in the frame, including the top - it only needs to be genuinely calm/low-detail/uncluttered, not literally blank. The CONCRETE SUBJECT (a sharply-detailed foreground element - a person, animal, building, tree with visible texture, rock formation) is what must be confined to a small area.
- The CLEAN TEXT ZONE is the top HALF of the frame's height - "clean" here means calm/low-detail atmosphere, NOT the total absence of any landscape or sky detail. Mark it clear as long as no sharply-detailed concrete subject sits there, even if soft distant scenery is visible.
- The concrete subject must be confined to a SMALL area in the bottom-right corner only - roughly the bottom fifth of the frame's height, right half of its width. The bottom-LEFT corner must be just as free of any sharply-detailed concrete element as the top zone - a concrete subject (or a sharp, texture-heavy landscape) spanning the full width of the bottom, or sitting bottom-left/bottom-center instead of bottom-right, fails this check even if the top is otherwise calm.
- "clearRegion" is "top" when the top band is genuinely calm/uncluttered (regardless of whether the corner placement itself is correct - note that separately in "reason"), or "none" if the top is genuinely busy/sharp throughout.
- "suitable" is true only when BOTH conditions hold: the top half reads as calm atmosphere (soft scenery allowed), AND the one concrete subject is confined to the bottom-right corner specifically (not bottom-left, not centered, not spanning the full width, not a sharp landscape filling the whole frame). Be strict about the corner requirement, but do NOT reject a composition just because a soft, low-detail landscape or sky is visible across the top - that is expected and correct for this layout.`;

const COMPOSITION_SECTION_CENTERED = `COMPOSITION - CENTER-FLANKED DIRECTIVE (suitable/clearRegion/reason) - this poster's text runs in TWO independent columns flanking a centered subject, one language per side - BOTH sides must be clear, not just one:
- The image must have the subject confined to the CENTER of the frame (roughly the middle third of its width, full height), with genuine CLEAN TEXT ZONES on BOTH the left third AND the right third simultaneously - each large enough to hold a full column of text on its own, low-detail, low-clutter, free of the subject and of competing visual noise.
- "clearRegion" is "both" only when BOTH flanking thirds are genuinely clear; "left" or "right" if only that one side is actually clear (the other has the subject bleeding into it, or is otherwise cluttered); "none" if neither side is usably clear.
- "suitable" is true ONLY when "clearRegion" is "both" - a composition that's only clear on one side fails this layout entirely, since text needs to go on both sides at once, not just whichever one happens to be open. Be strict: a subject whose shoulder, hand, or edge crosses into either flanking third - even just one of the two - makes the composition unsuitable, regardless of how clear the other side is.`;

function buildVisionSystemPrompt(layout: 'vertical' | 'editorial' | 'corner' | 'centered'): string {
  const compositionSection = layout === 'editorial' ? COMPOSITION_SECTION_EDITORIAL
    : layout === 'corner' ? COMPOSITION_SECTION_CORNER
    : layout === 'centered' ? COMPOSITION_SECTION_CENTERED
    : COMPOSITION_SECTION_VERTICAL;
  const clearRegionEnum = layout === 'editorial' ? '"left"|"right"|"none"'
    : layout === 'corner' ? '"top"|"none"'
    : layout === 'centered' ? '"both"|"left"|"right"|"none"'
    : '"top"|"middle"|"bottom"|"none"';
  return `You are a visual QA checker for a professional Christian devotional poster app. You will be shown one candidate background photo, along with the Bible verse's theme and intended visual concept. Afterward, Bible verse text (a short reference line, a multi-line quote with one larger emphasized phrase, and often a second-language block below it) gets overlaid on top of this same image.

Respond with ONLY minified JSON, no prose, no markdown fences, in exactly this shape:
{"suitable":true|false,"clearRegion":${clearRegionEnum},"reason":"one short sentence","relevant":true|false,"relevanceReason":"one short sentence","christian":true|false,"christianReason":"one short sentence","proQuality":true|false,"qualityReason":"one short sentence"}

${compositionSection}

PROFESSIONAL QUALITY SCORING (proQuality / qualityReason) - judged as a standalone editorial photograph, SEPARATE from composition and relevance, on the same strict standard as a magazine or National Geographic image would be judged:
- Evaluate the image against these five quality dimensions, ALL of which must pass for proQuality=true:
  1. REALISTIC LIGHTING: Does the scene have a believable, cohesive, single-direction or warm golden-hour / soft-overcast / chiaroscuro light source? No flat even "studio box" lighting, no uncanny fake/AI-looking light rays, no plastic-looking skin or fabrics, no overexposed blown-out pure-white highlights with no detail, no crushed solid-black shadows with no detail. Natural volumetric light, shadows with falloff, and properly exposed highlights/shadows are required.
  2. TANGIBLE TEXTURE: Can you practically FEEL the surfaces in the image from how they're lit? Rough stone grain, linen weave, wool fiber, bread crust texture, bark ridges, leather creases, weathered wood grain, wheat head detail, dust motes in light shafts - there must be actual visible surface texture on the primary subject elements, not smooth plasticky uniform color. No waxy skin, no perfectly smooth CGI stone, no flat solid-colored fabrics with zero weave detail.
  3. NATURAL COLOR SCIENCE & EXPOSURE: Are colors grounded and cinematic (Portra / Ektar film look - warm earth tones, saturated but not cartoonish), or do they look oversaturated neon, washed-out, color-shifted green/purple, or HDR-ugly with halos around edges? No banding in sky gradients, no posterization, no unnatural deep blues, no oversharpened cartoon outlines. Properly exposed: the brightest parts of the sky or a light source should still be soft, not pure blank white clipped highlights.
  4. DEPTH & ATMOSPHERIC PERSPECTIVE: Does the image READ as three-dimensional, with real separation between foreground, mid-ground, and distant background via atmospheric haze, bokeh, or progressively softer detail? Or does everything look like it's on the same flat plane (a telltale AI diffusion artifact)? A pro image has clear foreground subject, mid-ground environment, and distant background with haze/softness between them - even in "flat" compositions like a tabletop still life, there's near-to-far depth via focus falloff.
  5. NO AI-LOOKING ARTIFACTS: This is a hard-fail dimension if ANY of these are visible: fused/missing/extra fingers on any hand, distorted anatomy (extra limbs, floating limbs, fused faces, impossible body proportions), floating objects with no shadow, repeating tiled textures on stone or walls, unnatural blur patches that don't correspond to focus depth, watermark or signature scribbles, letter/number shapes accidentally embedded in stone or wood grain, symmetrical mirroring in a non-symmetric scene, and no "glowing cross floating in sky / generic heavenly light explosion" clichés standing in for actual scene lighting.
- proQuality is true ONLY when all five dimensions above pass on their own merits, regardless of how good the composition or theme relevance is. A beautiful composition with plastic-looking skin or no surface texture or banded skies still fails pro quality - these are the exact issues that make generated posters look "cheap" and not like the professional reference editorial posters the app is trying to match.
- If proQuality=false, qualityReason must state WHICH of the five dimensions failed, with one specific visible example: e.g. "fused fingers on left hand (dimension 5 fail)" / "no texture on stone wall, perfectly smooth (dimension 2 fail)" / "flat no-depth composition, foreground and background equally sharp (dimension 4 fail)" / "oversaturated neon green on trees, unnatural color (dimension 3 fail)" / "flat even shadowless lighting, no single light direction (dimension 1 fail)".

RELEVANCE (relevant/relevanceReason) - judged independently of composition:
- Ask yourself: "If the Bible verse text were removed, would this image still communicate something related to this specific verse's theme and visual concept - or could it be dropped onto almost any unrelated devotional poster without anyone noticing?"
- "relevant" is true only when the image's actual subject, action, or setting genuinely matches the given theme/visual concept - not merely "looks spiritual" or "looks nice." A beautiful but generic landscape, an unrelated figure, or an object matching the wrong theme should be marked false.
- "relevant" is false if the image is a generic/stock-feeling religious scene (plain cross, open Bible, praying hands, empty church, plain sunrise) that was NOT specifically called for in the given visual concept.
- The image generator frequently drops most of a detailed visual concept and renders only a plain, unremarkable fragment instead (e.g. concept describes "hands open in gratitude on ancient stone, tears catching golden light, olive grove around them" but the actual image is just a hand resting on a textured rock, nothing else from the concept present). Compare against the SPECIFIC nouns and gesture in "visual concept," not just its general mood - a hand touching a rock, wall, wood, or other surface with no distinguishing gesture, emotion, or setting from the concept is NOT a match just because a hand and a surface are technically present, even if that surface has interesting texture or cracks that make the photo look deliberate.
- Do this as an explicit TWO-PART checklist - BOTH parts must pass, independently:
  Part A - Concept-noun coverage: list out the concept's distinguishing nouns/gestures (e.g. for "hands open in gratitude on ancient stone, tears catching golden light, olive grove around them" that's: open/palms-up gesture, tears, olive grove/trees, kneeling or seated posture). Count how many are actually visible in the image. If fewer than half are present, mark relevant false regardless of how visually polished the image looks.
  Part B - Christian-marker requirement (NON-NEGOTIABLE, even when Part A passes 50%+): among all the concept items that DID match in Part A, AT LEAST ONE of those matches must be an unambiguous explicitly-Christian marker from the concept. Acceptable Christian markers: a prayer or worship posture (hands folded/in prayer, head bowed in devotion, hands raised in worship, kneeling in supplication), an open Bible or Scripture being read, a biblical garment (robes, tunic, shepherd's cloak, period attire from a biblical-era setting), a biblical narrative setting (tomb at sunrise, stone rolled away, baptismal water, Passover table, synagogue or first-century home interior), or a church/community fellowship scene (people gathered for study, communion elements being shared). NOT acceptable as the required marker for Part B: a generic non-Christian-looking landscape or nature scene, an unmarked anonymous person with no prayer/worship gesture or biblical clothing, a plain interior room with no Bible or faith context, a sunrise with no worship/prayer context, or isolated non-narrative religious iconography (a plain lone cross, standalone glowing light rays, empty sky) unless that exact iconography was the concept's EXPLICIT sole subject and narrative focus rather than incidental background.
- The 50% threshold from Part A is NOT sufficient on its own. An image can match 75% of the concept's nouns and still fail relevance if none of those matched items include the required explicit Christian marker from Part B - this is the exact false-positive guard: a generic hiker on a dawn trail with a backpack matches "dawn light, path, figure" nouns from a guidance concept (50%+), but without the prayer posture, Bible, or biblical garment being one of those matches, it's still just a generic wellness poster, not a devotional image, and must be marked false.
- Being strict here matters more than being lenient - a false positive ships a poster whose image doesn't actually say anything about its own verse or its Christian identity.

CHRISTIAN CONTEXT (christian/christianReason) - a SEPARATE question from relevance, both must pass:
- "christian" is true only when the image contains an unmistakable Christian/Biblical marker: a person or family engaged in prayer, worship, Scripture reading, fellowship, or an act of Christian love/service; a biblical-era person, garment, or narrative setting; a church/community scene; or (only for verses genuinely about God's creation/majesty) grand nature imagery clearly framed as creation.
- "christian" is false for a scene that could belong to ANY generic wellness/lifestyle/nature poster with zero specifically Christian character - e.g. an unmarked person silhouetted on a path, an anonymous hiker, a plain sunrise with no worship context, generic scenery with no person or biblical marker at all.
- "christian" is ALSO false for lazy generic religious clichés used with no narrative reason: a plain glowing cross, an unrealistic/fantasy depiction of Jesus or God, generic heavenly clouds/light rays standing in for a real scene, or an anonymous praying figure with no context.
- "christian" is AUTOMATICALLY false, no exceptions, for any image with revealing/low-cut clothing, exposed cleavage, a seductive pose, or glamour/fashion-editorial styling - this is never appropriate for a devotional poster regardless of how the rest of the scene reads, and takes priority over every other consideration in this check.
- Be strict - "feels peaceful/spiritual" is not the same as "recognizably Christian."`;
}

export interface BackgroundReview {
  suitable: boolean;
  clearRegion: 'top' | 'middle' | 'bottom' | 'left' | 'right' | 'both' | 'none';
  reason: string;
  relevant: boolean;
  relevanceReason: string;
  christian: boolean;
  christianReason: string;
  proQuality: boolean;
  qualityReason: string;
}

const CLEAR_REGIONS = new Set(['top', 'middle', 'bottom', 'left', 'right', 'both', 'none']);

// Best-effort: any failure here (no API key, network error, malformed reply) is treated as "can't
// vouch for this one" rather than blocking poster generation on a QA step being reachable - callers
// fall back to accepting the image, same philosophy as ai/analyzer.ts's Claude-analysis fallback.
// theme/visualConcept: the verse's own theme label and intended visual concept (see
// ai/themeMapper.ts) - given to the reviewer so "relevant" is judged against what this specific
// verse's image was actually supposed to show, not guessed blindly from the photo alone.
export async function reviewBackgroundComposition(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png',
  theme?: string,
  visualConcept?: string,
  // 'editorial'/'centered': left/right (or dual-side) poster styles (see posterRenderer.ts's
  // renderEditorialPoster/renderCenteredPoster). The local pre-review below only has meaning as a
  // rough top/middle/bottom split of the compressed byte stream (PNG/JPEG store scanlines
  // top-to-bottom) - it has no way to represent a left/right split, so these two always go straight
  // to the real Vision check instead of ever being pre-review-skipped. 'corner' keeps using the
  // local pre-review (still fundamentally a top-band check, same as 'vertical').
  layout: 'vertical' | 'editorial' | 'corner' | 'centered' = 'vertical'
): Promise<BackgroundReview & { preReview?: PreReviewComposition }> {
  const pre = (layout === 'editorial' || layout === 'centered')
    ? { passed: true, clearRegion: 'none' as const, bandStats: [], reason: `${layout} layout - local pre-review has no left/right concept, always deferring to vision`, visionSaved: false }
    : preReviewCompositionLocal(imageBase64, mediaType, { requiredRegion: 'top' });
  const stats = getPreReviewStats();
  if (!pre.passed) {
    console.warn(
      `[Review] pre-review hard-fail → short-circuit Vision API (cumulative savings: ${stats.visionSaved} calls, ${stats.savingsPct}%). ${pre.reason}`
    );
    return {
      suitable: false,
      clearRegion: 'none',
      reason: pre.reason,
      relevant: false,
      relevanceReason: 'pre-review hard-fail on composition — not sent to vision',
      christian: false,
      christianReason: 'pre-review hard-fail on composition — not sent to vision',
      proQuality: false,
      qualityReason: 'pre-review hard-fail on composition — not sent to vision',
      preReview: pre,
    };
  }
  if (pre.visionSaved && pre.clearRegion !== 'none') {
    console.info(
      `[Review] pre-review PASS-CLEAR → short-circuit Vision API composition check (cumulative savings: ${stats.visionSaved} calls, ${stats.savingsPct}%). ${pre.reason}`
    );
    return {
      suitable: true,
      clearRegion: pre.clearRegion,
      reason: pre.reason,
      relevant: true,
      relevanceReason: 'pre-review confident clear pass — relevance deferred to prompt-based assurance',
      christian: true,
      christianReason: 'pre-review confident clear pass — Christian context deferred to prompt-based assurance',
      proQuality: true,
      qualityReason: 'pre-review confident clear pass — quality deferred to prompt-based assurance',
      preReview: pre,
    };
  }
  try {
    const context = theme || visualConcept
      ? `Evaluate this background photo for Bible-verse text-overlay suitability, theme relevance, and pro-level photographic quality. Verse theme: ${theme || '(unspecified)'}. Intended visual concept: ${visualConcept || '(unspecified)'}. Local pre-review scan: ${pre.reason}.`
      : 'Evaluate this background photo for Bible-verse text-overlay suitability and pro-level photographic quality. No theme/visual-concept context was given, so judge relevance as whether the image reads as a deliberate, specific devotional scene rather than a generic stock photo.';
    const raw = await askClaudeVisionForJson(
      buildVisionSystemPrompt(layout),
      imageBase64,
      mediaType,
      context,
      350
    );
    const clearRegion = CLEAR_REGIONS.has(raw?.clearRegion) ? raw.clearRegion : 'none';
    return {
      suitable: raw?.suitable === true,
      clearRegion,
      reason: typeof raw?.reason === 'string' ? raw.reason : '',
      relevant: raw?.relevant === true,
      relevanceReason: typeof raw?.relevanceReason === 'string' ? raw.relevanceReason : '',
      christian: raw?.christian === true,
      christianReason: typeof raw?.christianReason === 'string' ? raw.christianReason : '',
      proQuality: raw?.proQuality === true,
      qualityReason: typeof raw?.qualityReason === 'string' ? raw.qualityReason : '',
      preReview: pre,
    };
  } catch (err: any) {
    console.warn('Background composition review unavailable, accepting image as-is:', err?.message || err);
    return {
      suitable: true, clearRegion: 'none', reason: 'Review unavailable',
      relevant: true, relevanceReason: 'Review unavailable',
      christian: true, christianReason: 'Review unavailable',
      proQuality: true, qualityReason: 'Review unavailable',
      preReview: pre,
    };
  }
}
