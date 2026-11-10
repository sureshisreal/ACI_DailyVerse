import fs from 'fs';
import path from 'path';
import type { VerseAnalysis } from '../types';
import { askClaudeForJson } from './claude';
import { CLAUDE_ANALYZER_VERSION, validateClaudeAnalysis } from './schema';
import { BibleThemeKey, detectTheme, getThemeSpec, pickVisualConcept, pickColorGrade, buildStandardizedPrompt, PosterLayout } from './themeMapper';
import { sha256 } from '../server/utils/hash';

const CACHE_DIR = path.join(process.cwd(), 'cache', 'analysis');

// Rule 6 (composition) is the only layout-dependent part of the system prompt - everything else
// (viewer situation, hook, relevance, Christian-context, image purity, cinematography, variety,
// font/accent picks, final rule) is shared across all four layouts: 'vertical' (subject-bottom,
// text-top - what Video/Meditation frames use, locked to 9:16 for YouTube Shorts), 'editorial'
// (subject-right, text-left), 'corner' (small subject in the bottom-right corner, text spanning the
// top), and 'centered' (subject in the middle column, text flanking both sides at once) - the
// latter three are the Poster feature's three auto-selected styles, see themeMapper.ts's
// pickPosterLayoutForTheme and posterRenderer.ts's renderEditorialPoster/renderCornerPoster/
// renderCenteredPoster.
const COMPOSITION_RULE_VERTICAL = `6. COMPOSITION FOR SCRIPTURE OVERLAY - ZERO OVERLAP DIRECTIVE: This is the single most important rule. Treat the frame as two dedicated zones that must never mix. The CLEAN TEXT ZONE is the UPPER 50% - 60% of the frame, reserved exclusively for the Scripture overlay; it must be COMPLETELY OPEN AND EMPTY - plain sky, a distant softly-blurred backdrop, or a smooth uniform gradient, with no clutter, texture, light rays, birds, or busy detail of any kind that would compete with text legibility. The SUBJECT ZONE is the LOWER 25% - 45% of the frame - the entire concrete subject (person, animal, object, tree, building, bread, warrior, sheep, etc.) MUST be confined strictly inside it, tightly grouped, never scattered. Zero overlap, ever: no part of the subject, no horizon clutter, and no object of any kind may cross into the Clean Text Zone above the 50% line - not a raised hand, not a head, not a tree branch, not even partially.
   "composition" field must state this explicitly and quantified: "subject occupies the bottom 30% of the frame, tightly grouped; the top 70% is wide open uncluttered sky, soft and low-detail, reserved entirely for text overlay."
   CRITICAL - CROP THE SUBJECT, DON'T JUST POSITION IT: an image model asked to place a full head-to-foot standing or kneeling figure "in the bottom X%" will routinely ignore that and render the head near the top anyway - percentage placement of a whole person is NOT reliably followed. So whenever the visual concept involves a person, "prompt" must describe a PARTIAL-BODY CROP that makes this structurally impossible to get wrong: frame from the chest, shoulders, or waist down only (hands, torso, and any table/object they're engaging with), explicitly EXCLUDING the head and face from the shot entirely - e.g. "close-cropped shot from the shoulders down, head not in frame" or "camera low and tight on clasped hands resting on an open Bible, upper body visible only to the collarbone." Only when the visual concept has no human figure (pure landscape, object, animal-only scene) may the subject occupy its zone at full extent.
   DO NOT overcorrect into an unreadable macro shot: this is a chest-down or waist-down crop, NOT an extreme close-up on hands/fingers alone. Keep the depth of field moderate enough (not the shallowest possible) that the surrounding setting - the table, book, fabric, doorway, whatever grounds the scene - stays softly but recognizably visible, so the image still tells its specific story at a glance. If the background blurs into total abstraction, the crop went too tight.`;

const COMPOSITION_RULE_EDITORIAL = `6. COMPOSITION FOR SCRIPTURE OVERLAY - ZERO OVERLAP DIRECTIVE (SIDE-SPLIT): This is the single most important rule, and the one most often gotten backwards - verified directly against real output: the subject frequently lands on the LEFT or in the CENTER of the frame instead of the RIGHT, even when this rule is followed in every other respect. Read this twice before writing "prompt": the CLEAN TEXT ZONE is the LEFT 55% - 60% of the frame's full height - completely open and empty (plain sky, a distant softly-blurred backdrop, or a smooth uniform gradient, no clutter/texture/light rays/birds). The SUBJECT ZONE is the RIGHT-HAND SIDE of the frame - specifically the right 25% - 45% of its width, the side nearer the right edge of the photograph, NOT the left side and NOT the middle. The entire concrete subject (person, animal, object, tree, building, cross, lantern, doorway, etc.) MUST be confined strictly inside that RIGHT zone, tightly grouped, never scattered, and never mirrored to the left. Zero overlap, ever: no part of the subject crosses left of that vertical line, not even partially - not a raised hand, not a branch, not a shadow.
   "composition" field must state this explicitly and quantified, using the word "right": "subject occupies the RIGHT 35% of the frame's width, tightly grouped; the LEFT 60% is wide open uncluttered sky/backdrop, soft and low-detail, reserved entirely for text overlay."
   "prompt" itself must also explicitly say the subject is on the right side (e.g. "positioned in the right third of the frame") - do not describe the scene in a side-neutral way and leave placement implicit, since that is exactly when it defaults to center or left.
   Unlike a bottom-confined subject, a compact human figure here MAY be shown head-to-foot (the head does not need to be cropped out) as long as the ENTIRE figure - including the head - stays on the right side of the vertical line; keep the figure compact rather than sprawling toward the center or the left. Favor a strong, simple right-side subject that reads clearly at a glance - a wooden cross, a lantern, a tree, a doorway, or one compact figure - composed like a premium devotional print, not a busy scene, with the left two-thirds of the frame left entirely open.`;

const COMPOSITION_RULE_CORNER = `6. COMPOSITION FOR SCRIPTURE OVERLAY - CORNER DIRECTIVE: This is the single most important rule, and the one most often gotten wrong in TWO different ways - verified directly against real output: (a) the same left/right confusion other layouts have - it's easy to default to centered or bottom-left instead of bottom-right; (b) a deeper failure specific to this layout - for landscape-heavy concepts (mountains, forests, open fields), trying to confine the WHOLE landscape to a small corner fails outright, because a wide establishing landscape structurally can't shrink into 20% of the frame - it either fills the frame or the composition breaks. Avoid both by distinguishing calm ATMOSPHERE from the CONCRETE SUBJECT:
   - Calm ATMOSPHERE (open sky, distant softly-blurred hills or horizon, a smooth gradient, a wide but SOFT/LOW-DETAIL landscape backdrop) MAY extend across the ENTIRE frame, including the top - it does not need to vanish, it only needs to stay genuinely calm and low-detail wherever it appears, since text goes directly over it.
   - The CONCRETE SUBJECT (any sharply-detailed foreground element the eye is drawn to - a person, animal, building, a tree with visible texture, a rock formation) must be confined SPECIFICALLY to a small area in the bottom-RIGHT corner only (roughly the bottom 20% of height, right half of width) and appear NOWHERE else - not bottom-left, not spanning the full width, not repeated elsewhere. The TOP 50% must have no sharply-detailed concrete element, atmosphere only.
   - If the verse's own visual concept IS a landscape/scenery type with no natural single figure (mountains, fields, sky), keep that entire landscape soft, hazy, and low-detail throughout like a gentle backdrop - NOT a sharp epic vista filling the frame with texture - and add exactly ONE small, clearly-detailed grounded element (a tree, a distant figure, a rock, a gate) confined to the bottom-right corner as the actual focal point.
   "composition" field must state this explicitly: "atmosphere/backdrop reads calmly across the full frame; the one concrete subject occupies a small area in the bottom-right corner only (roughly the bottom 20% of height, right half of width); the top 50% has no sharply-detailed element, reserved for text overlay."
   "prompt" itself must explicitly say the concrete subject sits in the bottom-right corner, not just "at the bottom" - a side-neutral description defaults to centered or left, and must explicitly describe any landscape/backdrop as soft and low-detail rather than sharp and dominant.
   A full head-to-foot figure is fine here as long as it stays within that bottom-right corner region, small and grounded rather than spanning the frame's width. This is a deliberately asymmetric, off-balance composition, not an evenly-weighted one.`;

const COMPOSITION_RULE_CENTERED = `6. COMPOSITION FOR SCRIPTURE OVERLAY - CENTER-FLANKED DIRECTIVE: This is the single most important rule. The frame has three vertical zones side by side: the CENTER 30% of width (full height) holds the entire subject - a person elevated/upright, hands reaching, or a single symbolic object - confined strictly to that middle column. The LEFT 30% - 35% and the RIGHT 30% - 35% are BOTH separate CLEAN TEXT ZONES, completely open and empty on EACH side, since text will be placed independently on both sides at once (one language per side) - not just one side.
   "composition" field must state this explicitly: "subject occupies the center 30% of the frame's width, tightly grouped; both the left ~33% and the right ~33% are wide open, reserved for text overlay on each side independently."
   "prompt" itself must explicitly describe the subject as centered with open space on BOTH sides - do not let it drift toward one edge, since only one flanking zone would then be usable and the other side's text would have nowhere clean to go.
   A full head-to-foot figure is fine here as long as it stays centered and upright, elevated enough in the frame to read as the clear emotional focal point, with both flanking thirds equally open.`;

function buildSystemPrompt(layout: PosterLayout): string {
  const compositionRule = layout === 'editorial' ? COMPOSITION_RULE_EDITORIAL
    : layout === 'corner' ? COMPOSITION_RULE_CORNER
    : layout === 'centered' ? COMPOSITION_RULE_CENTERED
    : COMPOSITION_RULE_VERTICAL;
  return `You are a visual-concept and viewer-relevance generator for a professional Christian devotional poster and short-form video app (The Apostolic Church of India). Given one Bible verse (shown in English, Tamil and Telugu - the exact same verse, for context only), respond with ONLY minified JSON, no prose, no markdown fences, no explanation, in exactly this shape:
{"theme":"short phrase - the name of the central Biblical theme","emotion":"one or two words - the dominant emotional tone","viewerSituation":"one sentence naming the real everyday situation/feeling this verse actually speaks to","emotionalHook":"one short, spoken-natural sentence inviting that viewer in","visualConcept":"one sentence describing a concrete, verse-specific scene - NOT generic religious imagery","composition":"one quantified sentence describing exactly which region the subject occupies and which region is reserved as open space","prompt":"a detailed positive image-generation prompt written as a cinematographer's shot description, background scene only, NO text or typography anywhere in the image","negativePrompt":"a short comma-separated negative prompt","fontStyle":"one of: classic-serif | delicate-serif | engraved-display | decorative-warm","accentColor":"a 6-digit hex color, e.g. #E8A94C"}

NON-NEGOTIABLE RULES:
1. VIEWER SITUATION: Must name a concrete, relatable human situation (fear, anxiety, loneliness, exhaustion, waiting, doubt, gratitude, hope, needing guidance, grief, guilt, weariness, uncertainty) grounded HONESTLY in what THIS specific verse actually says. Never generic "everyone needs faith." Never invent a situation the verse doesn't support.
2. EMOTIONAL HOOK: One single short spoken sentence, phrased like real speech ("If you're afraid today, hold on to this." / "When your mind won't stop racing, remember God's promise here."). Invites via viewerSituation. NEVER manipulative/clickbait: NO "God sent this message specifically to you," NO "watch this or [consequence]," NO "you won't believe what happens next." An honest warm hook ALWAYS beats a dramatic misleading one.
3. VISUAL CONCEPT AND SCENE RELEVANCE: Ground every single visual element directly in the verse's own concrete, literal, contextual imagery. For example:
   - Psalm about provision and the poor -> hands sharing bread, harvest, a shepherd feeding sheep.
   - Verse about recovery and pursuing what was lost -> a warrior on horseback overtaking, a shepherd carrying a lost lamb home.
   - Verse about protection and refuge -> wings sheltering, a fortress wall, a shepherd shielding a lamb.
   - Verse about peace and rest -> still waters, a wheat field, a safe dwelling, olive grove.
   - Verse about healing -> hands laying on in comfort, a broken pot mended, clear living water.
   - Verse about salvation and forgiveness -> empty tomb at dawn, chains falling, scarlet made white.
   ABSOLUTELY NO generic floating religious icons (cross, church steeple, stained glass, disembodied praying hands, halo, generic angel) unless the verse is literally about that specific object. Every image must tell a simple, clear, verse-connected story.
4. CHRISTIAN CONTEXT IS MANDATORY, NOT JUST THEME RELEVANCE: The image must satisfy BOTH "verse-relevant" (rule 3) AND "recognizably Christian in character" - a beautiful but generic landscape/nature/object shot that COULD belong to any unrelated poster is not acceptable on its own. Every "visualConcept" and "prompt" must include an unmistakable Christian marker: a person or family engaged in prayer, worship, Scripture reading, fellowship, or an act of Christian love/service; a biblical-era person, garment, setting, or narrative moment; or a church/community setting - chosen for what actually fits the verse, never forced. Pure landscape/creation imagery with no human or Christian marker is ONLY acceptable when the verse is specifically about God's creation, majesty, or nature itself.
   - Prefer storytelling over symbols: a person or family living out the verse's message beats a static icon.
   - Mix biblical-era and modern-day Christian settings freely (both are equally valid) - pick whichever tells this verse's specific story more naturally; family, marriage, work, and everyday-life verses often read best in a modern setting.
   - Test before finalizing "prompt": if the Bible verse text were removed from the poster, would this image still read as both Christian AND specifically about this verse - not just "spiritual-adjacent" or "pretty"?
   - AVOID (these read as lazy/generic AI religious imagery, not intentional design): a plain glowing cross with no narrative reason, a floating/unrealistic depiction of Jesus or God, generic clouds with vague heavenly light, a random anonymous person praying with no context, a stock church exterior, a closed Bible used as mere set-dressing, unrealistic/fantasy-style divine figures, excessive glow/light-ray effects standing in for a real scene, an isolated romantic couple holding hands or embracing used as generic filler when the verse is not specifically about marriage or a marital relationship, a lone figure staring out a window or kneeling in an unlit room with no story or setting around them.
5. IMAGE PURITY: "prompt" and "negativePrompt" describe ONLY the background scene. NEVER mention Bible text, verse words, a reference, caption, logo, watermark, or any lettering. The image contains ZERO text, letters, typography, or logo of any kind - the app overlays Scripture afterward.
${compositionRule}
7. CINEMATOGRAPHER-LEVEL PROMPT WRITING - SHORT AND FRONT-LOADED: image models weight the start of a prompt most and lose detail in long ones, so "prompt" must stay under 110 words, in this order: (1) the subject and its crop, (2) the verse-specific props, gesture and setting from "visualConcept", (3) the composition/open-space placement, (4) lighting, lens and color grade in a few words, (5) a short quality tag. Describe crops positively - image models ignore negations like "no face" or "head not in frame" in a positive prompt - e.g. "framed from the chest down, the top edge of the frame cutting across the shoulders" rather than "face not visible" (keep "face" in "negativePrompt" as well). Never pad with camera brands or film-stock names. Write "prompt" as a professional cinematographer's shot description, not a flat caption. The result is a MOVIE STILL / professional editorial photograph - never an amateur snapshot, illustration, cartoon, anime, painting, clipart, or CGI/3D render. Always specify ALL of:
   a. Lighting quality and direction (warm golden rim light, soft overcast diffusion, volumetric god-rays through dust, practical candlelight, dawn first light, cool moonlight, blue-hour twilight, silvery window light on a cloudy day).
   b. Lens and depth-of-field character (shallow 85mm f/1.4 creamy bokeh, deep-focus wide 24mm, moderate 50mm).
   c. A specific, deliberate color grade - vary this across warm, cool, and neutral rather than defaulting to warm every time (warm amber-brown and cream; high-contrast warm-orange and dark brown; muted earth-tone and soft sage; cool moonlit blue-silver; deep indigo twilight; overcast dove-gray and cream; airy pastel-to-gold; rose-gold and cream) - see rule 8 for which register favors which.
   d. Framing and camera angle (intimate eye-level close-up, low heroic angle wide shot, eye-level medium shot, wide open establishing).
   e. Atmosphere and texture (dust motes in light, soft film grain, fabric texture of robes, weathered skin, smoke or mist rising).
   f. Realistic, respectful human representation whenever a person appears: natural anatomy, no distorted faces/hands/limbs, dignified and reverent - never exaggerated, fantasy-style, or cartoonish. Clothing must be modest and ordinary (everyday wear or biblical-era garments), never glamour/fashion-editorial styling, low-cut or revealing necklines, or a seductive pose - a devotional poster is not the place for it, and it undermines the reverent tone every other instruction here is asking for. Include "revealing clothing, cleavage, glamour photography, seductive pose" in "negativePrompt" whenever a person appears in the scene.
   g. Close with the quantified composition guarantee from rule #6, then the quality tag: "cinematic film still, professional photography, photorealistic."
8. THEME-MATCHED TECHNIQUE CHEAT SHEET - VARY THE LOOK, DON'T DEFAULT TO GOLD: pick the lighting/lens/grade that fits THIS verse's own specific mood, cycling through genuinely different looks rather than reaching for the same warm golden-hour treatment every time - a whole channel of golden-lit close-ups reads as one repeated photo with different people, not as many different verses. Each register below lists several color-grade options; choose whichever this verse's own words and imagery actually support (what time of day, indoor or outdoor, what weather is implied), not reflexively the first one on the list:
   - Tenderness, comfort, provision, giving, love, healing -> intimate eye-level close-up, shallow creamy bokeh. Grade: warm amber-brown/cream, OR cool moonlit blue-silver (night / watching-over verses), OR soft neutral dove-gray and cream (quiet indoor scenes), OR muted dusty-rose and charcoal (grief/comfort verses).
   - Triumph, deliverance, victory, recovery, spiritual warfare, strength -> wide dramatic action framing, low hero angle, motion cues (dust, cloth, water, sand spray). Grade: high-contrast warm-orange/deep brown, OR steel-blue dawn with a single warm rim-light accent, OR stormy slate-gray breaking open to one narrow shaft of light.
   - Endurance, lament, testing, wilderness, waiting, comfort in mourning -> wide or medium shot, flat soft diffusion, deep focus, stillness rather than motion. Grade: muted desaturated earth-tone, OR cool overcast blue-gray, OR deep indigo twilight with one small warm light source - this register should lean cool/muted more often than warm.
   - Peace, abundance, rest, creation, thanksgiving, salvation light -> wide open establishing shot, deep focus, immense scale. Grade: airy pastel-to-gold, OR cool dawn cerulean-to-white, OR crisp natural daylight with no golden cast, OR twilight blue-hour - don't let every "peaceful" verse become the same sunset.
   Across the many verses this app generates over time, aim for roughly even use of warm, cool, and neutral grades overall - warm/gold should not be the outcome for nearly every image.
9. VISUAL VARIETY - AVOID A REPETITIVE CHANNEL LOOK: this prompt runs independently per verse with no memory of prior calls, so variety has to come from reading THIS verse's own specific wording closely, not from repeating a stock "golden hour" default. Before finalizing "prompt", check: does the lighting/color-grade/time-of-day genuinely come from this verse's own imagery (night watch, wilderness, storm, dawn, an indoor lamp-lit room), or is it just the easy generic choice? Use cool and neutral palettes (blue-gray, indigo, silver-blue moonlight, muted sage, overcast pearl) as often as warm ones - reach for golden-hour warmth only when the verse itself is genuinely about dawn, harvest, or triumphant light breaking through. Vary indoor vs. outdoor and day vs. night across different verses too, not just the color grade.
10. FONT STYLE PICK (matches the same emotional register):
   - "classic-serif": timeless elegant italic serif. Default for warm reflective general devotional, love, guidance, faith, forgiveness, wisdom.
   - "delicate-serif": lighter refined serif italic. For gentle tender intimate verses - comfort, mercy, quiet trust, healing, mourning, hope in stillness.
   - "engraved-display": upright monumental serif, no italic. For declarative triumphant authoritative verses - deliverance, victory, God's power/majesty, strength, creation, judgment, salvation.
   - "decorative-warm": warmer editorial serif with a decorative Tamil display face. For joyful celebratory communal verses - praise, thanksgiving, blessing, provision abundance, harvest.
11. ACCENT COLOR: Single hex accent color used for the poster's emphasized hero clause, reference lines and divider. Pick a hue that HARMONIZES with the color grade you wrote in prompt: warm amber-brown grade -> warm gold/amber; muted earth-tone -> muted ochre/terracotta; warm-orange victory -> deeper burnt-orange/copper; cool moonlit/twilight/overcast grade -> muted teal, indigo, or slate-blue; airy peace -> soft sage or antique gold. Keep it elegant and devotional - NO neon, NO washed-out pastel, NO clashing hues. Exact brightness will be adjusted automatically for legibility, so choose based on hue and mood, not exact shade.
12. ABSOLUTE FINAL RULE: Do NOT translate, rewrite, paraphrase, invent, or quote the Scripture verse text itself anywhere in your response. The verse comes exclusively from the verified Bible database.`;
}

function cacheKeyFor(reference: string, english: string, tamil: string, telugu: string, layout: PosterLayout): string {
  return sha256([reference, english, tamil, telugu, String(CLAUDE_ANALYZER_VERSION), layout].join('|'));
}

function readCache(key: string): VerseAnalysis | null {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, analysis: VerseAnalysis): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(analysis, null, 2));
  } catch (err) {
    console.warn('[ai/analyzer] Failed to write analysis cache:', err);
  }
}

// One Claude call per unique verse (reference + all three language texts + analyzer version),
// cached to disk so a repeat request for the same verse never calls Claude again. Throws on
// failure (no API key, network error, malformed response) - callers fall back to
// staticFallbackAnalysis() from ai/schema.ts rather than blocking generation on Claude being
// reachable.
//
// Theme detection runs in two layers:
//   1. Deterministic keyword scan (themeMapper.detectTheme) runs BEFORE Claude on the actual
//      verse text - its result hints to Claude what theme category the verse belongs in, and
//      the validateClaudeAnalysis step re-runs it afterward to stamp the final themeKey onto
//      the returned analysis regardless of what Claude wrote, guaranteeing every poster lands
//      in one of the standardized 20-theme visual system.
//   2. If Claude is unavailable, staticFallbackAnalysis uses that same deterministic scan to
//      produce a theme-grounded visual entirely from the standardized library, with no AI at
//      all - so even the no-Claude fallback no longer ships generic "sunrise over mountains"
//      imagery.
export async function analyzeVerseWithClaude(
  reference: string,
  english: string,
  tamil: string,
  telugu: string,
  // 'vertical' (default): subject-bottom/text-top, used by the existing Poster (pre-editorial-
  // redesign callers), Narration Video, and Meditation Video. 'editorial': subject-right/text-left,
  // used only by the new left-column Poster style (see server/routes/verse.routes.ts's
  // /verse/analyze-editorial). Cached separately per layout (see cacheKeyFor) since the same verse
  // legitimately produces two different valid analyses/prompts, one per layout.
  layout: PosterLayout = 'vertical'
): Promise<VerseAnalysis> {
  const key = cacheKeyFor(reference, english, tamil, telugu, layout);
  const cached = readCache(key);
  if (cached) return cached;

  const detected = detectTheme(english, tamil, telugu);
  const themeSpec = getThemeSpec(detected.themeKey);
  const suggestedConcept = pickVisualConcept(themeSpec, reference + english);
  // Deterministic per-verse color-grade assignment (see themeMapper.ts's pickColorGrade) - a soft
  // "please vary the grade, don't always default to warm gold" instruction was tested directly
  // against Claude and did NOT work; it kept reaching for the same warm amber-brown grade almost
  // every time regardless. Handing Claude a SPECIFIC grade to use for THIS verse (like the
  // concept/theme hints below already do) is what actually produces variety across verses.
  const suggestedGrade = pickColorGrade(detected.themeKey, reference + english);
  const standardized = buildStandardizedPrompt(themeSpec, suggestedConcept, '', suggestedGrade, layout);

  const userPrompt = `Reference: ${reference}
English: ${english}
Tamil: ${tamil}
Telugu: ${telugu}

DETERMINISTIC THEME DETECTION RESULT (use as your strong hint, but ground everything in the verse's actual wording and context):
Detected theme category: ${themeSpec.label} (key: ${detected.themeKey})
Confidence: ${Math.round(detected.confidence * 100)}%
Matched keywords: ${detected.matchedKeywords.length > 0 ? detected.matchedKeywords.join(', ') : '(none - use your best judgment from the verse context)'}
Theme-matched viewer situation: ${themeSpec.viewerSituation}
Theme-matched recommended visual concept: ${suggestedConcept}
Theme-matched standardized composition rule: ${themeSpec.compositionPattern}
Theme-matched font style: ${themeSpec.fontStyle}
Theme-matched accent color seed: ${themeSpec.accentColor}
ASSIGNED color grade for THIS verse specifically (use this exact grade for "prompt" instead of whatever rule 8 would otherwise default to, unless the verse's own literal imagery clearly demands something else - this is what keeps different verses from all reading as the same warm-golden photo): ${suggestedGrade}

If the verse clearly and literally depicts imagery different from the suggested category (e.g. the verse explicitly names a scene the keywords did not catch), honor the verse's literal imagery first. Otherwise build on this theme. The final analysis will have the deterministic themeKey stamped on by the pipeline regardless, so the closer you stay to this category's visual language the more consistent the poster will look alongside every other poster this app produces.`;

  let analysis: VerseAnalysis;
  try {
    const raw = await askClaudeForJson(buildSystemPrompt(layout), userPrompt, 900);
    analysis = validateClaudeAnalysis(raw, english, tamil, telugu, layout);
  } catch (err) {
    analysis = staticFallbackAugmented(english, tamil, telugu, standardized, themeSpec);
  }
  writeCache(key, analysis);
  return analysis;
}

function staticFallbackAugmented(
  english: string,
  tamil: string,
  telugu: string,
  standardized: ReturnType<typeof buildStandardizedPrompt>,
  themeSpec: ReturnType<typeof getThemeSpec>
): VerseAnalysis {
  const concept = pickVisualConcept(themeSpec, english + tamil);
  return {
    themeKey: detectTheme(english, tamil, telugu).themeKey,
    theme: themeSpec.label,
    emotion: themeSpec.emotion,
    viewerSituation: themeSpec.viewerSituation,
    emotionalHook: themeSpec.emotionalHook,
    visualConcept: concept,
    composition: standardized.composition,
    prompt: standardized.prompt,
    negativePrompt: standardized.negativePrompt,
    fontStyle: themeSpec.fontStyle,
    accentColor: themeSpec.accentColor,
    provider: 'static-fallback'
  };
}

// Figure-free (no human figure anywhere) safe-fallback background prompts for the "all review
// attempts failed" terminal escape hatch. Previously was a single generic sky gradient that gave
// every failed generation the same poster, regardless of which of the 20 themes it actually was.
// Instead each BibleThemeKey gets its OWN verse-specific figure-free scene — still zero human
// beings (so NO composition risk, NO gesture/wardrobe/Christian-marker review risk), but visually
// tailored to the specific theme so a failed-generation poster still reads as that theme, not a
// blank placeholder.
//
// Design rules followed for every entry:
//   - ZERO human beings, zero animals, zero faces, zero hands. EVER. Only nature, architecture,
//     light, weather, artifacts.
//   - "Subject band": lower 25-45% of the frame (same ZERO-OVERLAP placement guarantee the
//     main generation pipeline already applies to figures) explicitly placed by language.
//   - "Clear zone" for text overlay: top 55%+ wide open sky/gradient/wall explicitly described.
//   - Cinematic quality cues preserved: lighting direction, lens, color grade, atmosphere.
//   - Theme tailoring: each scene reads as the named theme, not a generic "nice landscape."
const FIGURE_FREE_FALLBACK_BY_THEME: Record<BibleThemeKey, string> = {
  PROTECTION:
    'Aerial perspective of an ancient weathered limestone city wall with thick hand-carved crenellated battlements running diagonally across the lower 35% of frame, its rugged blocks and deep mortar lines catching warm golden-hour side light that carves deep sharp shadows in every crack and joint. Top 60% of frame is entirely empty sky: a vast graduated dusk gradient of soft deep indigo fading upward through dusty lavender to pale peach-pink near the horizon line, one tiny wisp of high cirrus cloud visible far right edge. Shot on 85mm f/1.8 prime lens, shallow depth of field with the wall crest in crisp sharp focus and distant rooftop silhouettes softly blurred in the background. Warm amber-brown color grade, Kodak Portra 400 film stock, cinematic fine natural film grain, volumetric thin dust haze rising from fields beyond the battlement edge. No human beings, no animals, no buildings taller than the wall crest anywhere in frame.',
  PROVISION:
    'A weathered hand-hewn reclaimed rustic wooden tabletop of wide rough planks fills the lower 30% of frame, scattered richly and abundantly: two loaves of crusty artisan sourdough bread dusted with fine white flour, a small hand-thrown copper pitcher of milk with a thin wisp of steam rising, a woven reed basket overflowing with deep purple grapes, bright red pomegranates, and golden figs, a few fresh sprigs of thyme and rosemary lying loose on the wood. Top 65% of frame is completely open: a clean sunlit cream-colored aged plaster wall with the softest warm suggestion of dappled oak leaf shadows drifting slowly across it in a gentle breeze. Shot directly overhead on 50mm f/2.0 prime lens with warm honey-golden window light bathing the entire scene from the side. Rich warm amber color grade, Kodak Ektar 100 film stock for saturated harvest tones, shallow depth of field, soft fine film grain, the steam wisp from the milk pitcher visible against the wall. No people, no hands, no animals, no utensils, no plates.',
  RECOVERY:
    'The lower 40% of frame holds the rocky shoreline of a calm sunlit freshwater lake: pale smooth river-worn stones carefully arranged along the waterline, a single long piece of silver-gray weathered driftwood half-buried in the pebbles at its edge. Gentle slow ripples lap across the stones, catching silver-blue sunlight and scattering it in shards. Top 55% of frame is entirely open wide sky: a soft graduated field of pale milky cerulean blue fading upward into the wispy thin white of a distant high-overcast layer, a few faint long contrails visible far overhead. Shot at still water level on 24mm wide lens, focus pulled crisp to the driftwood foreground detail while far lake shore melts into a gentle blue haze. Cool dawn color grade, Kodak Portra 400 film stock, cinematic fine film grain, soft volumetric thin mist hanging just above the water surface catching the side light. No people, no boats, no birds, no animals anywhere in frame.',
  PEACE:
    'The lower 35% of frame holds a softly curving bank of tall heavy golden prairie wheat swaying in a slow warm breeze, individual stalks and wheat heads catching the warm honey light of late afternoon. A narrow worn packed-dirt footpath meanders along the bottom edge of the grass band, disappearing gently toward the lower right corner. Top 60% of frame is completely empty expansive sky: a vast graduated wash of soft peach near the horizon melting upward through pale dusty rose into quiet hazy lavender at the very top of frame, a single thin delicate crescent moon already visible high in the lavender band. Shot at eye level on 35mm lens f/8 for deep focus, moderate depth of field that lets the farthest wheat blades dissolve into dreamy softness while mid-ground is sharp. Warm sunset color grade, Kodak Ektar 100 film stock, cinematic fine natural film grain, numerous tiny floating motes of backlit dry pollen drifting slowly through the warm light column. No people, no animals, no structures, no fences visible.',
  HOPE:
    'Lower 40% of frame is the dark silhouetted ridgeline of a distant jagged mountain range, its peaks traced with a brilliant thin glowing gold rim as the sun crests just behind the tallest summit. A soft pink dawn glow bleeds upward from the ridgeline across the sky. Top 55% of frame is completely open sky: a vast graduated field of deep steel royal blue at the top fading down through softer periwinkle into warm coral-pink directly above the sun rim. One faint bright pinpoint morning star hangs clear and sharp in the upper left third. Shot from a valley meadow overlook on 70mm telephoto lens, mountains rendered in crisp dark silhouette while the foreground green grass at the bottommost edge melts into a soft spring-green blur. Dawn color grade with vivid coral punch on the horizon line, Kodak Ektar 100 film stock, cinematic fine grain, thin ground fog drifting in distant saddles between mountain peaks. No people, no buildings, no birds, no animals, no power lines.',
  GUIDANCE:
    'A stone pathway of weathered square granite cobblestones, worn smooth and shiny by centuries of foot traffic, runs diagonally from the lower right corner upward through the lower 40% of the frame. The cobbles are flanked on both sides by low neatly trimmed boxwood hedges with deep green leaves. The path curves gently left and disappears over a gentle grassy rise at the back edge of the 40% band. Top 55% of frame is entirely open sky: a soft uniform pearl gray thin overcast, evenly lit with the diffused softness of light overcast morning, no clouds with defined edges, just a vast calm even ceiling of diffuse light. Shot standing on the pathway at eye level, 35mm lens f/4, focus crisp on the mid-distance cobblestones and their worn textures while the immediate foreground stones fall softly out of focus. Muted natural color grade, Kodak Portra 400 film stock, cinematic fine film grain, soft thin ground mist drifting just above the hedgerow tops. No people, no hands, no animals, no signposts, no structures beyond the low hedges.',
  LOVE:
    'Lower 35% of frame is a dense lush hedge of climbing roses in full abundant bloom, heavy with blush-pink and cream-white blossoms spilling over a weathered low garden archway of rough natural cut stone. Serrated green leaves are backlit by warm golden afternoon light that turns petal edges translucent and glowing, with a few soft pink petals drifting down mid-air caught in the same warm light column. Top 60% of frame is completely open sky: a vast unbroken graduated wash of pale peach graduating upward to soft buttery cream near the top of frame, a single wispy thin cirrus cloud drawn like a brushstroke high right side. Shot at eye level on 85mm f/1.4 prime lens, creamy organic background bokeh melting the far garden behind the arch into soft patches of green and gold. Warm rose-gold color grade, Kodak Portra 400 film stock, cinematic fine film grain, heavy soft creamy bokeh across all distant background elements. No people, no hands, no benches, no animals, no garden furniture.',
  FAITH:
    'Lower 40% of frame holds a massive ancient gnarled olive tree standing alone in the desert: its thick twisted trunk split into two heavy arms, silvery small leaves catching warm side afternoon light. At its base on weathered flat limestone flagstones rests a single open hand-thrown ceramic oil jar with dark purple olive fruit and broken branches spilling beside it onto the stones. Top 55% of frame is completely open: a vast graduated sky of dusty burnished gold near the horizon melting upward into warm terracotta-brown then soft hazy violet at the top, with a thin long streak of upper-atmosphere cirrus cloud stretched horizontally across the violet band. Shot on 50mm lens at eye level f/5.6, focus crisp on the tree trunk bark and flagstone weathering detail while distant olive orchard rows behind blur into a soft hazy golden shimmer. Golden hour late afternoon color grade, Kodak Ektar 100 film stock, cinematic fine film grain, fine dry dust motes catching the side light as they drift. No people, no hands, no animals, no structures beyond the tree and jar and flagstones.',
  STRENGTH:
    'Lower 35% of frame is the sheer vertical face of a massive granite cliff, its craggy uneven surface lit by low-angle warm morning sun that carves deep shadowed crevices and pale lichen patches in sharp dramatic relief. The cliff runs straight up to a crisp clean horizontal ledge that cleanly terminates the lower band. Top 60% of frame is completely empty sky: a vast unbroken graduated wash of pale cerulean blue at the top fading downward to soft aqua cyan near the cliff ledge line. One tiny far-off red-tailed hawk is visible as a single dark speck circling high in the cerulean band. Shot looking steeply upward from the cliff base on a 24mm wide lens f/8. Crisp sharp textured detail in the rock surface, cool cyan tint on shaded cliff faces warming to honey gold in direct sun. Cinematic fine film grain, Kodak Ektar 100, thin high-altitude haze. No people, no ropes, no climbing gear, no animals beyond the distant hawk speck.',
  HEALING:
    'Lower 40% of frame holds a quiet still lily pool of clear calm water in a smooth sunken natural stone basin, its surface catching and mirroring the sky in a soft calm perfect reflection. Broad smooth round water lily pads with a single open ivory-white blossom float near the basin edge. A very thin delicate veil of mist rises slowly from the water surface catching pale warm early morning sunlight. Top 55% of frame is completely open sky: a vast graduated wash of pale aqua near the horizon melting upward into soft mint then very pale lemon at the top of frame. Shot standing at the basin rim on a 50mm lens f/4, focus crisp on the lily pad veins and blossom petal detail while the farthest basin edge blurs gently. Dawn cool-to-warm color grade, Kodak Portra 400 film stock, cinematic fine grain, subtle prism light-fall tiny rainbow glints visible in the rising mist column. No people, no feet, no animals, no structures beyond the basin stone.',
  THANKSGIVING:
    'A weathered rough-hewn solid reclaimed oak farm table surface fills the lower 30% of frame: upon it sits a large woven straw wicker basket heaped high and overflowing with fresh autumn harvest — bright orange pumpkins, deep red apples, butternut golden squash, dark purple plums, ears of yellow corn with husks peeled back. A few loose dried golden wheat stalks are arranged beside the basket on bare wood. Top 65% of frame is completely open: a warm cream-colored textured stucco wall in soft diffused daylight, with the faintest suggestion of dappled maple leaf shadows dancing at the top corners of frame. Shot on a 65mm macro lens f/3.5, warm golden afternoon window light illuminating the basket contents from the upper right at 45 degrees. Rich deep autumnal color grade, Kodak Ektar 100 film stock for saturated harvest tones, cinematic fine grain, very shallow depth of field that keeps the front edge of the basket weave and foreground corn in sharp crisp focus and dissolves the back contents into soft warm blur. No people, no hands, no animals, no utensils, no plates.',
  FORGIVENESS:
    'Lower 35% of frame is a whitewashed weathered sun-baked adobe wall enclosing a small sunken tiled courtyard, its pale rough surface crossed by soft sharp diagonal shadows cast by unseen pomegranate tree branches. At the center of the lower band a simple low hand-carved basin of rich terracotta-colored stone holds still clear water with a few ripples catching light. A single small pure white dove feather lies on the basin rim catching pale soft afternoon light. Top 60% of frame is entirely empty: a vast graduated sky of soft coral fading upward into dusty rose then into muted dusty lavender, the dark silhouette of a distant single palm frond visible only at the absolute lower-left edge of the sky band. Shot standing in the courtyard on a 50mm lens f/4, focus crisp on the feather barb detail and basin rim texture while the far wall blurs into soft cream and terracotta bokeh. Warm dusty desert color grade, Kodak Portra 400 film stock, cinematic fine grain, light fine dust motes drifting in the tall column of sun falling into the courtyard. No people, no birds, no animals, no doors or windows.',
  WISDOM:
    'Lower 40% of frame holds a massive ancient library reading table of dark aged quarter-sawn oak, polished to a deep patina by centuries of daily use. Arranged neatly upon it: one large open leather-bound volume with cream parchment pages catching warm side light, a solid aged brass compass in its velvet-lined wooden box, a small bulbous ceramic inkwell with a single long cut goose quill resting across its mouth, and a few dried pressed dark fern fronds acting as bookmarks protruding from pages. Top 55% of frame is completely open: a tall floor-to-ceiling panel of aged walnut bookshelves in soft even warm light, all books bound in uniform muted brown, olive, and burgundy leather, spines neatly aligned, no individual titles readable, the whole upper half dissolving into a dark warm softly focused wood-and-leather textured gradient. Shot standing at the table on a 50mm lens f/2.8, focus crisp on the open book pages and the quill feather detail. Deep warm walnut and brass color grade, Kodak Portra 800 film stock for warm shadow rendition, cinematic fine grain, very shallow depth of field that dissolves the far bookshelf rows into soft warm velvety blur. No people, no hands, no animals, no candles.',
  COMFORT:
    'The lower 30% of frame is the foot of an unmade inviting bed: turned-down crisp white linen sheets, soft chunky wool throw blanket in heathered oatmeal gray draped casually over the corner edge, one small cream ceramic mug of steaming chamomile tea and an open loose cream-colored hand-knit shawl resting on the dark oak nightstand surface that forms the absolute bottom edge of the lower band. Top 65% of frame is completely open: a vast blank empty wall in warm off-white matte paint, evenly lit with the soft diffused light of an early overcast spring morning, no shadows or artwork or pictures visible anywhere. Shot standing at the foot of the bed on a 35mm lens f/4, focus crisp on the fine rising steam wisp from the mug and the wool blanket yarn texture. Warm pale soft morning color grade, Kodak Portra 400 film stock, cinematic very fine grain, a thin wisp of tea steam rising visibly curling from the mug. No people, no feet, no animals, no face or hands implied anywhere. No pillows in frame.',
  SALVATION:
    'Lower 30% of frame holds the silhouetted near-shore dark rocks of a rugged sea coast, waves breaking white and frothy against them in heavy surf spray that catches the first warm gold of sunrise. The straight sharp horizon line of the open ocean runs cleanly across the 30% band boundary. Top 65% of frame is entirely open: a vast graduated sky of deep indigo at the very top fading down through royal purple into soft magenta then brilliant fiery tangerine directly above the low horizon sun. One bright sharp pinpoint of the morning star hangs in the upper indigo quadrant. Shot from a low cliff ledge on a 24mm wide lens f/8, silhouetted rocks rendered in sharp solid pure black, the ocean surface catching the tangerine light as thousands of tiny sparkles. Vibrant dramatic sunrise color grade with heavy tangerine horizon punch, Kodak Ektar 100 film for saturated color, cinematic fine grain, fine salt-mist haze making the farthest ocean horizon soft and diffuse. No people, no boats, no birds, no lighthouses, no piers.',
  CREATION:
    'Lower 35% of frame holds a grand sweeping alpine valley vista: tall snow-capped granite and limestone peaks lining a meadow carpeted in dense wildflowers in violet purple, buttercup yellow, and pure white. A narrow bright silver creek winds through the valley floor catching low midday sun. A single giant ancient Douglas fir stands sentinel at the valley entrance. Top 55% of frame is completely open: a vast unbroken graduated sky of deep saturated cobalt blue at the very top fading through crisp cerulean into almost-white cyan directly above the mountain summits. Two thin wispy white contrails drawn high across the cobalt are the only sky markings. Shot from a high scenic overlook on a 16-35mm wide lens f/11 for deep front-to-back scenic depth, mountains in perfect sharp focus while the immediate foreground wildflower patch at the overlook edge dissolves into soft painterly color. Crisp natural daylight color grade, National Geographic quality, Kodak Ektar 100 or Fuji Velvia 50 film stock emulation for vivid saturated color, fine crisp natural grain, thin atmospheric haze visible between distant ridgelines. No people, no roads, no cabins, no animals, no power lines, no fences.',
  JUDGMENT:
    'Lower 30% of frame holds the summit plateau of a high windswept barren mountain: bare dark polished granite slabs swept clean of soil by wind and ice, a few hardy twisted alpine pines stunted by the altitude growing from cracks. The plateau drops away sharply at the back edge of the 30% band. Top 65% of frame is entirely open sky: a vast dramatic storm sky with a single narrow brilliant vertical sunlight shaft breaking down from a small opening in the clouds through deep heavy slate-gray cumulonimbus, the narrow shaft catching the rough granite plateau in a sharp vertical column of gold while the rest of the scene lies in deep cool shadow. Shot from the plateau edge on a 35mm lens f/5.6, focus crisp on the granite mineral grain texture and stunted pine needles. Dramatic high-contrast storm color grade with gold/charcoal tension, Kodak Vision3 500T film emulation for cinematic contrast, rich fine visible film grain, wind-blown dry pine needles visibly swept mid-air in the golden light column. No people, no animals, no structures, no cairns.',
  PRAISE:
    'Lower 40% of frame holds the apse of an ancient weathered stone basilica interior: soaring hand-carved sandstone columns and rounded stone arches, a tall sunbeam shaft slanting through a high unseen stained-glass window, painting the lower columns and polished stone floor with soft patches of ruby, sapphire, emerald, and gold. At the very bottom of frame, the limestone floor tiles are empty and polished to a sheen. Top 55% of frame is completely open: the high vaulted stone ceiling of the apse rising in quiet gentle curves, its plaster aged to a warm muted off-white with faint traces of old worn gold leaf visible in the highest vault ribs, evenly lit by ambient diffuse church light. Shot from the floor looking steeply upward with a 24mm wide lens f/5.6, crisp sharp detail in the column capital carvings while the far distant nave behind melts into a soft warm haze. Deep cathedral color grade of warm stone and colored light, Kodak Portra 800 film stock for warm shadows, cinematic fine grain, fine tiny dust motes illuminated and drifting in the tall stained-glass color beam. No people, no pews, no candles, no altar cloth, no animals, no kneelers.',
  WAITING:
    'Lower 30% of frame holds an empty quiet sandy seashore at deep twilight: pale smooth sand, a narrow band of gentle surf running silver along the tideline, a few half-buried small spiral shells visible on the dry sand. A single simple weathered square wooden post of an old pier remains stands alone at the left edge of the lower band. Top 65% of frame is entirely open: a vast graduated deep twilight sky of deep royal indigo at top fading downward through dusty violet into soft warm rose at the tideline horizon. The very first bright sharp evening star hangs pinpoint clear in the upper indigo. Shot standing on the sand at water edge on a 35mm lens f/5.6, focus crisp on the pier post grain and nearby shell detail while the far surf melts into a soft silver shimmer. Cool deep twilight color grade with deep indigo contrast, Kodak Portra 800 film stock for low light shadow detail, cinematic very fine grain, fine salt-mist haze softening the distant horizon line. No people, no dogs, no towels, no boats, no birds, no additional pier posts.',
  GENERIC:
    'Lower 35% of frame holds the tree line of a quiet mature deciduous forest at the edge of a meadow, dense foliage catching the warm honey light of late afternoon, leaf edges glowing translucent and backlit gold. A narrow worn packed-dirt footpath enters the forest at the bottom edge of the lower band. Top 55% of frame is completely open: a vast graduated sky of soft peach near the horizon melting upward through pale dusty rose into quiet hazy lavender at the top of frame, a single thin wisp of high cirrus visible far right side. Shot at eye level on a 50mm lens f/5.6, foliage in crisp mid-distance focus while the immediate meadow foreground dissolves into warm green and gold blur. Golden hour warm color grade, Kodak Portra 400 film stock, cinematic fine natural grain, numerous tiny backlit dry pollen motes floating slowly in the tall warm light column. No people, no animals, no structures, no benches, no signposts, no fences.'
};

export function pickFigureFreeFallbackPrompt(themeKey: BibleThemeKey | string | undefined | null): string {
  if (!themeKey) return FIGURE_FREE_FALLBACK_BY_THEME.GENERIC;
  const key = String(themeKey).toUpperCase();
  const asTheme = key as BibleThemeKey;
  return FIGURE_FREE_FALLBACK_BY_THEME[asTheme] || FIGURE_FREE_FALLBACK_BY_THEME.GENERIC;
}
